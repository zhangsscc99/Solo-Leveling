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

test("listChapters 返回副本，改动不影响缓存", () => {
  const list = chapters.listChapters();
  list.pop();
  assert.equal(chapters.listChapters().length, 8);
});
