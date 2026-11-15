const assert = require("node:assert");
const { resolveTurn } = require("./combat");
const { createRng, hashSeed } = require("./rng");

function baseState(overrides = {}) {
  const state = {
    turn: 1,
    player: {
      hp: 100, maxHp: 100, mp: 20, maxMp: 20, level: 5, rank: "D",
      stats: { strength: 15, agility: 15, vitality: 10, intelligence: 10, perception: 10 },
    },
    enemy: {
      id: "goblin", name: "哥布林", hp: 60, maxHp: 60, level: 3, rank: "E", def: 4,
      stats: { strength: 10, agility: 8, vitality: 6, intelligence: 4, perception: 5 },
    },
  };
  return { ...state, ...overrides };
}

// --- rng basics ---
{
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) assert.strictEqual(a.next(), b.next());
  const r = createRng("seed-string");
  for (let i = 0; i < 50; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
  assert.strictEqual(hashSeed("abc"), hashSeed("abc"));
  const ri = createRng(7);
  for (let i = 0; i < 100; i++) {
    const v = ri.int(5, 2); // reversed bounds still work
    assert.ok(v >= 2 && v <= 5);
  }
  assert.ok(!createRng(1).chance(0));
  assert.ok(createRng(1).chance(1));
}

// --- normal attack: deterministic, hp clamped, turn advances ---
{
  const s = baseState();
  const r = resolveTurn(s, "attack", "t1");
  assert.strictEqual(r.state.turn, 2);
  assert.ok(r.state.enemy.hp >= 0 && r.state.enemy.hp <= 60);
  assert.ok(r.state.player.hp >= 0 && r.state.player.hp <= 100);
  assert.ok(r.events.length > 0);
  for (const e of r.events) assert.ok(typeof e.text === "string" && e.text.length > 0);
  assert.strictEqual(typeof r.narration, "string");
  // input untouched
  assert.strictEqual(s.enemy.hp, 60);
  assert.strictEqual(s.turn, 1);
}

// --- seed reproducibility ---
{
  const s = baseState();
  const r1 = resolveTurn(s, "attack", "same-seed");
  const r2 = resolveTurn(s, "attack", "same-seed");
  assert.deepStrictEqual(r1.events, r2.events);
  assert.deepStrictEqual(r1.state, r2.state);
  const r3 = resolveTurn(s, "attack", "different-seed");
  // not asserting difference, just that it runs
  assert.ok(Array.isArray(r3.events));
}

// --- 0 HP boundaries ---
{
  const dead = baseState();
  dead.player.hp = 0;
  const r = resolveTurn(dead, "attack", "x");
  assert.ok(r.events.some((e) => e.type === "defeat" && e.side === "player"));
  assert.strictEqual(r.state.player.hp, 0);
  assert.strictEqual(r.state.enemy.hp, 60); // enemy untouched
  assert.strictEqual(r.state.turn, 1); // no progression

  const deadEnemy = baseState();
  deadEnemy.enemy.hp = 0;
  const r2 = resolveTurn(deadEnemy, "attack", "x");
  assert.ok(r2.events.every((e) => e.type !== "hit" && e.type !== "crit"));
  assert.strictEqual(r2.state.enemy.hp, 0);
  assert.ok(r2.state.enemy.hp >= 0);
}

// --- item heal clamped at maxHp ---
{
  const s = baseState();
  s.player.hp = 95;
  const r = resolveTurn(s, "item", "heal-seed");
  assert.ok(r.state.player.hp <= s.player.maxHp);
  const heal = r.events.find((e) => e.type === "heal" && e.side === "player");
  assert.ok(heal && heal.value <= 5);
}

// --- dodge: high-agility enemy dodges at least once across seeds ---
{
  const s = baseState();
  s.enemy.stats.agility = 200;
  let sawDodge = false;
  for (let i = 0; i < 40 && !sawDodge; i++) {
    const r = resolveTurn(s, "attack", "dodge-" + i);
    sawDodge = r.events.some((e) => e.type === "dodge" && e.side === "enemy");
  }
  assert.ok(sawDodge, "expected at least one dodge across seeds");
}

// --- crit: high-perception player crits at least once across seeds ---
{
  const s = baseState();
  s.player.stats.perception = 95; // crit chance ~= 0.5 cap
  let sawCrit = false;
  for (let i = 0; i < 40 && !sawCrit; i++) {
    const r = resolveTurn(s, "attack", "crit-" + i);
    sawCrit = r.events.some((e) => e.type === "crit" && e.side === "player");
  }
  assert.ok(sawCrit, "expected at least one crit across seeds");
}

// --- invalid action ---
{
  const s = baseState();
  const r = resolveTurn(s, "dance", "z");
  assert.deepStrictEqual(r.events.map((e) => e.type), ["error"]);
  assert.strictEqual(r.state.turn, 1);
  assert.strictEqual(r.state.player.hp, 100);
  assert.strictEqual(r.state.enemy.hp, 60);
}

// --- skill consumes mp; insufficient mp yields error event ---
{
  const s = baseState();
  const r = resolveTurn(s, "skill", "sk");
  assert.strictEqual(r.state.player.mp, 12);
  s.player.mp = 0;
  const r2 = resolveTurn(s, "skill", "sk");
  assert.ok(r2.events.some((e) => e.type === "error"));
  assert.strictEqual(r2.state.player.mp, 0);
}

// --- flee never throws; success or failure both produce flee event ---
{
  const s = baseState();
  let fled = false, blocked = false;
  for (let i = 0; i < 40; i++) {
    const r = resolveTurn(s, "flee", "flee-" + i);
    const e = r.events.find((ev) => ev.type === "flee");
    assert.ok(e);
    if (e.side === "player") fled = true; else blocked = true;
  }
  assert.ok(fled && blocked);
}

// --- defend: no heal event, narration mentions 防御, damage reduced ---
{
  const s = baseState();
  const r = resolveTurn(s, "defend", "def-seed");
  assert.ok(r.events.every((e) => e.type !== "heal"), "defend must not emit heal events");
  const ALLOWED = new Set(["hit", "crit", "miss", "dodge", "damage", "heal", "flee", "defeat", "error"]);
  for (const e of r.events) assert.ok(ALLOWED.has(e.type));
  assert.ok(r.narration.includes("防御"), "narration should mention 防御");
  assert.strictEqual(r.state.turn, 2);

  // defending reduces counterattack damage vs attacking on the same seed
  let sawLess = false;
  for (let i = 0; i < 60 && !sawLess; i++) {
    const seed = "defcmp-" + i;
    const atk = resolveTurn(baseState(), "attack", seed);
    const def = resolveTurn(baseState(), "defend", seed);
    assert.ok(def.state.player.hp >= atk.state.player.hp);
    if (def.state.player.hp > atk.state.player.hp) sawLess = true;
  }
  assert.ok(sawLess, "expected at least one seed where defend reduces damage taken");
}

console.log("OK");
