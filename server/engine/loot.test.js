// Self-checking test for the loot engine: run with `node server/engine/loot.test.js`.
// No test framework — node:assert plus a tiny harness so it works offline.

const assert = require("node:assert/strict");

const loot = require("./loot");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err && err.message ? err.message : err}`);
  }
}

function sumGold(samples) {
  return samples.reduce((acc, s) => acc + s.gold, 0);
}

function sample(enemyId, rank, n, opts) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(loot.rollLoot(enemyId, rank, i, opts));
  return out;
}

const tables = loot.loadTables();
const enemies = tables.enemies;
const enemyIds = Object.keys(enemies).filter((k) => k !== "fallback");

console.log("loot engine self-test\n");

// ---------------------------------------------------------------------------
console.log("数据表");
// ---------------------------------------------------------------------------
test("drops.json 通过 validateTables()", () => {
  const errors = loot.validateTables();
  assert.deepEqual(errors, [], `校验错误:\n${errors.join("\n")}`);
});

test("validateTables() 能识别坏表", () => {
  const bad = {
    version: 0,
    rarityOrder: ["common", "common"],
    enemies: {
      fallback: {
        gold: [5, 1],
        rarityWeights: { nope: 1 },
        drops: [{ item_id: "", rarity: "mythic", weight: 0, qty: [0, 1] }],
      },
    },
  };
  const errors = loot.validateTables(bad);
  assert.ok(errors.length >= 5, `应报出多条错误，实际 ${errors.length}`);
  assert.ok(errors.some((e) => e.includes("version")));
  assert.ok(!errors.some((e) => e.includes("enemies.fallback 缺失")), "fallback 存在不应报缺失");
  assert.ok(errors.some((e) => e.includes("rarityOrder")));
  assert.ok(errors.some((e) => e.includes("item_id")));
});

test("至少 6 个具名敌人，每个 2-5 条掉落，且含 fallback", () => {
  assert.ok(enemies.fallback, "缺少 fallback");
  assert.ok(enemyIds.length >= 6, `敌人数量 ${enemyIds.length} < 6`);
  for (const id of enemyIds) {
    const drops = enemies[id].drops;
    assert.ok(Array.isArray(drops) && drops.length >= 2 && drops.length <= 5, `${id} 掉落条数 ${drops.length}`);
  }
});

test("loadTables() 在模块内缓存同一对象", () => {
  assert.equal(loot.loadTables(), tables);
});

test("稀有度权重随敌人 rank 递进", () => {
  const order = tables.rarityOrder;
  const quality = (id) => {
    const w = enemies[id].rarityWeights;
    const total = order.reduce((acc, r) => acc + (w[r] || 0), 0);
    return order.reduce((acc, r, i) => acc + (i * (w[r] || 0)) / total, 0);
  };
  const e = quality("dungeon_wolf");
  const d = quality("stone_guardian");
  const c = quality("frost_sprite");
  const b = quality("demon_castle_knight");
  const s = quality("ant_king_beru");
  assert.ok(e < d && d < c && c < b && b < s, `稀有度期望未递进: ${[e, d, c, b, s].map((n) => n.toFixed(2))}`);
});

// ---------------------------------------------------------------------------
console.log("\n回退与边界");
// ---------------------------------------------------------------------------
test("未知敌人回退到 fallback（同 seed 完全一致）", () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const unknown = loot.rollLoot("no_such_enemy_xyz", "E", seed);
    const fallback = loot.rollLoot("fallback", "E", seed);
    assert.deepEqual(unknown, fallback, `seed=${seed} 回退结果不一致`);
  }
});

test("未传 enemyId / 传 null 也不抛错", () => {
  assert.deepEqual(loot.rollLoot(undefined, "E", 7), loot.rollLoot("fallback", "E", 7));
  assert.deepEqual(loot.rollLoot(null, "E", 7), loot.rollLoot("fallback", "E", 7));
});

test("空掉落表返回空数组且不抛错", () => {
  const empty = {
    version: 1,
    rarityOrder: ["common"],
    enemies: {
      fallback: { gold: [1, 2], rarityWeights: { common: 1 }, drops: [] },
      stone_guardian: { gold: [3, 4], rolls: [2, 2], rarityWeights: { common: 1 }, drops: [] },
    },
  };
  for (const id of ["stone_guardian", "fallback", "ghost"]) {
    const res = loot.rollLoot(id, "D", 123, { tables: empty });
    assert.deepEqual(res.items, [], `${id} 应返回空 items`);
    assert.ok(Number.isInteger(res.gold) && res.gold >= 0);
  }
  const noDropsKey = {
    version: 1,
    rarityOrder: ["common"],
    enemies: { fallback: { gold: [0, 0], rarityWeights: { common: 1 } } },
  };
  assert.deepEqual(loot.rollLoot("ghost", "E", 1, { tables: noDropsKey }), { gold: 0, items: [] });
});

test("缺失 fallback 的坏表也不崩", () => {
  const broken = { version: 1, rarityOrder: ["common"], enemies: { dungeon_wolf: { gold: [1, 2], drops: [] } } };
  const res = loot.rollLoot("nobody", "E", 3, { tables: broken });
  assert.deepEqual(res, { gold: 0, items: [] });
});

// ---------------------------------------------------------------------------
console.log("\n金币");
// ---------------------------------------------------------------------------
test("金币落在 [min, max] × rank 系数 区间内", () => {
  for (const id of Object.keys(enemies)) {
    const enemy = enemies[id];
    const [min, max] = enemy.gold;
    for (const rank of loot.RANK_ORDER) {
      const mul = loot.rankMultiplier(rank);
      const lo = min === 0 ? 0 : Math.max(1, Math.round(min * mul));
      const hi = Math.max(lo, Math.round(max * mul));
      for (let seed = 0; seed < 300; seed += 1) {
        const { gold } = loot.rollLoot(id, rank, seed);
        assert.ok(Number.isInteger(gold) && gold >= lo && gold <= hi, `${id}/${rank}/seed=${seed}: ${gold} ∉ [${lo}, ${hi}]`);
      }
    }
  }
});

test("rank 越高期望金币越高（各 rank 抽样 3000 次）", () => {
  const n = 3000;
  const means = loot.RANK_ORDER.map((rank) => sumGold(sample("demon_castle_knight", rank, n)) / n);
  for (let i = 1; i < means.length; i += 1) {
    assert.ok(
      means[i] > means[i - 1],
      `${loot.RANK_ORDER[i]} 均值 ${means[i].toFixed(2)} 未高于 ${loot.RANK_ORDER[i - 1]} 的 ${means[i - 1].toFixed(2)}`
    );
  }
  // S 至少是 E 的 3 倍（系数 3.8，留出取整余量）
  assert.ok(means[means.length - 1] > means[0] * 3, `S/E 倍率不足: ${(means[means.length - 1] / means[0]).toFixed(2)}`);
  console.log(`        期望金币 E→S: ${means.map((m) => m.toFixed(1)).join(" → ")}`);
});

test("未知 rank 按 E 处理", () => {
  for (let seed = 0; seed < 50; seed += 1) {
    assert.deepEqual(loot.rollLoot("dungeon_wolf", "Z", seed), loot.rollLoot("dungeon_wolf", "E", seed));
  }
  assert.equal(loot.rankMultiplier("Z"), loot.rankMultiplier("E"));
});

// ---------------------------------------------------------------------------
console.log("\n掉落数量与稀有度");
// ---------------------------------------------------------------------------
test("单次投掷的 qty 落在掉落条目区间内", () => {
  for (const id of enemyIds) {
    const ranges = new Map(enemies[id].drops.map((d) => [d.item_id, d.qty]));
    for (const rank of ["E", "S"]) {
      for (let seed = 0; seed < 500; seed += 1) {
        const { items } = loot.rollLoot(id, rank, seed, { rolls: 1 });
        for (const item of items) {
          const [lo, hi] = ranges.get(item.item_id);
          assert.ok(lo <= item.qty && item.qty <= hi, `${id}/${rank}: ${item.item_id} qty=${item.qty} ∉ [${lo}, ${hi}]`);
          assert.ok(typeof item.rarity === "string" && tables.rarityOrder.includes(item.rarity));
        }
      }
    }
  }
});

test("多次投掷的同名物品会累加 qty 且 item_id 不重复", () => {
  let sawMerge = false;
  for (let seed = 0; seed < 2000 && !sawMerge; seed += 1) {
    const { items } = loot.rollLoot("ant_king_beru", "S", seed);
    const ids = items.map((i) => i.item_id);
    assert.equal(new Set(ids).size, ids.length, `seed=${seed} 出现重复 item_id`);
    for (const item of items) {
      if (item.qty > 1) sawMerge = true;
    }
  }
  assert.ok(sawMerge, "2000 次抽样未观察到 qty 累加");
});

test("rolls 数量在表内区间（默认）", () => {
  for (const id of enemyIds) {
    const [lo, hi] = enemies[id].rolls || [1, 1];
    for (let seed = 0; seed < 500; seed += 1) {
      const count = loot.rollLoot(id, "E", seed).items.length;
      assert.ok(count <= hi, `${id}/seed=${seed}: ${count} 条掉落超过 rolls 上限 ${hi}`);
      assert.ok(count >= 0 && lo >= 0);
    }
  }
});

test("rank 越高稀有度期望越高（蚁王 S vs E）", () => {
  const n = 3000;
  const order = tables.rarityOrder;
  const meanRarity = (rank) => {
    let idxSum = 0;
    let count = 0;
    for (let seed = 0; seed < n; seed += 1) {
      const { items } = loot.rollLoot("ant_king_beru", rank, seed);
      for (const item of items) {
        idxSum += order.indexOf(item.rarity);
        count += 1;
      }
    }
    assert.ok(count > 0, `${rank} 无掉落样本`);
    return idxSum / count;
  };
  const e = meanRarity("E");
  const s = meanRarity("S");
  assert.ok(s > e + 0.15, `S 稀有度均值 ${s.toFixed(2)} 未明显高于 E 的 ${e.toFixed(2)}`);
  console.log(`        平均稀有度阶 E=${e.toFixed(2)} S=${s.toFixed(2)}`);
});

test("权重总和归一化：巨大权重不溢出、比例仍生效", () => {
  const huge = {
    version: 1,
    rarityOrder: ["common"],
    enemies: {
      fallback: {
        gold: [0, 0],
        rolls: [1, 1],
        rarityWeights: { common: 1e9 },
        drops: [
          { item_id: "a", rarity: "common", weight: 9e9, qty: [1, 1] },
          { item_id: "b", rarity: "common", weight: 1e9, qty: [1, 1] },
        ],
      },
    },
  };
  let a = 0;
  let b = 0;
  for (let seed = 0; seed < 2000; seed += 1) {
    const { items } = loot.rollLoot("fallback", "E", seed, { tables: huge });
    assert.equal(items.length, 1);
    if (items[0].item_id === "a") a += 1;
    else b += 1;
  }
  const ratio = a / (a + b);
  assert.ok(ratio > 0.85 && ratio < 0.95, `9:1 权重比例异常: ${ratio.toFixed(3)}`);
});

test("所选稀有度档无条目时向下回退", () => {
  const t = {
    version: 1,
    rarityOrder: ["common", "rare", "epic"],
    enemies: {
      fallback: {
        gold: [0, 0],
        rolls: [1, 1],
        rarityWeights: { common: 0, rare: 0, epic: 1 },
        drops: [
          { item_id: "only_common", rarity: "common", weight: 5, qty: [1, 1] },
          { item_id: "only_legend", rarity: "epic", weight: 0.0001, qty: [1, 1] },
        ],
      },
    },
  };
  // epic 有极小正权重，仍然可选；把权重归零后必须回退到 common
  const forced = JSON.parse(JSON.stringify(t));
  forced.enemies.fallback.drops = [{ item_id: "only_common", rarity: "common", weight: 5, qty: [1, 1] }];
  for (let seed = 0; seed < 100; seed += 1) {
    const { items } = loot.rollLoot("fallback", "E", seed, { tables: forced });
    assert.equal(items.length, 1);
    assert.equal(items[0].item_id, "only_common");
    assert.equal(items[0].rarity, "common");
  }
});

// ---------------------------------------------------------------------------
console.log("\n确定性");
// ---------------------------------------------------------------------------
test("同 seed 同结果（数字 / 字符串 seed）", () => {
  for (const seed of [0, 1, 42, 4242, 987654321, "dungeon-42", "beru"]) {
    for (const id of Object.keys(enemies)) {
      const first = loot.rollLoot(id, "B", seed);
      const second = loot.rollLoot(id, "B", seed);
      assert.deepEqual(first, second, `${id} seed=${seed} 结果不可复现`);
    }
  }
});

test("同 seed 不同敌人 / 不同 rank 结果独立", () => {
  const a = loot.rollLoot("dungeon_wolf", "E", 2026);
  const b = loot.rollLoot("stone_guardian", "E", 2026);
  const c = loot.rollLoot("dungeon_wolf", "S", 2026);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("不同 seed 产生分布（非恒定）", () => {
  const golds = new Set();
  const bundles = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const res = loot.rollLoot("frost_sprite", "C", seed);
    golds.add(res.gold);
    bundles.add(JSON.stringify(res.items));
  }
  assert.ok(golds.size >= 3, `金币只有 ${golds.size} 种取值`);
  assert.ok(bundles.size >= 5, `掉落组合只有 ${bundles.size} 种`);
});

test("注入函数式 RNG 时按序消费", () => {
  const seq = [0.99, 0.5, 0.2, 0.7, 0.1];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const res = loot.rollLoot("venom_serpent", "D", rng);
  assert.ok(Array.isArray(res.items));
  assert.ok(Number.isInteger(res.gold));
});

// ---------------------------------------------------------------------------
console.log("\n汇总");
// ---------------------------------------------------------------------------
if (failures.length) {
  console.error(`\nFAILED ${failures.length} / ${passed + failures.length}`);
  process.exit(1);
}

console.log(`OK — ${passed} 项全部通过 · ${enemyIds.length} 个敌人 + fallback · ${loot.TABLE_PATH}`);
// 显式退出：某些宿主环境注入了失效的 IPC channel，不退出会在收尾时 abort。
process.exit(0);
