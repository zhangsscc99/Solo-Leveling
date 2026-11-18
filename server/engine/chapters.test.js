// Self-checking test for the chapter loader: `node --test server/engine/chapters.test.js`.
//
// Covers the happy path (real data loads and validates), the reference graph
// (every next/next_scene resolves), and the failure modes the loader must
// catch before a broken data edit reaches the game.

const test = require("node:test");
const assert = require("node:assert/strict");

const chapters = require("./chapters");

function brokenCopy() {
  return JSON.parse(JSON.stringify(chapters.loadChapters()));
}

function errorText(errors) {
  return errors.join("\n");
}

test("真数据：loadChapters 返回 8 章，index 连续", () => {
  const list = chapters.listChapters();
  assert.equal(list.length, 8);
  list.forEach((chapter, i) => assert.equal(chapter.index, i + 1, `chapter[${i}].index`));
});

test("真数据：validateChapters 通过且无错误", () => {
  const result = chapters.validateChapters(chapters.loadChapters());
  assert.equal(result.ok, true, errorText(result.errors));
  assert.deepEqual(result.errors, []);
});

test("真数据：每章场景数达标，第 8 章有多阶段 boss", () => {
  const list = chapters.listChapters();
  list.forEach((chapter) => {
    const min = chapter.index === 1 ? 3 : 2;
    assert.ok(chapter.scenes.length >= min, `${chapter.id} 只有 ${chapter.scenes.length} 个场景`);
  });

  const finale = list[7];
  const boss = finale.scenes.find((s) => s.kind === "boss" && Array.isArray(s.phases));
  assert.ok(boss, "第 8 章缺少带 phases 的 boss 场景");
  assert.ok(boss.phases.length >= 2, "终 BOSS 阶段数不足 2");
});

test("真数据：所有 next / next_scene 引用都存在", () => {
  const ids = new Set();
  chapters.listChapters().forEach((c) => c.scenes.forEach((s) => ids.add(s.id)));

  chapters.listChapters().forEach((chapter) => {
    chapter.scenes.forEach((scene) => {
      if (scene.next_scene !== undefined && scene.next_scene !== null) {
        assert.ok(ids.has(scene.next_scene), `${scene.id}.next_scene -> ${scene.next_scene}`);
      }
      (scene.choices || []).forEach((choice) => {
        if (choice.next !== null) {
          assert.ok(ids.has(choice.next), `${scene.id}.${choice.id}.next -> ${choice.next}`);
        }
      });
    });
  });
});

test("真数据：场景 id 全局唯一、kind 合法、text 非空", () => {
  const seen = new Set();
  chapters.listChapters().forEach((chapter) => {
    chapter.scenes.forEach((scene) => {
      assert.ok(!seen.has(scene.id), `重复场景 id: ${scene.id}`);
      seen.add(scene.id);
      assert.ok(chapters.VALID_KINDS.includes(scene.kind), `非法 kind: ${scene.kind}`);
      assert.ok(scene.text.trim().length > 0, `${scene.id} text 为空`);
    });
  });
});

test("篡改：重复场景 id 被捕获", () => {
  const data = brokenCopy();
  data.chapters[1].scenes[0].id = data.chapters[0].scenes[0].id;

  const result = chapters.validateChapters(data);
  assert.equal(result.ok, false);
  assert.ok(errorText(result.errors).includes("全局重复"), errorText(result.errors));
});

test("篡改：悬空的 next_scene 与 choice.next 被捕获", () => {
  const data = brokenCopy();
  data.chapters[0].scenes[0].next_scene = "ch_does_not_exist";
  data.chapters[0].scenes[1].choices[0].next = "also_missing";

  const result = chapters.validateChapters(data);
  assert.equal(result.ok, false);
  const text = errorText(result.errors);
  assert.ok(text.includes("ch_does_not_exist"), text);
  assert.ok(text.includes("also_missing"), text);
});

test("篡改：非法 kind / 空 text / index 断裂 / 章节缺失被捕获", () => {
  const badKind = brokenCopy();
  badKind.chapters[2].scenes[0].kind = "cutscene";
  assert.ok(errorText(chapters.validateChapters(badKind).errors).includes("kind 非法"));

  const emptyText = brokenCopy();
  emptyText.chapters[3].scenes[0].text = "   ";
  assert.ok(errorText(chapters.validateChapters(emptyText).errors).includes("text"));

  const badIndex = brokenCopy();
  badIndex.chapters[3].index = 7;
  assert.ok(errorText(chapters.validateChapters(badIndex).errors).includes("index"));

  const short = brokenCopy();
  short.chapters.pop();
  const shortResult = chapters.validateChapters(short);
  assert.equal(shortResult.ok, false);
  assert.ok(errorText(shortResult.errors).includes("章节数应为 8"));
});

test("篡改：第 8 章去掉多阶段 boss 会被拒绝", () => {
  const data = brokenCopy();
  const finale = data.chapters[7];
  finale.scenes.forEach((scene) => {
    delete scene.phases;
  });

  const result = chapters.validateChapters(data);
  assert.equal(result.ok, false);
  assert.ok(errorText(result.errors).includes("phases"), errorText(result.errors));
});

test("查询：getChapter 支持 index / 数字字符串 / id", () => {
  assert.equal(chapters.getChapter(1).id, "ch1");
  assert.equal(chapters.getChapter("3").id, "ch3");
  assert.equal(chapters.getChapter("ch8").title, "济州岛");
  assert.equal(chapters.getChapter(9), null);
  assert.equal(chapters.getChapter("nope"), null);
});

test("查询：getScene 与 getChapterOfScene 一致", () => {
  const scene = chapters.getScene("ch8_beru");
  assert.ok(scene);
  assert.equal(scene.kind, "boss");
  assert.equal(chapters.getChapterOfScene("ch8_beru").id, "ch8");
  assert.equal(chapters.getScene("missing_scene"), null);
});

test("currentScene：按 save.chapter 取首个场景，场景不匹配时回退", () => {
  assert.equal(chapters.currentScene({ chapter: 1 }).id, "ch1_double_gate");
  assert.equal(chapters.currentScene({ chapter: 8, scene: "ch8_beru" }).id, "ch8_beru");
  // ch1 的场景不属于 ch3 —— 必须回退到 ch3 的首个场景
  assert.equal(chapters.currentScene({ chapter: 3, scene: "ch1_awaken" }).id, "ch3_association");
  assert.equal(chapters.currentScene({ chapter: 99 }), null);
  assert.equal(chapters.currentScene(null), null);
});

test("chapterPath：主线链只沿 next_scene/主线 choice 走，支线不入链", () => {
  const ch1 = chapters.getChapter(1);
  assert.deepEqual(
    chapters.chapterPath(ch1).map((s) => s.id),
    [
      "ch1_double_gate",
      "ch1_law",
      "ch1_worship",
      "ch1_statues",
      "ch1_system",
      "ch1_awaken",
      "ch1_surface",
    ]
  );
  // 支线场景不占主线步序
  assert.equal(chapters.pathIndexOf(ch1, "ch1_watch"), -1);
  assert.equal(chapters.pathIndexOf(ch1, "ch1_death"), -1);
  // ch8_beru.next_scene 为空，主线靠 choice final -> ch8_aftermath 续链到 epilogue
  assert.deepEqual(
    chapters.chapterPath(chapters.getChapter(8)).map((s) => s.id),
    ["ch8_jeju", "ch8_nest", "ch8_beru", "ch8_aftermath", "ch8_epilogue"]
  );
});

// F246：支线站位按「下一个可达主线链节点」反推——不丢已走过的里程碑
// （旧口径不在链上恒 0/N），也不虚增到链尾；断线支线兜底 0。
test("progressStepsOf：链上 = 位置+1，支线 = 下一个主线节点下标", () => {
  const ch1 = chapters.getChapter(1);
  // 链上站位照旧
  assert.equal(chapters.progressStepsOf(ch1, "ch1_double_gate"), 1);
  assert.equal(chapters.progressStepsOf(ch1, "ch1_law"), 2);
  assert.equal(chapters.progressStepsOf(ch1, "ch1_surface"), 7);
  // 支线站位反推：ch1_watch 的 next_scene=ch1_worship（链上第 3 景）→ 2
  assert.equal(chapters.progressStepsOf(ch1, "ch1_watch"), 2);
  // ch1_death 无 next_scene，靠 choice crawl_back -> ch1_worship 收进链 → 2
  assert.equal(chapters.progressStepsOf(ch1, "ch1_death"), 2);
  // 悬空/错章 id 兜底 0
  assert.equal(chapters.progressStepsOf(ch1, "nope"), 0);
  assert.equal(chapters.progressStepsOf(ch1, null), 0);

  // 合成章节覆盖三种边角：
  //   a) 支线直通链尾 → 只记到链尾下标（虚增到 N/N 是洗绿口径）；
  //   b) 支线绕两跳回主线 → 取最近命中；
  //   c) 彻底断线的收束支线 → 安全兜底 0。
  const fake = {
    scenes: [
      { id: "m0", next_scene: "m1" },
      { id: "m1", next_scene: "m2" },
      { id: "m2", next_scene: null },
      { id: "s_tail", choices: [{ id: "go", next: "m2" }] },
      { id: "s_mid", next_scene: "s_hop" },
      { id: "s_hop", next_scene: "m1" },
      { id: "s_dead", next_scene: null, choices: [{ id: "x", next: null }] },
    ],
  };
  assert.equal(chapters.progressStepsOf(fake, "s_tail"), 2);
  assert.equal(chapters.progressStepsOf(fake, "s_mid"), 1);
  assert.equal(chapters.progressStepsOf(fake, "s_dead"), 0);
});

test("unlockedFor：软门放行但 level_ok 单独暴露", () => {
  const ch2 = chapters.getChapter(2); // unlock { level: 5, chapter: 1 }
  const low = chapters.unlockedFor({ level: 1, chapter: 1 }, ch2);
  assert.equal(low.ok, true); // 前置章节腿满足 → 软门放行
  assert.equal(low.level_ok, false);
  assert.equal(low.chapter_ok, true);
  assert.equal(low.level, 5);
  const high = chapters.unlockedFor({ level: 5, chapter: 1 }, ch2);
  assert.equal(high.ok, true);
  assert.equal(high.level_ok, true);
  // 无任何门槛的章节直接放行
  const open = chapters.unlockedFor({ level: 0, chapter: 0 }, { index: 1 });
  assert.equal(open.ok, true);
});

test("listChapters 返回副本，改动不影响缓存", () => {
  const list = chapters.listChapters();
  list.pop();
  assert.equal(chapters.listChapters().length, 8);
});

// --- Ch1 双地下城（F041） ---------------------------------------------------

test("真数据：Ch1 从首个场景可达全部节点，无孤立场景", () => {
  chapters.listChapters().forEach((chapter) => {
    const byId = new Map(chapter.scenes.map((s) => [s.id, s]));
    const seen = new Set([chapter.scenes[0].id]);
    const queue = [chapter.scenes[0].id];

    while (queue.length) {
      const scene = byId.get(queue.shift());
      if (!scene) continue;
      const outs = [];
      if (typeof scene.next_scene === "string") outs.push(scene.next_scene);
      (scene.choices || []).forEach((c) => {
        if (c.next !== null && c.next !== undefined) outs.push(c.next);
      });
      outs.forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      });
    }

    chapter.scenes.forEach((scene) => {
      assert.ok(seen.has(scene.id), `${chapter.id} 存在孤立场景: ${scene.id}`);
    });
  });
});

test("真数据：Ch1 覆盖双地下城关键剧情节点", () => {
  const ch1 = chapters.getChapter(1);
  const ids = ch1.scenes.map((s) => s.id);
  [
    "ch1_double_gate",
    "ch1_law",
    "ch1_death",
    "ch1_worship",
    "ch1_statues",
    "ch1_system",
    "ch1_awaken",
    "ch1_surface",
  ].forEach((id) => assert.ok(ids.includes(id), `Ch1 缺少场景 ${id}`));

  // 石像守卫必须仍是 boss 场景，觉醒后的收尾必须收束到地面结局。
  assert.equal(chapters.getScene("ch1_statues").kind, "boss");
  assert.equal(chapters.getScene("ch1_surface").next_scene, null);
});

test("真数据：Ch1 存在错误选择→濒死/死亡分支与观察/潜行分支", () => {
  const ch1 = chapters.getChapter(1);
  const choices = ch1.scenes.flatMap((s) => (s.choices || []).map((c) => ({ scene: s.id, ...c })));

  const toDeath = choices.filter((c) => c.next === "ch1_death");
  assert.ok(toDeath.length >= 1, "缺少指向濒死节点的错误选择");

  const deathEnding = ch1.scenes
    .find((s) => s.id === "ch1_death")
    .choices.some((c) => c.next === null);
  assert.ok(deathEnding, "濒死节点缺少死亡结局选项");

  const observe = ch1.scenes
    .find((s) => s.id === "ch1_law")
    .choices.find((c) => c.next === "ch1_watch");
  assert.ok(observe, "ch1_law 缺少观察分支");
  assert.equal(observe.effects.flag, "read_the_law");
});

test("真数据：Ch1 的 requires/effects 写法被现有校验接受", () => {
  const result = chapters.validateChapters(chapters.loadChapters());
  assert.equal(result.ok, true, errorText(result.errors));

  const stare = chapters
    .getScene("ch1_worship")
    .choices.find((c) => c.id === "stare");
  assert.deepEqual(stare.requires, { flag: "saw_statue_eyes" });

  const accept = chapters
    .getScene("ch1_system")
    .choices.find((c) => c.id === "accept");
  assert.deepEqual(accept.effects, { xp: 30, flag: "system_bound" });
});

test("篡改：非法 requires / effects 被捕获", () => {
  const badRequireKey = brokenCopy();
  badRequireKey.chapters[0].scenes[4].choices[0].requires = { luck: 5 };
  assert.ok(
    errorText(chapters.validateChapters(badRequireKey).errors).includes("requires 含未知字段")
  );

  const badRequireValue = brokenCopy();
  badRequireValue.chapters[0].scenes[4].choices[0].requires = { min_level: 0 };
  assert.ok(
    errorText(chapters.validateChapters(badRequireValue).errors).includes("min_level")
  );

  const badEffectKey = brokenCopy();
  badEffectKey.chapters[0].scenes[0].choices[1].effects = { karma: 1 };
  assert.ok(
    errorText(chapters.validateChapters(badEffectKey).errors).includes("effects 含未知字段")
  );

  const badEffectValue = brokenCopy();
  badEffectValue.chapters[0].scenes[0].choices[1].effects = { xp: -10 };
  assert.ok(errorText(chapters.validateChapters(badEffectValue).errors).includes("effects.xp"));

  const emptyEffects = brokenCopy();
  emptyEffects.chapters[0].scenes[0].choices[1].effects = {};
  assert.ok(
    errorText(chapters.validateChapters(emptyEffects).errors).includes("effects 必须是非空对象")
  );
});
