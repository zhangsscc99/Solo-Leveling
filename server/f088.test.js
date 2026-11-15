// F088/F077/F082 集成测试（node --test 单独子进程运行本文件）：
//   1) 必遇敌：新档 ≤10 次「攻击」必然开出 save.combat；
//   2) 击杀计 XP：打完一场战斗 kills+1 且 XP 上涨；
//   3) HP 归零复活：战斗死亡走 settleDeath，HP≈max_hp/2、deaths+1、
//      交战态清空；
//   4) encounter 纯函数保底：roll 在 clock 触顶时必出敌人（确定性）。
// DB_PATH 必须在 require index.js 之前设置——db.js 在模块加载时建库。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-f088-test-"));
process.env.DB_PATH = path.join(tmp, "game.db");

const { app } = require("./index");
const encounter = require("./engine/encounter");

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}/game/api`;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function newSave(name) {
  const { status, body } = await api("POST", "/saves", { player_name: name });
  assert.equal(status, 201);
  return body.save.id;
}

const act = async (id, input) => {
  const { status, body } = await api("POST", "/action", { save_id: id, input });
  assert.equal(status, 200);
  return body;
};

test("新档 10 次「攻击」内必然遭遇敌人", async () => {
  const id = await newSave("t-encounter");
  let save = null;
  for (let i = 0; i < 10 && !(save && save.combat); i++) {
    save = (await act(id, "攻击")).save;
  }
  assert.ok(save.combat, "no encounter within 10 attack intents");
  assert.ok(save.combat.enemy.hp > 0 && save.combat.enemy.max_hp > 0);
  assert.equal(save.combat.turn, 1);
});

test("击杀敌人后 kills+1 且 XP 入账", async () => {
  const id = await newSave("t-kill");
  let cur = null;
  for (let i = 0; i < 10 && !(cur && cur.save.combat); i++) cur = await act(id, "攻击");
  assert.ok(cur.save.combat, "setup: no encounter");
  const xpBefore = cur.save.xp;
  for (let i = 0; i < 60 && cur.save.combat; i++) {
    cur = await act(id, "攻击");
    assert.ok(cur.save.hp > 0, "player died — mob fights at Lv.1 should be winnable");
  }
  assert.equal(cur.save.kills, 1);
  assert.ok(cur.save.xp > xpBefore, `xp ${xpBefore} -> ${cur.save.xp}`);
  assert.match(cur.reply.content, /击败 .+，获得 XP \+\d+ · 金币 \+\d+/);
});

test("HP 归零进入复活分支：deaths+1 · HP≈max/2 · 交战收敛", async () => {
  const id = await newSave("t-death");
  let cur = null;
  for (let i = 0; i < 120 && !(cur && cur.save.deaths > 0); i++) {
    cur = await act(id, cur && cur.save.combat ? "攻击" : "前进");
  }
  assert.ok(cur && cur.save.deaths > 0, "never died within 120 actions");
  const s = cur.save;
  assert.equal(s.deaths, 1);
  assert.ok(Math.abs(s.hp - Math.round(s.max_hp * 0.5)) <= 1, `hp ${s.hp} vs max ${s.max_hp}`);
  assert.ok(s.combat === null);
  assert.match(cur.reply.content, /倒下/);
  assert.match(cur.reply.content, /回溯至第\d+章/);
});

test("encounter.roll 保底与 boss 场景必中（纯函数）", () => {
  const scene = { id: "x_story", kind: "story" };
  const pity = encounter.roll({ chapterIndex: 1, scene, clock: encounter.PITY_LIMIT - 1, seed: "s" });
  assert.ok(pity && pity.hp > 0 && pity.name, "pity clock should guarantee a spawn");
  const again = encounter.roll({ chapterIndex: 1, scene, clock: encounter.PITY_LIMIT - 1, seed: "s" });
  assert.deepEqual(pity, again, "same seed must produce the same spawn");
  const boss = encounter.roll({ chapterIndex: 1, scene: { id: "x_boss", kind: "boss" }, clock: 0, seed: "s" });
  assert.ok(boss && boss.boss, "boss scene must force the chapter boss");
  const calm = encounter.roll({ chapterIndex: 1, scene: null, clock: 0, seed: "s" });
  assert.equal(calm, null);
});
