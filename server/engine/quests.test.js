// Self-checking test for the quest engine: `node --test server/engine/quests.test.js`.
//
// Covers real-data validation, the 04:00 UTC reset boundary math, event
// detection from action inputs, daily progress folding (no double-settle),
// main quest derivation from save.chapter, and the penalty window.

const test = require("node:test");
const assert = require("node:assert/strict");

const quests = require("./quests");
const chapters = require("./chapters");

const T = (s) => new Date(s);

function questData() {
  return JSON.parse(JSON.stringify(quests.loadQuests()));
}

// --- 数据与校验 -------------------------------------------------------------

test("真数据：loadQuests 通过校验，daily 为 3 条且事件合法", () => {
  const data = quests.loadQuests();
  const result = quests.validateQuests(data);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(data.daily.length, 3);
  data.daily.forEach((d) => assert.ok(quests.VALID_EVENTS.includes(d.event)));
});

test("真数据：daily 的 event/target/reward 形状完整", () => {
  quests.loadQuests().daily.forEach((d) => {
    assert.ok(d.id && d.title && d.desc);
    assert.ok(Number.isInteger(d.target) && d.target > 0);
    assert.ok(d.reward.xp > 0 && d.reward.gold > 0);
  });
});

test("篡改：非法 event / 空 title / 越界 target 被捕获", () => {
  const badEvent = questData();
  badEvent.daily[0].event = "fly";
  assert.ok(quests.validateQuests(badEvent).errors.join("\n").includes("event 非法"));

  const badTitle = questData();
  badTitle.daily[1].title = "  ";
  assert.ok(quests.validateQuests(badTitle).errors.join("\n").includes("title"));

  const badTarget = questData();
  badTarget.daily[2].target = 0;
  assert.ok(quests.validateQuests(badTarget).errors.join("\n").includes("target"));
});

test("篡改：daily 条数越界与 reward 缺损被捕获", () => {
  const tooFew = questData();
  tooFew.daily = tooFew.daily.slice(0, 1);
  assert.ok(quests.validateQuests(tooFew).errors.join("\n").includes("2–3"));

  const badReward = questData();
  badReward.daily[0].reward = { xp: -5 };
  const text = quests.validateQuests(badReward).errors.join("\n");
  assert.ok(text.includes("reward.gold"));
  assert.ok(text.includes("reward.xp"));
});

// --- 重置边界（04:00 UTC = 13:00 KST）----------------------------------------

test("边界：lastReset/dayKey/prevDayKey 以 04:00 UTC 为界", () => {
  // 03:59 仍属于前一天（前一天 04:00 开的 quest-day）
  assert.equal(quests.lastReset(T("2026-11-15T03:59:00Z")).toISOString(), "2026-11-14T04:00:00.000Z");
  assert.equal(quests.dayKey(T("2026-11-15T03:59:00Z")), "2026-11-14");
  // 04:01 进入新的一天
  assert.equal(quests.lastReset(T("2026-11-15T04:01:00Z")).toISOString(), "2026-11-15T04:00:00.000Z");
  assert.equal(quests.dayKey(T("2026-11-15T04:01:00Z")), "2026-11-15");
  assert.equal(quests.prevDayKey(T("2026-11-15T04:01:00Z")), "2026-11-14");
  // 正好压在边界上属于新的一天
  assert.equal(quests.dayKey(T("2026-11-15T04:00:00Z")), "2026-11-15");
});

test("边界：nextReset 恒为下一个 04:00 UTC", () => {
  assert.equal(quests.nextReset(T("2026-11-15T12:00:00Z")).toISOString(), "2026-11-16T04:00:00.000Z");
  assert.equal(quests.nextReset(T("2026-11-15T04:00:00Z")).toISOString(), "2026-11-16T04:00:00.000Z");
  assert.equal(quests.nextReset(T("2026-11-15T03:00:00Z")).toISOString(), "2026-11-15T04:00:00.000Z");
});

// --- 事件识别 -----------------------------------------------------------------

test("detectEvents：前进/技能/击败各自命中，可复合", () => {
  assert.deepEqual(quests.detectEvents("前进"), ["advance"]);
  assert.deepEqual(quests.detectEvents("释放技能 瞬步"), ["skill"]);
  assert.deepEqual(quests.detectEvents("击败石像守卫"), ["kill"]);
  assert.deepEqual(quests.detectEvents("攻击"), ["kill"]);
  const both = quests.detectEvents("击败敌人后继续前进");
  assert.ok(both.includes("kill") && both.includes("advance"));
  assert.deepEqual(quests.detectEvents("休息一下"), []);
  assert.deepEqual(quests.detectEvents(""), []);
  assert.deepEqual(quests.detectEvents(null), []);
});

// --- 进度推进 -----------------------------------------------------------------

const DEFS = [
  { id: "d_kill", title: "t", desc: "d", event: "kill", target: 3, reward: { xp: 30, gold: 20 } },
  { id: "d_skill", title: "t", desc: "d", event: "skill", target: 2, reward: { xp: 20, gold: 15 } },
  { id: "d_adv", title: "t", desc: "d", event: "advance", target: 1, reward: { xp: 10, gold: 10 } },
];

test("applyDailyEvents：事件累加、封顶、完成标记", () => {
  const r1 = quests.applyDailyEvents(DEFS, [], ["kill"]);
  assert.deepEqual(r1.updates, [{ quest_id: "d_kill", progress: 1, done: false }]);
  assert.equal(r1.completed.length, 0);

  const r2 = quests.applyDailyEvents(DEFS, [{ quest_id: "d_kill", progress: 2, done: false }], ["kill", "kill"]);
  assert.deepEqual(r2.updates, [{ quest_id: "d_kill", progress: 3, done: true }]);
  assert.equal(r2.completed.length, 1);
  assert.equal(r2.completed[0].id, "d_kill");
});

test("applyDailyEvents：已完成的不再重复结算", () => {
  const rows = [{ quest_id: "d_adv", progress: 1, done: true }];
  const r = quests.applyDailyEvents(DEFS, rows, ["advance"]);
  assert.deepEqual(r.updates, []);
  assert.equal(r.completed.length, 0);
  // state 保留原值
  assert.equal(r.state.get("d_adv").done, true);
});

test("applyDailyEvents：超额事件封顶在 target", () => {
  const r = quests.applyDailyEvents(DEFS, [{ quest_id: "d_skill", progress: 1, done: false }], [
    "skill",
    "skill",
    "skill",
  ]);
  assert.equal(r.updates[0].progress, 2);
  assert.equal(r.updates[0].done, true);
});

test("mergeRewards：合计完成任务的奖励", () => {
  const total = quests.mergeRewards([DEFS[0], DEFS[2]]);
  assert.equal(total.xp, 40);
  assert.equal(total.gold, 30);
});

// --- 主线推导 -----------------------------------------------------------------

test("buildMainQuests：按 save.chapter 推导 done/active/locked", () => {
  const list = chapters.listChapters();
  const main = quests.buildMainQuests(list, { chapter: 3 }, {});
  assert.equal(main.length, 8);
  assert.equal(main[1].status, "done");
  assert.equal(main[2].status, "active");
  assert.equal(main[3].status, "locked");
  // done 进度拉满，locked 归零
  assert.equal(main[1].progress.current, main[1].progress.target);
  assert.equal(main[3].progress.current, 0);
});

test("buildMainQuests：save.scene 落在主线链上时按链位次计进度", () => {
  const list = chapters.listChapters();
  const main = quests.buildMainQuests(list, { chapter: 1, scene: "ch1_worship" }, {});
  const active = main[0];
  assert.equal(active.status, "active");
  assert.equal(active.progress.current, 3); // ch1_worship 是主线链第 3 景
  assert.equal(active.progress.target, 7); // 主线链长度，不是 scenes.length(9)
});

test("buildMainQuests：支线场景与缺省场景不与主线进度混淆", () => {
  const list = chapters.listChapters();
  // 支线场景（ch1_watch）不在主线链上 → current 归零
  const side = quests.buildMainQuests(list, { chapter: 1, scene: "ch1_watch" }, {});
  assert.equal(side[0].progress.current, 0);
  // 无 scene 的新档按主线链首场景显示 → current = 1（与 saveView 口径一致）
  const fresh = quests.buildMainQuests(list, { chapter: 1 }, {});
  assert.equal(fresh[0].progress.current, 1);
});

test("buildMainQuests：main_rewards 按章节 id 命中，否则按 index 放大", () => {
  const list = chapters.listChapters();
  const main = quests.buildMainQuests(list, { chapter: 1 }, { ch2: { xp: 7, gold: 8 } });
  assert.equal(main[1].reward.xp, 7);
  assert.ok(main[0].reward.xp > 0 && main[7].reward.xp > main[0].reward.xp);
});

// --- 每日视图与惩罚 -------------------------------------------------------------

test("buildDailyQuests：进度封顶、done 行转 status=done", () => {
  const daily = quests.buildDailyQuests(DEFS, [
    { quest_id: "d_kill", progress: 5, done: false },
    { quest_id: "d_adv", progress: 1, done: true },
  ]);
  assert.equal(daily[0].progress.current, 3);
  assert.equal(daily[0].status, "active");
  assert.equal(daily[2].status, "done");
});

test("penalty：前一日未完成且存档已存在 → 惩罚生效", () => {
  const penalty = quests.computePenalty({
    defs: DEFS,
    prevRows: [{ quest_id: "d_adv", progress: 1, done: true }], // kill/skill 没做完
    save: { created_at: "2026-11-14 10:00:00" },
    now: T("2026-11-15T05:00:00Z"), // 重置后 1h，窗口还剩 3h
    penalty: { duration_sec: 14400, desc: "惩罚副本已开启" },
  });
  assert.equal(penalty.active, true);
  assert.equal(penalty.seconds_left, 3 * 3600);
  assert.equal(penalty.desc, "惩罚副本已开启");
});

test("penalty：全部完成 / 新存档 / 窗口过期 → 不生效", () => {
  const allDone = quests.computePenalty({
    defs: DEFS,
    prevRows: DEFS.map((d) => ({ quest_id: d.id, progress: d.target, done: true })),
    save: { created_at: "2026-11-14 10:00:00" },
    now: T("2026-11-15T05:00:00Z"),
    penalty: { duration_sec: 14400, desc: "x" },
  });
  assert.equal(allDone.active, false);

  const fresh = quests.computePenalty({
    defs: DEFS,
    prevRows: [],
    save: { created_at: "2026-11-15 05:00:00" }, // 重置后才建号
    now: T("2026-11-15T06:00:00Z"),
    penalty: { duration_sec: 14400, desc: "x" },
  });
  assert.equal(fresh.active, false);

  const expired = quests.computePenalty({
    defs: DEFS,
    prevRows: [],
    save: { created_at: "2026-11-14 10:00:00" },
    now: T("2026-11-15T20:30:00Z"), // 距上次重置已 >4h，但下次重置未到
    penalty: { duration_sec: 14400, desc: "x" },
  });
  assert.equal(expired.active, false);
});

// --- 整包视图 -----------------------------------------------------------------

test("buildView：产出稳定的响应形状", () => {
  const view = quests.buildView({
    save: { chapter: 2, created_at: "2026-11-15 01:00:00" },
    data: questData(),
    chaptersData: chapters.loadChapters(),
    todayRows: [{ quest_id: "daily_hunt", progress: 1, done: false }],
    prevRows: [],
    now: T("2026-11-15T10:00:00Z"),
  });
  assert.equal(view.main.length, 8);
  assert.equal(view.daily.length, 3);
  assert.equal(view.daily_reset_at, "2026-11-16T04:00:00.000Z");
  assert.equal(view.daily[0].progress.current, 1);
  assert.ok(view.penalty && typeof view.penalty.active === "boolean");
});
