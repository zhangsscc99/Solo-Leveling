// Self-checking test for the ending engine: `node --test server/engine/ending.test.js`.
//
// Covers the hasCleared gate (epilogue scene only, not chapter>=8), real-value
// pass-through (no sample placeholders), frozen clear_time from cleared_at,
// kills/Beru derived text, template rendering, and the buildEnding shape
// against the real ch8 epilogue scene.

const test = require("node:test");
const assert = require("node:assert/strict");

const ending = require("./ending");
const chapters = require("./chapters");

function fakeSave(overrides = {}) {
  return {
    id: 1,
    player_name: "tester",
    level: 57,
    kills: 3,
    chapter: 8,
    scene: "ch8_epilogue",
    created_at: "2026-11-15 10:00:00",
    cleared_at: "2026-11-15 11:00:00",
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
          lines: ["等级 {level} · 总击杀 {kills}", "{achievement}", "耗时 {clear_time} · {unknown}"],
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

test("formatDuration：负数 / NaN / 非数 → 0:00:00；>99 小时 → —", () => {
  assert.equal(ending.formatDuration(-5000), "0:00:00");
  assert.equal(ending.formatDuration(NaN), "0:00:00");
  assert.equal(ending.formatDuration("x"), "0:00:00");
  assert.equal(ending.formatDuration(undefined), "0:00:00");
  assert.equal(ending.formatDuration(99 * 3600 * 1000), "99:00:00");
  assert.equal(ending.formatDuration(100 * 3600 * 1000), "—");
  assert.equal(ending.formatDuration(60254 * 3600 * 1000), "—");
});

// --- parseCreatedAt --------------------------------------------------------

test("parseCreatedAt：无时区后缀按 UTC，带 Z/±offset 直接解析，非法 → NaN", () => {
  assert.equal(ending.parseCreatedAt("2026-11-15 10:00:00"), Date.parse("2026-11-15T10:00:00Z"));
  assert.equal(ending.parseCreatedAt("2026-11-15T10:00:00Z"), Date.parse("2026-11-15T10:00:00Z"));
  assert.equal(ending.parseCreatedAt("2026-11-15T18:00:00+08:00"), Date.parse("2026-11-15T10:00:00Z"));
  assert.ok(Number.isNaN(ending.parseCreatedAt("not-a-date")));
  assert.ok(Number.isNaN(ending.parseCreatedAt("")));
  assert.ok(Number.isNaN(ending.parseCreatedAt(42)));
});

// --- hasCleared ------------------------------------------------------------

test("hasCleared：仅当前场景解析为 ch8_epilogue 才算通关", () => {
  assert.equal(ending.hasCleared(fakeSave()), true);
  // chapter=8 但人还在章内场景 / 无 scene → 未通关（不能只看 chapter>=8）
  assert.equal(ending.hasCleared(fakeSave({ scene: "ch8_beru" })), false);
  assert.equal(ending.hasCleared(fakeSave({ scene: null })), false);
  assert.equal(ending.hasCleared(fakeSave({ chapter: 3, scene: "ch3_retest" })), false);
  // scene 不属于 save.chapter → 回退首场景，仍不算通关
  assert.equal(ending.hasCleared(fakeSave({ chapter: 3, scene: "ch8_epilogue" })), false);
  assert.equal(ending.hasCleared(null), false);
  assert.equal(ending.hasCleared({}), false);
});

// --- buildStats ------------------------------------------------------------

test("buildStats：真实值透传 level 57 / kills 3 / shadows 2，clear_time 冻结", () => {
  const stats = ending.buildStats({
    save: fakeSave(),
    shadows: [{ id: "a" }, { id: "b" }],
  });
  assert.equal(stats.level, 57);
  assert.equal(stats.kills, 3);
  assert.equal(stats.shadows, 2);
  assert.equal(stats.chapters_cleared, 8);
  assert.equal(stats.clear_time, "1:00:00");
});

test("buildStats：clear_time 由 cleared_at 冻结，缺时间戳/解析失败 → —", () => {
  const frozen = ending.buildStats({ save: fakeSave(), shadows: 0 });
  assert.equal(frozen.clear_time, "1:00:00");

  const noCleared = ending.buildStats({ save: fakeSave({ cleared_at: null }), shadows: 0 });
  assert.equal(noCleared.clear_time, "—");

  const bad = ending.buildStats({ save: fakeSave({ created_at: "not-a-date" }), shadows: 0 });
  assert.equal(bad.clear_time, "—");

  const empty = ending.buildStats();
  assert.deepEqual(empty, { level: 0, kills: 0, shadows: 0, clear_time: "—", chapters_cleared: 0 });
});

test("buildStats：clear_time 不随 now 漂移（同一存档两次结算值相同）", () => {
  const a = ending.buildStats({ save: fakeSave(), shadows: 0 });
  const b = ending.buildStats({ save: fakeSave(), shadows: 0 });
  assert.equal(a.clear_time, b.clear_time);
});

test("buildStats：shadows 兼容计数入参与缺失输入", () => {
  assert.equal(ending.buildStats({ save: fakeSave(), shadows: 7 }).shadows, 7);
  assert.equal(ending.buildStats({ save: fakeSave() }).shadows, 0);
  assert.equal(ending.buildStats({ save: fakeSave(), shadows: "x" }).shadows, 0);
});

test("buildStats：chapters_cleared 到 epilogue 才是 8，否则按章推导", () => {
  assert.equal(ending.buildStats({ save: fakeSave() }).chapters_cleared, 8);
  // chapter=8 未到 epilogue → 已通 7 章，不再当作全通
  assert.equal(ending.buildStats({ save: fakeSave({ scene: "ch8_jeju" }) }).chapters_cleared, 7);
  assert.equal(ending.buildStats({ save: fakeSave({ chapter: 5, scene: null }) }).chapters_cleared, 4);
  assert.equal(ending.buildStats({ save: fakeSave({ chapter: 1, scene: null }) }).chapters_cleared, 0);
  assert.equal(
    ending.buildStats({ save: fakeSave(), chaptersCleared: 8 }).chapters_cleared,
    8
  );
});

// --- kills / achievement 派生文案 -------------------------------------------

test("killsText：0/缺省 → —（未统计），真实值透传", () => {
  assert.equal(ending.killsText(0), "—");
  assert.equal(ending.killsText(undefined), "—");
  assert.equal(ending.killsText(341), "341");
});

test("achievementText：Beru 按真实影子派生，无影子收中性文案", () => {
  assert.match(ending.achievementText([]), /^战绩结算：S 级传送门攻略完成，济州岛战役生还。$/);
  assert.ok(!ending.achievementText([]).includes("Beru"));
  const noBeru = ending.achievementText([{ id: "shadow_igris", name: "Igris" }]);
  assert.ok(!noBeru.includes("Beru"));
  assert.ok(noBeru.includes("影子军团 ×1"));
  const beru = ending.achievementText([
    { id: "shadow_beru", name: "Beru" },
    { id: "shadow_igris", name: "Igris" },
  ]);
  assert.ok(beru.includes("获得影子「Beru」"));
  assert.ok(beru.includes("影子军团 ×2"));
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
  const e = ending.buildEnding({ save: fakeSave(), shadows: [{ id: "x" }], chapter: fakeChapter() });
  assert.equal(e.chapter, 8);
  assert.equal(e.title, "通关统计");
  assert.ok(e.epilogue.length > 0);
  assert.equal(e.stats.level, 57);
  assert.equal(e.stats.kills, 3); // stats 保留原始数字
  assert.equal(e.stats.shadows, 1);
  assert.deepEqual(e.lines, [
    "等级 57 · 总击杀 3",
    "战绩结算：S 级传送门攻略完成，济州岛战役生还，影子军团 ×1。",
    "耗时 1:00:00 · {unknown}",
  ]);
  assert.ok(!("sample" in e));
  assert.ok(!("fields" in e));
});

test("buildEnding：kills=0 的存档渲染成 —，不显示假战绩 0", () => {
  const e = ending.buildEnding({ save: fakeSave({ kills: 0 }), shadows: 0, chapter: fakeChapter() });
  assert.equal(e.stats.kills, 0);
  assert.ok(e.lines[0].includes("总击杀 —"));
});

test("buildEnding：真数据 ch8 能取到 epilogue 且 stats 块无占位字段/硬编码断言", () => {
  const data = chapters.loadChapters();
  const ch8 = data.chapters.find((c) => c.index === 8);
  const e = ending.buildEnding({ save: fakeSave(), shadows: [], chapter: ch8 });
  assert.ok(e.epilogue.length >= 50);
  assert.ok(e.title.length > 0);
  const scene = ch8.scenes.find((s) => s.id === "ch8_epilogue");
  assert.ok(scene.stats && typeof scene.stats === "object");
  assert.ok(!("sample" in scene.stats));
  assert.ok(!("fields" in scene.stats));
  // 无 Beru 影子的存档不得宣称获得 Beru
  assert.ok(!e.lines.some((l) => l.includes("Beru")));
});
