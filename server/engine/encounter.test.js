// Self-checking test for the encounter engine: `node --test server/engine/encounter.test.js`.
//
// Covers the F161 streak mechanics on top of the F088/F115 baseline:
//   - encounters:"none" scenes stay spawn-free until the advance streak hits
//     STREAK_THRESHOLD, then roll with the escalated chance;
//   - the streak bonus is linear (+STREAK_PER_ADVANCE per step past the
//     threshold) and capped by MAX_CHANCE;
//   - baseline contracts unchanged: boss scenes always hit, pity still fires,
//     "none" scenes without streak never roll.

const test = require("node:test");
const assert = require("node:assert/strict");

const E = require("./encounter");
const { createRng } = require("./rng");

const NONE_SCENE = { id: "hospital", kind: "rest", encounters: "none" };
const DUNGEON_SCENE = { id: "hall", kind: "dungeon" };
const BOSS_SCENE = { id: "gate", kind: "boss" };

function hitCount(scene, streak, seeds = 400) {
  let n = 0;
  for (let i = 0; i < seeds; i++) {
    if (
      E.roll({ chapterIndex: 1, scene, clock: 0, seed: `t${i}`, streak })
    ) {
      n++;
    }
  }
  return n;
}

test("streakBonus：阈值前为 0，阈值后线性 +STREAK_PER_ADVANCE", () => {
  assert.equal(E.streakBonus(0), 0);
  assert.equal(E.streakBonus(E.STREAK_THRESHOLD - 1), 0);
  assert.equal(E.streakBonus(E.STREAK_THRESHOLD), E.STREAK_PER_ADVANCE);
  assert.equal(
    E.streakBonus(E.STREAK_THRESHOLD + 2),
    3 * E.STREAK_PER_ADVANCE
  );
});

test("encounters:none 场景 streak<阈值时永不掷怪（含 pity 到顶）", () => {
  for (let streak = 0; streak < E.STREAK_THRESHOLD; streak++) {
    for (let i = 0; i < 50; i++) {
      assert.equal(
        E.roll({ chapterIndex: 1, scene: NONE_SCENE, clock: 0, seed: `s${i}`, streak }),
        null,
        `streak=${streak} 的 none 场景掷出了怪`
      );
      // pity 计数到顶也不得越过 none 契约。
      assert.equal(
        E.roll({
          chapterIndex: 1,
          scene: NONE_SCENE,
          clock: E.PITY_LIMIT,
          seed: `p${i}`,
          streak,
        }),
        null,
        `streak=${streak} 的 none 场景被 pity 击穿`
      );
    }
  }
});

test("encounters:none 场景 streak>=阈值起允许按叠加概率掷点", () => {
  const hits = hitCount(NONE_SCENE, E.STREAK_THRESHOLD);
  assert.ok(hits > 0, "streak 达阈值后 none 场景仍不掷怪");
});

test("疾行加成线性抬高普通场景遇敌率（单调且封顶 MAX_CHANCE）", () => {
  const base = hitCount(DUNGEON_SCENE, 0);
  const raised = hitCount(DUNGEON_SCENE, E.STREAK_THRESHOLD + 4);
  assert.ok(raised > base, `疾行命中数 ${raised} 未高于基线 ${base}`);
  // 封顶验证：streak 加成再高，命中集合也不得越过 MAX_CHANCE——
  // 与同种子集上 rng.chance(0.75) 的理论命中数逐一相等。
  const capped = hitCount(DUNGEON_SCENE, E.STREAK_THRESHOLD + 100);
  let expected = 0;
  for (let i = 0; i < 400; i++) {
    if (createRng(`encounter-roll:1:${DUNGEON_SCENE.id}:t${i}`).chance(0.75)) expected++;
  }
  assert.equal(capped, expected, `封顶后命中 ${capped} ≠ MAX_CHANCE 理论值 ${expected}`);
});

test("kind=boss 场景必中，与 streak 无关", () => {
  for (const streak of [0, 1, E.STREAK_THRESHOLD, E.STREAK_THRESHOLD + 9]) {
    const enemy = E.roll({
      chapterIndex: 2,
      scene: BOSS_SCENE,
      clock: 0,
      seed: `b${streak}`,
      streak,
    });
    assert.ok(enemy, `streak=${streak} 时 boss 场景未命中`);
    assert.equal(enemy.boss, true);
  }
});

test("基线不变：无 streak 时 pity 到顶必中、地下城场景按率掷点", () => {
  const pity = E.roll({ chapterIndex: 1, scene: DUNGEON_SCENE, clock: E.PITY_LIMIT, seed: "p", streak: 0 });
  assert.ok(pity, "pity 到顶未命中");
  assert.ok(!pity.boss, "pity 掷出的是小怪不是 boss");
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    if (E.roll({ chapterIndex: 1, scene: DUNGEON_SCENE, clock: 0, seed: `d${i}` })) hits++;
  }
  assert.ok(hits > 0 && hits < 400, "无 streak 时应按基础概率部分命中");
});
