#!/usr/bin/env node
// F158 守关者房状态预警契约（全是行为断言）：
//
//   落点锻造（DB 直写，同 boss-refusal-affordance.mjs 取径）：
//     A = HP<60%（50/100）且人在 ch1 守关者房前一步；
//     B = HP≥60%（90/100）同场景；
//     C = HP<60%（40/100）且人已站在守关房内、无交战、再入冷却中。
//
//   (a) A 输「前进」落地守关房开战——回包必含状态预警：玩家 HP 绝对值
//       （HP <数字>）、至少一条恢复/补给路径（休息|药水|补给）、至少
//       一个可输入动词（攻击|叫阵|前进）、守关者真名「石像守卫」，
//       且 HP<60% 必须明确建议先恢复。
//   (b) B 输「前进」同样落地开战——回包不得含「先恢复」「建议休息」，
//       但仍含守关者真名与 HP 数值。
//   (c) C 输「前进」走 F150 门前拒绝——refused、零消耗，拒绝文案仍
//       点名「攻击」或「叫阵」（F150 契约不冲突），预警行同在：HP 数
//       值 + 恢复路径动词 + 守关者真名。
//   (d) 预警不逐字复读：C 连输两次「前进」，两条预警文案不同
//       （≥2 变体轮换）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：删掉进房预警 → (a)(b) 全红；删掉拒绝路径预警 → (c)
//   红；删掉 HP 分段（残血也按满血措辞）→ (a) 的「先恢复」断言红；
//   预警写死单句 → (d) 红；承伤区间换成不含数字的空话 → (a) 的
//   HP+数字断言红。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// ── 独立 oracle：主线链与守关者只从数据文件推导 ──────────────────────
function deriveMainPath(chapter) {
  const byId = new Map(chapter.scenes.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  let cur = chapter.scenes[0];
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => typeof c.next === "string" && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
  return out;
}

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const CH1_PATH = deriveMainPath(ch1);
const CH1_BOSS = ch1.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS && CH1_PATH.includes(CH1_BOSS.id), "oracle: ch1 boss scene must be on main chain");
const CH1_PREV = CH1_PATH[CH1_PATH.indexOf(CH1_BOSS.id) - 1];
const BOSS_NAME = CH1_BOSS.title;
assert(BOSS_NAME === "石像守卫", `oracle: expected 石像守卫, got ${BOSS_NAME}`);

// 站到守关者房前一步 / 房内，守关者未击杀、无交战。
function forgeBeforeBoss(id, { hp, inRoom = false }) {
  db.prepare(
    "UPDATE saves SET scene = ?, chapter = 1, hp = ?, boss_cleared_json = '[]', " +
      "encounter_clock = ?, encounter_cd = 0 WHERE id = ?"
  ).run(inRoom ? CH1_BOSS.id : CH1_PREV, hp, inRoom ? -1 : 0, id);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

// ── (a) A：残血进房 → 预警带 HP+恢复路径+动词+守关者名+「先恢复」───────
{
  const id = await makeSave("f158-low");
  forgeBeforeBoss(id, { hp: 50 });
  const { save: s0 } = await fetchSaveView(id);
  assert(s0.scene === CH1_PREV && s0.combat === null, `(a) setup broken: ${s0.scene} combat=${JSON.stringify(s0.combat)}`);

  const r = await act(id, "前进");
  const text = r.reply.content;
  assert(
    r.save.scene === CH1_BOSS.id && r.save.combat && r.save.combat.enemy && r.save.combat.enemy.boss,
    `(a) 前进 must land in the guardian room and start the fight: scene=${r.save.scene} combat=${JSON.stringify(r.save.combat)}`
  );
  assert(/HP\s*\d+/.test(text), `(a) warning must carry player HP number: ${text.slice(-220)}`);
  assert(/\d+%/.test(text), `(a) warning must carry HP percentage: ${text.slice(-220)}`);
  assert(/休息|药水|补给/.test(text), `(a) warning must name a real recovery path (休息/药水/补给): ${text.slice(-220)}`);
  assert(/攻击|叫阵|前进/.test(text), `(a) warning must name an inputtable verb: ${text.slice(-220)}`);
  assert(text.includes(BOSS_NAME), `(a) warning must name the guardian「${BOSS_NAME}」: ${text.slice(-220)}`);
  assert(/先恢复|恢复再战|恢复再/.test(text), `(a) HP<60% must explicitly advise recovering first: ${text.slice(-220)}`);
  console.log("    (a) 残血进房：HP+百分比+恢复路径+动词+守关者名+「先恢复」全部命中");
}

// ── (b) B：状态尚可进房 → 提示风险但不得劝退 ─────────────────────────
{
  const id = await makeSave("f158-high");
  forgeBeforeBoss(id, { hp: 90 });
  const r = await act(id, "前进");
  const text = r.reply.content;
  assert(
    r.save.scene === CH1_BOSS.id && r.save.combat && r.save.combat.enemy && r.save.combat.enemy.boss,
    `(b) 前进 must land in the guardian room and start the fight: scene=${r.save.scene}`
  );
  assert(/HP\s*\d+/.test(text), `(b) warning must still carry player HP: ${text.slice(-220)}`);
  assert(text.includes(BOSS_NAME), `(b) warning must name the guardian「${BOSS_NAME}」: ${text.slice(-220)}`);
  assert(
    !text.includes("先恢复") && !text.includes("建议休息"),
    `(b) HP>=60% must not advise recovering first: ${text.slice(-220)}`
  );
  console.log("    (b) 状态尚可进房：有 HP/守关者名提示，无「先恢复/建议休息」");
}

// ── (c)(d) C：房内被拒 → 拒绝点名动词 + 预警同行 + 变体轮换 ──────────
{
  const id = await makeSave("f158-gate");
  forgeBeforeBoss(id, { hp: 40, inRoom: true });
  const { save: s0 } = await fetchSaveView(id);
  assert(
    s0.scene === CH1_BOSS.id && s0.combat === null,
    `(c) setup broken: ${s0.scene} combat=${JSON.stringify(s0.combat)}`
  );

  const replies = [];
  for (let i = 0; i < 2; i++) {
    const r = await act(id, "前进");
    const text = r.reply.content;
    assert(r.refused === true, `(c) push#${i + 1} must be refused: ${text.slice(-160)}`);
    assert(
      r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
      `(c) push#${i + 1} changed state: ${s0.hp}/${s0.mp} -> ${r.save.hp}/${r.save.mp}`
    );
    assert(
      /攻击|叫阵/.test(text),
      `(c) push#${i + 1} refusal must still name an inputtable verb (F150): ${text.slice(-220)}`
    );
    assert(/HP\s*\d+/.test(text), `(c) push#${i + 1} warning must carry player HP: ${text.slice(-220)}`);
    assert(
      /休息|药水|补给/.test(text),
      `(c) push#${i + 1} warning must name a recovery path: ${text.slice(-220)}`
    );
    assert(
      text.includes(BOSS_NAME),
      `(c) push#${i + 1} warning must name the guardian「${BOSS_NAME}」: ${text.slice(-220)}`
    );
    replies.push(text);
  }
  // (d) 只比预警行本身（门拒绝句按 F150 计数轮换，天然不同）——
  // 预警若写死单句，这里必然复读。
  const warnLine = (t) => (t.match(/【系统】[^\n]*每回合[^\n]*/g) || []).join("\n");
  const w0 = warnLine(replies[0]);
  const w1 = warnLine(replies[1]);
  assert(w0 && w1, `(d) warning line missing in refusals: ${replies[0].slice(-160)}`);
  assert(
    w0 !== w1,
    `(d) warning prose must rotate >=2 variants, got identical lines: ${w0}`
  );
  console.log("    (c)(d) 房内被拒：点名动词+预警同行，两次预警文案不同");
}

db.close();
ok("boss-room-readiness OK");
