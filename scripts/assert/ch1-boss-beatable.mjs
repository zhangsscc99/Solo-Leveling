#!/usr/bin/env node
// F095 ch1 守关 boss 可打 + 逃生阀 + 濒死觉醒契约：
//   1) 数据层独立推导（只读 chapters.json / encounter.js 的 CHAPTER_ENEMIES
//      数据表，复制 stats.js/combat.js 的文档系数，不调任何被测函数当
//      oracle）：ch1 守关者对 Lv.1–2 新档的单回合伤害 / 玩家单回合伤害 < 1，
//      且 boss HP / 玩家 DPS ≤ 12 ——理论上新档就能赢。
//   2) 实战：新档从第 1 章起点只用白名单指令（前进/攻击/防御/使用道具/
//      释放技能/逃跑）推进，boss 战动作数 ≤12 内击杀守关者，随后
//      chapter 推进到 2、level ≥2。
//   3) 逃生阀：boss 战中「逃跑」成功 → 撤回上一主线场景（成功回合不掉血，
//      逃跑失败才吃反击）；下一步再进 boss 房不强制重遇（2 步再入冷却），
//      但原地「攻击」= 主动叫阵，仍可挑战守关者。
//   4) 濒死觉醒：第 1 章首次死亡接入 ch1_death 剧情并给 +1 级实质补偿；
//      第二次死亡仍是纯回溯（觉醒只发一次）；重生后再进 boss 房能打死——
//      死亡→重生→再进房不会退化成零收益循环。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const ENC_TABLE = require(path.join(ROOT, "server", "engine", "encounter.js")).CHAPTER_ENEMIES;

// ── 独立 oracle：只读数据，公式按 stats.js/combat.js 注释中的系数复制 ──
const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const RANK_ORDER = ["E", "D", "C", "B", "A", "S"];
const rankF = (a, d) => {
  const i = RANK_ORDER.indexOf(a), j = RANK_ORDER.indexOf(d);
  if (i < 0 || j < 0 || i === j) return 1;
  return i > j ? Math.min(1.15, 1 + (i - j) * 0.05) : Math.max(0.55, 1 + (i - j) * 0.1);
};
// 文档系数：atk = 1.6×str、def = 0.8×vit；boss 属性 str=round(7+1.5L)、vit=round(3+0.8L)。
const scaled = (lv) => ({
  strength: Math.round(7 + lv * 1.5),
  vitality: Math.round(3 + lv * 0.8),
});
const dmg = (atk, def, mul) => Math.max(1, Math.round((atk - def) * mul));

function deriveMainPath(chapter) {
  const byId = new Map(chapter.scenes.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  let cur = chapter.scenes[0];
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => typeof c.next === "string" && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
  return out;
}

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const ch1Path = deriveMainPath(ch1);
const bossScene = ch1.scenes.find((s) => s.kind === "boss");
assert(bossScene, "oracle: ch1 missing boss scene");
const CHAIN_HEAD = ch1Path[0];
const PREV_SCENE = ch1Path[ch1Path.indexOf(bossScene.id) - 1];
assert(CHAIN_HEAD && PREV_SCENE, "oracle: boss room must have a previous chain scene");
const deathScene = ch1.scenes.find((s) => s.id === "ch1_death");
assert(deathScene && deathScene.text, "oracle: ch1_death side scene missing");
const DEATH_FRAG = stripWs(deathScene.text).slice(0, 12);

// ── A) 数据层可行性：守关者对 Lv.1–2 的承伤/输出比 < 1，且 HP ≤ 12 刀 ──
const tpl = ENC_TABLE[1].boss;
// 期望口径：ch1 期望等级 2 + 守关加成 → 守关者 Lv.3（不再是压死人的 Lv.5）。
const EXPECTED_BOSS_LV = 3;
const bossAtk = tpl.atk !== undefined ? tpl.atk : Math.round(scaled(EXPECTED_BOSS_LV).strength * 1.6);
const bossDef = tpl.def !== undefined ? tpl.def : Math.round(scaled(EXPECTED_BOSS_LV).vitality * 0.8);
// 新档基线：str10 vit8 agi12 int10 per14、HP 100、E 级、无装备。
const P_ATK = 10 * 1.6;
const P_DEF = 8 * 0.8;
const bossDmg = dmg(bossAtk, P_DEF, rankF(tpl.rank, "E"));
const playerDmg = dmg(P_ATK, bossDef, rankF("E", tpl.rank));
assert(
  bossDmg / playerDmg < 1,
  `oracle: boss 单回合伤害 ${bossDmg} 不得低于玩家 DPS ${playerDmg}（比值 ${(bossDmg / playerDmg).toFixed(2)}）`
);
assert(
  Math.ceil(tpl.hp / playerDmg) <= 12,
  `oracle: boss HP ${tpl.hp} 需要 ${Math.ceil(tpl.hp / playerDmg)} 刀 > 12（玩家 DPS ${playerDmg}）`
);

const HEAL_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);
const hasHealer = (inv) => (inv || []).some((r) => r.qty > 0 && HEAL_IDS.has(r.item_id));

// 白名单战斗一步：低血嗑药 → 有 MP 放技能 → 否则普攻。
async function fightStep(id) {
  const { save: s, inventory } = await fetchSaveView(id);
  const low = s.hp > 0 && s.hp <= Math.max(30, s.max_hp * 0.35);
  if (low && hasHealer(inventory)) return act(id, "使用道具");
  if (s.mp >= 12) return act(id, "释放技能 猛虎猛击");
  return act(id, "攻击");
}
async function toScene(id, sceneId, { fight = true, max = 120 } = {}) {
  let cur = null;
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(id);
    if (s.scene === sceneId && !s.combat) return s;
    cur = s.combat && fight ? await fightStep(id) : await act(id, "前进");
  }
  throw new Error(`toScene(${sceneId}) exceeded ${max} actions`);
}

// ── B) 新档实战：白名单推进，boss 战 ≤12 动作击杀，chapter→2、level≥2 ──
{
  const id = await makeSave("ch1-boss-beatable");
  let cur = null;
  let bossActs = 0;
  let killed = false;
  for (let i = 0; i < 300 && !killed; i++) {
    const { save: s } = await fetchSaveView(id);
    if (s.combat) {
      const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
      if (isBoss) {
        bossActs++;
        assert(
          s.combat.enemy.level <= 4,
          `守关者等级仍压人：Lv.${s.combat.enemy.level}（应为期望等级 2 + 小加成）`
        );
        cur = await fightStep(id);
        if (!cur.save.combat) {
          assert(/击败/.test(cur.reply.content), `boss kill reply missing 击败: ${cur.reply.content.slice(-160)}`);
          killed = true;
        } else {
          assert(cur.save.hp > 0, `new save died inside boss fight (act ${bossActs})`);
          assert(bossActs <= 12, `boss fight exceeded 12 actions`);
        }
      } else {
        cur = await fightStep(id);
      }
    } else {
      cur = await act(id, "前进");
    }
  }
  assert(killed, "boss never died within 300 actions");
  assert(bossActs <= 12, `boss fight took ${bossActs} actions, budget is 12`);

  for (let i = 0; i < 20 && cur.save.chapter < 2; i++) {
    cur = cur.save.combat ? await fightStep(id) : await act(id, "前进");
  }
  assert(cur.save.chapter === 2, `chapter should reach 2 after boss kill + tail landing, got ${cur.save.chapter}`);
  assert(cur.save.level >= 2, `level should be >=2 after ch1 run, got ${cur.save.level}`);
  assert(cur.save.kills >= 1, `kills should be >=1 after boss kill, got ${cur.save.kills}`);
}

// ── C) 逃生阀：逃跑成功撤到上一场景不掉血；再入冷却；原地攻击叫阵 ──
{
  const id = await makeSave("ch1-boss-escape");
  await toScene(id, PREV_SCENE); // 站上 boss 房门口，不触发守关者
  let cur = await act(id, "前进"); // 踏入 boss 房，必遇守关者
  assert(cur.save.combat && cur.save.combat.enemy.boss, `expected boss combat at ${bossScene.id}`);

  // 逃跑直到成功（失败才吃反击；低血先嗑药防翻车）。成功回合 HP 不得再掉。
  let fled = false;
  for (let i = 0; i < 15 && !fled; i++) {
    const before = cur.save;
    const { save: s, inventory } = await fetchSaveView(id);
    const low = s.hp <= Math.max(30, s.max_hp * 0.35);
    cur = await act(id, low && hasHealer(inventory) ? "使用道具" : "逃跑");
    assert(cur.save.deaths === 0, "died inside the escape-valve loop — boss still out-damages a fleeing Lv.1");
    if (!cur.save.combat && /成功逃跑|脱离战斗/.test(cur.reply.content)) {
      fled = true;
      if (!low) {
        assert(
          cur.save.hp === before.hp,
          `successful flee must not take a counterattack: hp ${before.hp} -> ${cur.save.hp}`
        );
      }
    }
  }
  assert(fled, "flee never succeeded within 15 attempts");
  assert(
    cur.save.scene === PREV_SCENE,
    `flee should retreat to previous chain scene ${PREV_SCENE}, got ${cur.save.scene}`
  );

  // 下一步再进 boss 房：冷却生效，不强制重遇同一 boss。
  cur = await act(id, "前进");
  assert(cur.save.scene === bossScene.id, `re-entry should land on ${bossScene.id}, got ${cur.save.scene}`);
  assert(!cur.save.combat || !cur.save.combat.enemy.boss, "cooldown re-entry must not force the same boss");

  // 但原地「攻击」= 主动叫阵，守关者仍可被挑战。
  if (!cur.save.combat) cur = await act(id, "攻击");
  assert(
    cur.save.combat && cur.save.combat.enemy.boss,
    "deliberate 攻击 inside boss room should re-challenge the guardian"
  );
}

// ── D) 濒死觉醒：首死 +1 级并接入 ch1_death；二死纯回溯；再进房能打死 ──
{
  const id = await makeSave("ch1-boss-awaken");
  await toScene(id, PREV_SCENE);
  let cur = await act(id, "前进");
  assert(cur.save.combat && cur.save.combat.enemy.boss, "expected boss combat for death #1");
  const preLv = cur.save.level;
  const preFp = cur.save.free_points;

  // 全程「防御」逼出死亡——防御不杀伤敌人，守关者必然把玩家磨倒。
  let died1 = null;
  for (let i = 0; i < 80 && !died1; i++) {
    cur = await act(id, "防御");
    if (cur.save.deaths >= 1) died1 = cur;
  }
  assert(died1, "never died defending vs ch1 boss (80 turns)");
  assert(died1.reply.content.includes("倒下"), `death reply missing 倒下: ${died1.reply.content.slice(-200)}`);
  assert(died1.reply.content.includes("回溯"), `death reply missing 回溯: ${died1.reply.content.slice(-200)}`);
  assert(
    stripWs(died1.reply.content).includes(DEATH_FRAG),
    "first ch1 death must surface the ch1_death near-death scene text"
  );
  assert(
    /觉醒|提前完成绑定|适格/.test(died1.reply.content),
    `awakening broadcast missing: ${died1.reply.content.slice(-200)}`
  );
  assert(died1.save.level === preLv + 1, `awakening should grant +1 level: ${preLv} -> ${died1.save.level}`);
  assert(
    died1.save.free_points > preFp,
    `awakening should grant free points: ${preFp} -> ${died1.save.free_points}`
  );
  assert(died1.save.deaths === 1, `deaths should be 1, got ${died1.save.deaths}`);
  assert(died1.save.scene === CHAIN_HEAD, `rewind should land on chain head ${CHAIN_HEAD}, got ${died1.save.scene}`);
  assert(died1.save.combat === null, "stale combat after death");
  const expectedHp = Math.round(died1.save.max_hp * 0.5);
  assert(Math.abs(died1.save.hp - expectedHp) <= 1, `revived hp ${died1.save.hp} != ~50% of new max ${died1.save.max_hp}`);

  // 死亡 #2：重生后再进 boss 房继续「防御」到死——觉醒只发一次，
  // 这次必须是纯回溯（无【觉醒】行、等级不再跳）。
  await toScene(id, PREV_SCENE);
  cur = await act(id, "前进");
  if (!cur.save.combat) cur = await act(id, "攻击"); // 冷却期则叫阵
  assert(cur.save.combat && cur.save.combat.enemy.boss, "expected boss combat for death #2");
  const lvAfter1 = cur.save.level;
  let died2 = null;
  for (let i = 0; i < 100 && !died2; i++) {
    cur = await act(id, "防御");
    if (cur.save.deaths >= 2) died2 = cur;
  }
  assert(died2, "second death never happened");
  assert(died2.reply.content.includes("回溯"), `death #2 missing 回溯: ${died2.reply.content.slice(-200)}`);
  assert(!/觉醒|提前完成绑定/.test(died2.reply.content), "awakening must fire only once");
  assert(died2.save.level === lvAfter1, `no awakening on death #2: level ${lvAfter1} -> ${died2.save.level}`);
  assert(died2.save.deaths === 2, `deaths should be 2, got ${died2.save.deaths}`);

  // 第三次再进 boss 房：这次真打——觉醒后的成长必须兑现为击杀，
  // 死亡→重生→再进房不再是零收益循环。
  await toScene(id, PREV_SCENE);
  cur = await act(id, "前进");
  if (!cur.save.combat) cur = await act(id, "攻击");
  assert(cur.save.combat && cur.save.combat.enemy.boss, "expected boss combat for the revenge run");
  const killsBefore = cur.save.kills;
  const xpBefore = cur.save.xp;
  let acts = 0;
  let killed = false;
  for (let i = 0; i < 20 && !killed; i++) {
    const { save: s } = await fetchSaveView(id);
    if (!s.combat) break;
    acts++;
    cur = await fightStep(id);
    if (!cur.save.combat && /击败/.test(cur.reply.content)) killed = true;
    else assert(cur.save.hp > 0, "awakened retry must not die to the same boss");
  }
  assert(killed, `awakened retry failed to kill the boss within ${acts} actions`);
  assert(acts <= 14, `awakened retry took ${acts} actions — compensation bought nothing`);
  assert(cur.save.kills === killsBefore + 1, "revenge kill must count kills");
  assert(cur.save.xp > xpBefore || cur.save.level > lvAfter1, "revenge kill granted no XP — zero-yield loop");
  const cleared = Array.isArray(cur.save.boss_cleared) ? cur.save.boss_cleared : [];
  assert(cleared.includes("ch1"), `boss_cleared missing ch1: ${JSON.stringify(cleared)}`);
}

ok("OK");
