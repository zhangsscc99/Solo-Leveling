// Self-checking test for the ending engine: `node --test server/engine/ending.test.js`.
//
// Covers real-value pass-through (no sample placeholders), zero-kill saves,
// clear_time formatting and illegal-input degradation, template rendering,
// and the buildEnding shape against the real ch8 epilogue scene.

const test = require("node:test");
const assert = require("node:assert/strict");

const ending = require("./ending");
const chapters = require("./chapters");

const HOUR = 3600 * 1000;

function fakeSave(overrides = {}) {
  return {
    id: 1,
    player_name: "tester",
    level: 57,
    kills: 3,
    chapter: 8,
    created_at: "2026-11-15 10:00:00",
    ...overrides,
  };
}

function fakeChapter() {
  return {
    index: 8,
    scenes: [
      {
        id: "ch8_epilogue",
        title: "结局",
        kind: "story",
        text: "回国的船离岸时，济州岛在身后缩成一道灰色的线。",
        stats: {
          title: "通关统计",
          lines: ["等级 {level} · 总击杀 {kills}", "耗时 {clear_time} · {unknown}"],
        },
      },
    ],
  };
}

// --- formatDuration --------------------------------------------------------

test("formatDuration：3723000 → 1:02:03，分钟秒补零", () => {
  assert.equal(ending.formatDuration(3723000), "1:02:03");
  assert.equal(ending.formatDuration(3661000), "1:01:01");
  assert.equal(ending.formatDuration(0), "0:00:00");
});

test("formatDuration：负数 / NaN / 非数 → 0:00:00", () => {
  assert.equal(ending.formatDuration(-5000), "0:00:00");
  assert.equal(ending.formatDuration(NaN), "0:00:00");
  assert.equal(ending.formatDuration("x"), "0:00:00");
  assert.equal(ending.formatDuration(undefined), "0:00:00");
});

// --- buildStats ------------------------------------------------------------

test("buildStats：真实值透传 level 57 / kills 3 / shadows 2", () => {
  const now = Date.parse("2026-11-15T11:00:00Z");
  const stats = ending.buildStats({
    save: fakeSave(),
    shadows: [{ id: "a" }, { id: "b" }],
    now,
  });
  assert.equal(stats.level, 57);
  assert.equal(stats.kills, 3);
  assert.equal(stats.shadows, 2);
  assert.equal(stats.chapters_cleared, 8);
  assert.match(stats.clear_time, /^1:00:0\d$/);
});

test("buildStats：0 击杀存档如实输出 0，不回落示例数字", () => {
  const stats = ending.buildStats({ save: fakeSave({ kills: 0 }), shadows: [], now: Date.now() });
  assert.equal(stats.kills, 0);
  assert.equal(stats.shadows, 0);
});

test("buildStats：shadows 兼容计数入参与缺失输入", () => {
  const now = Date.parse("2026-11-15T11:00:00Z");
  assert.equal(ending.buildStats({ save: fakeSave(), shadows: 7, now }).shadows, 7);
  assert.equal(ending.buildStats({ save: fakeSave(), now }).shadows, 0);
  assert.equal(ending.buildStats({ save: fakeSave(), shadows: "x", now }).shadows, 0);
});

test("buildStats：clear_time 由 created_at(UTC) 到 now 求差；非法输入降级", () => {
  const now = Date.parse("2026-11-15T12:30:15Z"); // 2:30:15 后
  const s1 = ending.buildStats({ save: fakeSave(), shadows: 0, now });
  assert.equal(s1.clear_time, "2:30:15");

  const bad = ending.buildStats({ save: fakeSave({ created_at: "not-a-date" }), shadows: 0, now });
  assert.equal(bad.clear_time, "0:00:00");

  const noNow = ending.buildStats({ save: fakeSave(), shadows: 0 });
  assert.equal(noNow.clear_time, "0:00:00");

  const empty = ending.buildStats();
  assert.deepEqual(empty, { level: 0, kills: 0, shadows: 0, clear_time: "0:00:00", chapters_cleared: 0 });
});

test("buildStats：chapters_cleared 显式入参优先，否则按章节推导", () => {
  const now = Date.parse("2026-11-15T11:00:00Z");
  assert.equal(ending.buildStats({ save: fakeSave({ chapter: 8 }), shadows: 0, now }).chapters_cleared, 8);
  assert.equal(ending.buildStats({ save: fakeSave({ chapter: 5 }), shadows: 0, now }).chapters_cleared, 4);
  assert.equal(ending.buildStats({ save: fakeSave({ chapter: 1 }), shadows: 0, now }).chapters_cleared, 0);
  assert.equal(
    ending.buildStats({ save: fakeSave(), shadows: 0, now, chaptersCleared: 8 }).chapters_cleared,
    8
  );
});

// --- renderLines ------------------------------------------------------------

test("renderLines：占位符替换，未知占位符原样保留", () => {
  const stats = { level: 57, kills: 3, shadows: 2, clear_time: "1:00:00", chapters_cleared: 8 };
  const out = ending.renderLines(["等级 {level} · 击杀 {kills}", "{foo} {clear_time}"], stats);
  assert.deepEqual(out, ["等级 57 · 击杀 3", "{foo} 1:00:00"]);
});

test("renderLines：非数组输入 → 空数组", () => {
  assert.deepEqual(ending.renderLines(null, {}), []);
  assert.deepEqual(ending.renderLines(undefined, {}), []);
});

// --- buildEnding ------------------------------------------------------------

test("buildEnding：结构 {chapter,title,epilogue,stats,lines} 且不含 sample", () => {
  const now = Date.parse("2026-11-15T11:00:00Z");
  const e = ending.buildEnding({ save: fakeSave(), shadows: [{ id: "x" }], chapter: fakeChapter(), now });
  assert.equal(e.chapter, 8);
  assert.equal(e.title, "通关统计");
  assert.ok(e.epilogue.length > 0);
  assert.equal(e.stats.level, 57);
  assert.equal(e.stats.kills, 3);
  assert.equal(e.stats.shadows, 1);
  assert.deepEqual(e.lines, ["等级 57 · 总击杀 3", "耗时 1:00:00 · {unknown}"]);
  assert.ok(!("sample" in e));
  assert.ok(!("fields" in e));
});

test("buildEnding：真数据 ch8 能取到 epilogue 且 stats 块无占位字段", () => {
  const data = chapters.loadChapters();
  const ch8 = data.chapters.find((c) => c.index === 8);
  const e = ending.buildEnding({ save: fakeSave(), shadows: [], chapter: ch8, now: Date.now() });
  assert.ok(e.epilogue.length >= 50);
  assert.ok(e.title.length > 0);
  const scene = ch8.scenes.find((s) => s.id === "ch8_epilogue");
  assert.ok(scene.stats && typeof scene.stats === "object");
  assert.ok(!("sample" in scene.stats));
  assert.ok(!("fields" in scene.stats));
});
