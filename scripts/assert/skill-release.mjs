#!/usr/bin/env node
// F081 技能释放真实结算契约（只依赖 /action 与 /saves/:id 返回）：
//   a) 交战中释放已解锁技能：MP 严格下降 = mp_cost，敌 HP 严格下降，
//      播报含技能名与伤害数字；
//   b) 冷却内再次释放同一技能 → 被拒（reply 写「冷却」），MP 不动、
//      敌 HP 不动；
//   c) MP 不足时释放 → 被拒「MP 不足」，MP 不为负；
//   d) 等级不足的锁定技能 → 被拒「等级不足」；
//   e) 无交战目标时释放 → 被拒且不扣 MP。
// 附带：拒绝路径不耗回合（combat.turn 不变）、save.skills 元数据
// 暴露 mp_cost/cooldown_remaining/can_cast。
import { assert, ok, get, makeSave, act, fetchSaveView } from "./_http.mjs";

const id = await makeSave("skill-release");
const doAct = (input) => act(id, input);
const skillMeta = (save, skillId) =>
  Array.isArray(save.skills) ? save.skills.find((k) => k.id === skillId) : null;

// ── (e) 无交战目标：已解锁技能也要被拒，MP 不扣 ─────────────────
{
  const { save } = await fetchSaveView(id);
  const meta = skillMeta(save, "tiger_fury");
  assert(meta && meta.unlocked === true, "fresh save should have tiger_fury unlocked");
  assert(meta.can_cast === false && meta.reason === "无交锋目标",
    `save.skills should report 无交锋目标 out of combat, got ${JSON.stringify(meta)}`);
  const r = await doAct("释放技能 猛虎猛击");
  assert(/没有交锋目标/.test(r.reply.content),
    `no-target cast must be refused honestly, got: ${r.reply.content.slice(0, 140)}`);
  assert(r.save.mp === save.mp, `no-target cast must not drain MP: ${save.mp} -> ${r.save.mp}`);
  assert(r.save.combat === null, "refused skill must not spawn an encounter");
}

// ── (d) 等级不足的锁定技能 → 「等级不足」，MP 不扣 ────────────────
{
  const mpBefore = (await fetchSaveView(id)).save.mp;
  const r = await doAct("释放技能 统治者之权能");
  assert(/等级不足/.test(r.reply.content),
    `locked skill must be refused with 等级不足, got: ${r.reply.content.slice(0, 140)}`);
  assert(r.save.mp === mpBefore, "locked skill must not drain MP");
}

// ── 未知技能 → 「未知技能」 ────────────────────────────────────
{
  const r = await doAct("释放技能 不存在之术");
  assert(/未知技能/.test(r.reply.content),
    `unknown skill must be refused with 未知技能, got: ${r.reply.content.slice(0, 140)}`);
}

// ── 触发遭遇（攻击保底 ≤10 次）─────────────────────────────────
let cur = null;
for (let i = 0; i < 10 && !(cur && cur.save.combat); i++) cur = await doAct("攻击");
assert(cur && cur.save.combat, "setup: no encounter within 10 攻击");

// ── (a) 释放已解锁技能：MP 精确扣 mp_cost、敌 HP 真降、播报对版 ──
// 命中判定走引擎，偶发 miss 属合法结算——miss 时耗冷却/补 MP 后重试，
// 至多 3 次真释放内必须有一次实打命中（否则伤害链路本身就是假的）。
{
  let landed = null;
  for (let attempt = 0; attempt < 3 && !landed; attempt++) {
    // 确保交战（被击杀冷却压制时走一步再引）。
    for (let i = 0; i < 12 && !cur.save.combat; i++) {
      cur = await doAct("攻击");
      if (!cur.save.combat) cur = await doAct("前进");
    }
    assert(cur.save.combat, "setup: cannot re-engage for skill cast");
    // 耗冷却、补 MP，直到技能可放。
    for (let i = 0; i < 24; i++) {
      const { save: s } = await fetchSaveView(id);
      const meta = skillMeta(s, "tiger_fury");
      if (!s.combat) break;
      if (meta && meta.can_cast) break;
      cur = await doAct(meta && meta.reason === "MP 不足" ? "使用道具 魔力药剂" : "防御");
    }
    const { save: s } = await fetchSaveView(id);
    const meta = skillMeta(s, "tiger_fury");
    if (!s.combat) continue;
    assert(meta && meta.can_cast, `setup: skill not castable: ${JSON.stringify(meta)}`);
    const r = await doAct("释放技能 猛虎猛击");
    assert(r.save.mp === s.mp - meta.mp_cost,
      `MP must drop by exactly mp_cost=${meta.mp_cost}: ${s.mp} -> ${r.save.mp}`);
    assert(/猛虎猛击/.test(r.reply.content),
      `skill broadcast must name the skill: ${r.reply.content.slice(0, 200)}`);
    const dealtDamage = r.save.combat
      ? r.save.combat.enemy.hp < s.combat.enemy.hp
      : /击败/.test(r.reply.content);
    if (dealtDamage) {
      landed = { s, r, meta };
    }
    cur = r;
  }
  assert(landed, "skill cast never dealt real damage within 3 attempts");
  const { s, r } = landed;
  assert(/\d+ 点伤害|击败/.test(r.reply.content),
    `skill broadcast must carry damage number or kill line: ${r.reply.content.slice(0, 200)}`);
  if (r.save.combat) {
    assert(r.save.combat.turn === s.combat.turn + 1, "a real cast consumes one turn");
  } else {
    assert(/击败/.test(r.reply.content), "skill kill must emit kill broadcast");
    assert(r.save.kills >= 1, "skill kill must count kills");
  }
}

// ── (b) 冷却内再发同一技能 → 「冷却」，MP/敌 HP 不动、不耗回合 ──
{
  const meta = skillMeta(cur.save, "tiger_fury");
  assert(meta && meta.cooldown_remaining > 0 && meta.can_cast === false && meta.reason === "冷却中",
    `save.skills must report cooldown after cast, got ${JSON.stringify(meta)}`);
  const mpBefore = cur.save.mp;
  const enemyHp = cur.save.combat ? cur.save.combat.enemy.hp : null;
  const turn = cur.save.combat ? cur.save.combat.turn : null;
  const r = await doAct("释放技能 猛虎猛击");
  assert(/冷却中，还需 \d+ 回合/.test(r.reply.content),
    `in-cooldown cast must be refused with 冷却中，还需 N 回合, got: ${r.reply.content.slice(0, 160)}`);
  assert(r.save.mp === mpBefore, `cooldown rejection must not drain MP: ${mpBefore} -> ${r.save.mp}`);
  if (enemyHp !== null && r.save.combat) {
    assert(r.save.combat.enemy.hp === enemyHp, "rejected cast must not damage the enemy");
    assert(r.save.combat.turn === turn, "rejected cast must not consume a turn");
  }
  cur = r;
}

// ── (c) MP 不足 → 「MP 不足」、MP 不为负 ────────────────────────
// 打防/攻击把冷却耗完、MP 磨到 <12 后再放 → 必须被「MP 不足」拒绝。
{
  let mpFail = null;
  for (let i = 0; i < 90 && !mpFail; i++) {
    const { save: s } = await fetchSaveView(id);
    assert(s.mp >= 0, `MP went negative: ${s.mp}`);
    const meta = skillMeta(s, "tiger_fury");
    if (meta && meta.can_cast) {
      cur = await doAct("释放技能 猛虎猛击");
      continue; // 真放出：MP -12，重新挂冷却
    }
    if (meta && meta.reason === "MP 不足") {
      const r = await doAct("释放技能 猛虎猛击");
      assert(/MP 不足/.test(r.reply.content),
        `low-MP cast must be refused with MP 不足, got: ${r.reply.content.slice(0, 160)}`);
      assert(r.save.mp === s.mp && r.save.mp >= 0,
        `MP 不足 rejection must not move MP: ${s.mp} -> ${r.save.mp}`);
      if (s.combat && r.save.combat) {
        assert(r.save.combat.turn === s.combat.turn, "MP 不足 rejection must not consume a turn");
      }
      mpFail = r;
      break;
    }
    // 冷却中或无目标：推一个回合耗冷却——交战中防御（不杀敌人），
    // 无交战则攻击引战；被击杀冷却压制时走一步再引。
    if (s.combat) {
      cur = await doAct("防御");
    } else {
      cur = await doAct("攻击");
      if (!cur.save.combat) cur = await doAct("前进");
    }
    assert(cur.save.hp > 0 || cur.save.mp >= 0, "unexpected state while burning cooldown");
  }
  assert(mpFail, "never reached MP 不足 state within 90 actions");
  cur = mpFail;
}

// ── 防回归：交战中放到冷却，冷却期「攻击」仍正常结算回合 ─────────
// 冷却门禁只拒技能本身——普攻必须照常推进回合（或一刀收掉敌人），
// 不被冷却误伤。中途把怪打死/被打死都按状态续推（重引/回溯后 MP 回蓝再战）。
{
  let onCd = null;
  for (let i = 0; i < 120 && !onCd; i++) {
    const { save: s } = await fetchSaveView(id);
    const meta = skillMeta(s, "tiger_fury");
    if (s.combat && meta && meta.cooldown_remaining > 0) {
      onCd = s;
      break;
    }
    if (s.combat) {
      if (meta && meta.can_cast) {
        cur = await doAct("释放技能 猛虎猛击"); // 真放：扣 MP、挂冷却（miss 也挂）
      } else if (meta && meta.reason === "MP 不足") {
        const r = await doAct("使用道具 魔力药剂");
        // 没药可喝（MP 没动）则强行撤离，靠脱战「休息」回蓝再战。
        cur = r.save.mp > s.mp ? r : await doAct("前进");
      } else {
        cur = await doAct("攻击"); // 兜底推进一回合
      }
    } else if (s.mp < 12) {
      cur = await doAct("休息"); // 脱战回蓝 +8/次
    } else {
      cur = await doAct("攻击");
      if (!cur.save.combat) cur = await doAct("前进"); // 击杀冷却压制时走一步再引
    }
  }
  assert(onCd, "setup: never got tiger_fury onto cooldown in combat");
  const turnBefore = onCd.combat.turn;
  const r = await doAct("攻击");
  if (r.save.combat) {
    assert(r.save.combat.turn === turnBefore + 1,
      `attack during skill cooldown must still settle a turn: ${turnBefore} -> ${r.save.combat.turn}`);
  } else {
    assert(/击败/.test(r.reply.content),
      `cooldown-period attack ended combat without a kill line: ${r.reply.content.slice(-160)}`);
  }
  cur = r;
}

ok("OK");
