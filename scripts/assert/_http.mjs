#!/usr/bin/env node
// Shared tiny helpers for scripts/assert/*.mjs. No third-party deps.
export const API = (process.env.API_BASE || "http://127.0.0.1:3020/game/api").replace(/\/+$/, "");

export function fail(msg) {
  console.error(`[ASSERT] ${msg}`);
  process.exit(1);
}

export function ok(msg = "OK") {
  console.log(msg);
  process.exit(0);
}

export function assert(cond, msg) {
  if (!cond) fail(msg);
}

export function ac(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

export async function post(path, body, ms = 25000) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ac(ms),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

export async function get(path, ms = 15000) {
  const res = await fetch(`${API}${path}`, { signal: ac(ms) });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

export async function makeSave(tag) {
  const { status, body } = await post("/saves", {
    player_name: `assert-${tag}-${Date.now().toString(36)}`,
  });
  assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
  return body.save.id;
}

export async function act(id, input) {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  return body;
}

export async function fetchSaveView(id) {
  const { status, body } = await get(`/saves/${id}`);
  assert(status === 200 && body && body.save, `GET save failed (HTTP ${status})`);
  return body;
}

const HEAL_ITEM_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);

// 存档指纹：跨迭代比对「上一个动作是否真的改动了世界」。指纹连续不变
// = 驱动在空转（配额耗尽的休息、被拒的动作）——直接 fail 暴露死路，
// 绝不静默磨到循环上限。
function saveSig(s) {
  const c = (s && s.combat) || {};
  const e = c.enemy || {};
  return [
    s.scene, s.chapter, s.hp, s.mp, s.max_hp, s.max_mp, s.level, s.free_points, s.rest_used,
    s.encounter_cd, s.encounter_clock, c.seq, c.turn, e.hp,
  ].join("|");
}

function makeStallWatch(tag, limit = 5) {
  let prev = null;
  let stale = 0;
  return (s) => {
    const sig = saveSig(s);
    stale = sig === prev ? stale + 1 : 0;
    prev = sig;
    if (stale >= limit) {
      fail(
        `${tag}: driver stalled — state unchanged across ${stale + 1} actions ` +
          `(scene=${s.scene} ch=${s.chapter} hp=${s.hp}/${s.max_hp} rest=${JSON.stringify(s.rest)})`
      );
    }
  };
}

// 非交战回血：先「休息」（有配额才点，被拒不会空转），配额耗尽退回
// 药水直补（走 /item op=use 免回合通道）。返回 true 表示已采取回血动作。
async function tryHeal(id, s, inventory) {
  if (s.rest && s.rest.available === true) {
    await act(id, "休息");
    return true;
  }
  const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
  if (heal) {
    const { status } = await post(`/saves/${id}/item`, { item_id: heal.item_id, op: "use" });
    if (status === 200) return true;
  }
  return false;
}

// 战斗感知推进：交战中「前进」= 掷逃（失败白挨一回合原地不动），击杀后
// 同场景有移动冷却——一次「逻辑推进」要展开成一串真实操作。
//   fight: "all" 见敌就打（磨死或人亡）；"mobs" 打小怪、boss 一律掷逃；
//          "boss" 只打守关 boss、小怪掷逃；"none" 见敌就掷逃。
//   restAt: 无交战且 HP 低于该比例时先「休息」回血再继续。
// 返回让 scene 或 chapter 真正变化的那一次回包（死亡回溯场景重置也算）。
export async function advanceOnce(id, { fight = "mobs", restAt = 0.45, max = 400 } = {}) {
  const watch = makeStallWatch("advanceOnce");
  for (let i = 0; i < max; i++) {
    const { save: s, inventory } = await fetchSaveView(id);
    watch(s);
    const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
    if (s.combat) {
      const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
      const wantFight = fight === "all" || (fight === "boss" && isBoss) || (fight === "mobs" && !isBoss);
      const lowHp = s.hp > 0 && s.hp <= Math.max(25, s.max_hp * 0.35);
      const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
      let input;
      if (lowHp && hasHealer) input = "使用道具";
      else if (wantFight) input = castable ? `释放技能 ${castable.name}` : "攻击";
      else input = "前进"; // 掷逃：成功即落地移动，失败白挨一回合
      const r = await act(id, input);
      if (r.save.scene !== s.scene || r.save.chapter !== s.chapter) return r;
      continue;
    }
    if (restAt > 0 && s.hp > 0 && s.hp < s.max_hp * restAt && (await tryHeal(id, s, inventory))) {
      continue;
    }
    return await act(id, "前进");
  }
  fail(`advanceOnce: ${max} actions without a scene change`);
}

// 生存向穿越驱动：交战中「前进」是 50% 掷逃（失败吃反击、阵亡回溯章
// 首），Lv1 纯掷逃在高章数学上走不通。打法：低章只打「打得动」的小怪
// 攒级（自由点全堆体力撑血池、穿新手装备、残血嗑药、满血再动），
// 练级到 fightCap 后纯掷逃。章节软门断言需要压级时把 fightCap 调低。
// F096 收尾：守关者是硬门——冷却期掷逃穿房已封死，守关战一律真打
// （打不过就阵亡回溯，靠累积 XP 再战），驱动不再对 boss 掷逃。
const _geared = new Set();
export async function advanceTraverse(id, { fightCap = 8, max = 600 } = {}) {
  const watch = makeStallWatch("advanceTraverse");
  for (let i = 0; i < max; i++) {
    const { save: s, inventory, equipment } = await fetchSaveView(id);
    watch(s);
    if (!_geared.has(id)) {
      _geared.add(id);
      const slots = [equipment && equipment.weapon && equipment.weapon.id, equipment && equipment.armor && equipment.armor.id];
      for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
        if ((inventory || []).some((r) => r.item_id === itemId && r.qty > 0) && !slots.includes(itemId)) {
          await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
        }
      }
    }
    if (s.free_points > 0) await post(`/saves/${id}/spend`, { stat: "vitality" });
    const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
    if (s.combat) {
      const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
      const lowHp = s.hp > 0 && s.hp <= Math.max(30, s.max_hp * 0.4);
      const mobLv = 2 + 5 * (s.chapter - 1);
      const farmable = !isBoss && s.level < fightCap && mobLv <= s.level + 4 && s.hp > s.max_hp * 0.35;
      const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
      let input;
      if (lowHp && hasHealer) input = "使用道具";
      else if (isBoss || farmable) input = castable ? `释放技能 ${castable.name}` : "攻击";
      else input = "前进";
      const r = await act(id, input);
      if (r.save.scene !== s.scene || r.save.chapter !== s.chapter) return r;
      continue;
    }
    // 残血先回血：休息配额耗尽/被拒时退回药水直补，都没有就带伤前进
    // ——绝不对同一个被拒动作无限重试（ stalled 由 watch 兜底）。
    if (s.hp > 0 && s.hp < s.max_hp * 0.9 && (await tryHeal(id, s, inventory))) {
      continue;
    }
    return await act(id, "前进");
  }
  fail(`advanceTraverse: ${max} actions without a scene change`);
}

// 就地清场：不移动地解除交战（观测/按钮断言前置），打不死就嗑药，阵亡
// 会让场景回滚——调用方按自身口径处理。
export async function clearCombat(id, { max = 120 } = {}) {
  const watch = makeStallWatch("clearCombat");
  for (let i = 0; i < max; i++) {
    const { save: s, inventory } = await fetchSaveView(id);
    if (!s.combat) return s;
    watch(s);
    const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
    const lowHp = s.hp > 0 && s.hp <= Math.max(25, s.max_hp * 0.35);
    const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
    await act(id, lowHp && hasHealer ? "使用道具" : castable ? `释放技能 ${castable.name}` : "攻击");
  }
  fail(`clearCombat: ${max} actions and combat still active`);
}
