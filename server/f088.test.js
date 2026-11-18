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
const store = require("./db");
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
    // F097 钳制生效后玩家不再必死于早期遭遇——可能一路推进到守关门。
    // 门拒绝「前进」时正文点名「攻击/叫阵」逼守关者现形：驱动照做，
    // 否则会在门前空转 120 次而从不进战。其余拒绝照旧退回「前进」。
    const refusedByGate =
      cur && cur.refused === true && /守关者|叫阵|现形/.test(cur.reply.content || "");
    // P204：must_choose 场景拒绝裸「前进」——驱动改点名首个选项（数据上
    // 各必选场景的第 1 项都落主线链，测试只求继续推进不择支线）。
    const mustChoose =
      cur && cur.refused === true && /必须做出选择/.test(cur.reply.content || "");
    cur = await act(
      id,
      mustChoose ? "选择 1" : (cur && cur.save.combat) || refusedByGate ? "攻击" : "前进"
    );
  }
  assert.ok(cur && cur.save.deaths > 0, "never died within 120 actions");
  const s = cur.save;
  assert.equal(s.deaths, 1);
  assert.ok(Math.abs(s.hp - Math.round(s.max_hp * 0.5)) <= 1, `hp ${s.hp} vs max ${s.max_hp}`);
  assert.ok(s.combat === null);
  assert.match(cur.reply.content, /倒下/);
  assert.match(cur.reply.content, /回溯至第\d+章/);
});

test("击杀后原地连点「攻击」不再刷怪：冷却生效，移动后新战斗 seq 不同", async () => {
  const id = await newSave("t-cooldown");
  let cur = null;
  for (let i = 0; i < 10 && !(cur && cur.save.combat); i++) cur = await act(id, "攻击");
  assert.ok(cur.save.combat, "setup: no encounter");
  const seq1 = cur.save.combat.seq;
  assert.ok(Number.isFinite(seq1), "combat should expose an encounter seq");
  for (let i = 0; i < 60 && cur.save.combat; i++) {
    cur = await act(id, "攻击");
    assert.ok(cur.save.hp > 0, "player died during setup kill");
  }
  assert.equal(cur.save.kills, 1);

  // 冷却期间原地连点：不得再开战、不得再计 kill。
  for (let i = 0; i < 6; i++) {
    cur = await act(id, "攻击");
    assert.equal(cur.save.combat, null, `attack #${i} spawned during cooldown`);
    assert.equal(cur.save.kills, 1, "cooldown must not allow repeat kills");
  }

  // 真实移动两次走完冷却，此后遭遇恢复且第二场开战胜带新 seq。
  let second = null;
  for (let i = 0; i < 12 && !second; i++) {
    cur = await act(id, cur.save.combat ? "攻击" : "前进");
    // P204：must_choose 拒绝裸「前进」——改点名首个主线选项走完冷却。
    if (cur.refused === true && /必须做出选择/.test(cur.reply.content || "")) {
      cur = await act(id, "选择 1");
    }
    if (!cur.save.combat) cur = await act(id, "攻击");
    if (cur.save.combat) second = cur.save.combat;
  }
  assert.ok(second, "no second fight after moving through the cooldown");
  assert.notEqual(second.seq, seq1, "consecutive fights must carry different seeds");
});

test("交战中「使用道具」按所选物品结算：MP 药剂真回 MP、名字对版、库存扣减", async () => {
  const id = await newSave("t-item");
  let cur = null;
  for (let i = 0; i < 10 && !(cur && cur.save.combat); i++) cur = await act(id, "攻击");
  assert.ok(cur.save.combat, "setup: no encounter");

  // 压低 MP、顶满 HP，塞一瓶魔力药剂——只有 MP 侧需要补给。
  store.updateSave(id, { mp: 5 });
  store.db
    .prepare("INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, 1) ON CONFLICT(save_id, item_id) DO UPDATE SET qty = 1")
    .run(id, "mana_potion");
  const mpBefore = 5;
  const hpBefore = cur.save.hp;
  cur = await act(id, "使用道具 魔力药剂");
  assert.match(cur.reply.content, /魔力药剂/, "narration must name the selected item");
  assert.doesNotMatch(cur.reply.content, /治疗药水/, "narration must not name a different item");
  assert.equal(cur.save.mp, Math.min(cur.save.max_mp, mpBefore + 30), "mana potion must restore 30 MP");
  assert.ok(cur.save.hp <= hpBefore, "mana potion must not heal HP");
  const inv = store.getInventory(id).find((r) => r.item_id === "mana_potion");
  assert.ok(!inv || inv.qty === 0, "potion must be consumed exactly once");
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
