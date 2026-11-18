#!/usr/bin/env node
// F082 XP 达标即升级契约（round4：主线奖励改为守关 boss 击杀门控后的口径）：
//   1) 新档自然玩（打怪/前进/休息，真实操作）进入第 2 章前必然 level>=2、
//      free_points>0、xp_to_next 与 levels.json 当前等级行完全一致；
//      XP 来源必须是真实结算（每日任务 / 主线奖励 / 击杀），不是凭空加值。
//   2) 单笔大额入账必须跨级：ch2 守关 boss「毒牙蛇」就在主线链尾，击杀
//      同一动作同时入账击杀 XP(110) + 主线奖励(quests.json 读出 >=300 的
//      大额口径由 XP+金币构成) ——该动作前后 level 至少 +2，且出现 ≥2 条
//      「【升级】」播报。守关者未击杀时主线奖励不结算（encounter-combat.mjs
//      已覆盖负向），这里是「正常打完 boss 照样拿满奖励」的正向路径。
//   期望值全部由 levels.json / quests.json 原始数据推导，不调引擎函数。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, makeSave, act, fetchSaveView, advanceStep } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEVELS = require(path.join(ROOT, "server", "data", "levels.json"));
const QUESTS = require(path.join(ROOT, "server", "data", "quests.json"));
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

// ch1/ch2 守关 boss 房：掷逃落点不掷遭遇会「跳过」守关者，站在 boss 房
// 原地「攻击」主动召怪（boss 场景必中，不吃击杀冷却）。boss 已杀过的
// 房间降级为普通场景、吃冷却——不再召。
const BOSS_SCENE_CH = new Map(
  CHAPTERS.chapters
    .filter((c) => c.index <= 2)
    .flatMap((c) => c.scenes.filter((s) => s.kind === "boss").map((s) => [s.id, c.id]))
);

const xpToNextOf = (lv) => {
  const row = LEVELS.find((r) => r.level === lv);
  return row ? row.xpToNext : null;
};
const mainXp = (ch) => (QUESTS.main_rewards && QUESTS.main_rewards[ch] ? QUESTS.main_rewards[ch].xp : null);
assert(mainXp("ch2") >= 150, `oracle: ch2 main reward ${mainXp("ch2")} expected >= 150 xp`);

const id = await makeSave("level-up");

// 一步真实操作：
//   - 属性点一律点力量（真实 /spend 接口，提升技能伤害）；
//   - 交战中：血量告急先「使用道具」；已计 3 杀的小怪一律「前进」掷逃
//     （控制 XP 节奏，让守关 boss 击杀落在跨级窗口）；守关 boss 必打
//     ——不击杀就拿不到本章主线奖励；
//   - 无交战：血不满先「休息」，否则「前进」推主线。
let equipped = false;
const play = async () => {
  const { save: s, inventory, equipment } = await fetchSaveView(id);
  if (s.free_points > 0) {
    await post(`/saves/${id}/spend`, { stat: "strength" });
  }
  // 新手武器/护甲穿上——攻防加成是打守关 boss 的必需强度（真实 item
  // 接口，一次到位）。
  if (!equipped) {
    equipped = true;
    const slots = [equipment && equipment.weapon && equipment.weapon.id, equipment && equipment.armor && equipment.armor.id];
    for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
      if ((inventory || []).some((r) => r.item_id === itemId && r.qty > 0) && !slots.includes(itemId)) {
        await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
      }
    }
  }
  const hasHealer = (inventory || []).some(
    (r) => r.qty > 0 && ["low_heal_potion", "mid_heal_potion", "elixir_of_life"].includes(r.item_id)
  );
  if (s.combat) {
    const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
    const lowHp = s.hp > 0 && s.hp <= Math.max(30, s.max_hp * 0.35);
    if (lowHp && hasHealer) return act(id, "使用道具");
    if (!isBoss && s.kills >= 3) return act(id, "前进"); // 掷逃小怪
    // 冷却期不放技能（门禁诚实拒绝不耗回合，空放会变成零推进死循环）——
    // 读 save.skills 的 can_cast，能放才放，否则普攻。
    const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
    return act(id, castable ? `释放技能 ${castable.name}` : "攻击");
  }
  if (s.hp > 0 && s.hp < s.max_hp * 0.55) return act(id, "休息");
  // 守关者未死且人在其门口：原地「攻击」召怪，必打。
  const bossCh = BOSS_SCENE_CH.get(s.scene);
  if (bossCh && !(Array.isArray(s.boss_cleared) && s.boss_cleared.includes(bossCh))) {
    return act(id, "攻击");
  }
  // 补足击杀数：原地「攻击」掷遭遇（保底必出），让每日任务与击杀 XP
  // 落进跨级窗口；击杀冷却（encounter_cd>0）时不再空挥。
  if (s.kills < 3 && !(s.encounter_cd > 0)) return act(id, "攻击");
  // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
  return advanceStep(id);
};

// ── 1) 自然玩到第 2 章前必然 level>=2 ────────────────────────────
let cur = null;
let lv2Checked = false;
let bundleReply = null;
let prevLevel = 1;
for (let i = 0; i < 600 && !bundleReply; i++) {
  const before = cur ? cur.save.level : prevLevel;
  cur = await play();
  const s = cur.save;
  if (!lv2Checked && s.level >= 2) {
    lv2Checked = true;
    assert(s.free_points > 0, `level-up must grant free_points, got ${s.free_points}`);
    assert(
      s.xp_to_next === xpToNextOf(s.level),
      `xp_to_next ${s.xp_to_next} != levels.json ${xpToNextOf(s.level)} for Lv.${s.level}`
    );
    assert(
      s.xp >= 0 && s.xp < s.xp_to_next,
      `xp ${s.xp} out of [0, xp_to_next=${s.xp_to_next})`
    );
    assert(s.chapter <= 2, `Lv2 reached only after chapter ${s.chapter} — pacing broke`);
  }
  prevLevel = before;
  // ch2 守关 boss 在链尾：击杀动作同帧入账击杀 XP + 主线奖励。
  if (/【主线】第2章主线达成/.test(cur.reply.content)) bundleReply = cur;
}
assert(lv2Checked, `level ${cur ? cur.save.level : "?"} — never reached Lv2 in genuine play`);
assert(bundleReply, "never landed the ch2 boss-kill main reward bundle");

// ── 2) 同动作大额入账跨级：level 至少 +2 且 ≥2 条【升级】 ─────────
{
  const jump = bundleReply.save.level - prevLevel;
  assert(jump >= 2, `ch2 bundle should cross >=2 levels (Lv.${prevLevel} -> Lv.${bundleReply.save.level})`);
  const ups = (bundleReply.reply.content.match(/【升级】/g) || []).length;
  assert(ups >= 2, `multi-level reward should emit >=2 【升级】 lines, got ${ups}`);
  assert(
    bundleReply.save.xp_to_next === xpToNextOf(bundleReply.save.level),
    `post-jump xp_to_next ${bundleReply.save.xp_to_next} != levels.json ${xpToNextOf(bundleReply.save.level)}`
  );
}

ok("OK");
