#!/usr/bin/env node
// F139 封门拒绝看 Boss 生死契约（全是行为断言）：
//
//   (a) Boss 未清（boss_cleared_json 不含 "ch2"）+ escape_locked 场景
//       （ch2_penalty_gate 与 ch2_poison_fang 都是封门场景）输「离开这里」——
//       refused===true、escape_locked===true、scene 不动、不掷遭遇、
//       回包含真实动作词（「前进」或「叫阵」）、不含 phantom 出路
//       （「撑到」「存活至」「副本终结」「副本结束」）、不含「毒牙蛇」、
//       日志零增长（refused 零消耗语义不变）。
//   (b) 同存档把 Boss 标记为已击杀（boss_cleared_json=["ch2"]，既有
//       schema 字段，不改表结构）→ 同样两处场景输「离开这里」——
//       refused !== true、scene 不动（本次不替玩家推进）、回包含
//       「前进」、不含「无法撤离」、不掷遭遇。
//   (c) 对照：Boss 已清、人站在链尾守关房（ch2_poison_fang）时
//       advance_mode==="next_chapter"，按「前进」正常过门进第 3 章——
//       既有推进行为不得因本次改动回归。
//
//   落点/击杀标记锻造走 DB 直写（同 free-input-intent.mjs 取径）：
//   boss_cleared_json 是 saves 表既有 TEXT 列（JSON 数组，元素为章节
//   id 如 "ch2"），与 bossRequirementMet/bossCleared 读的同一口径。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：escape_locked 分支不看 bossRequirementMet → (b)(c) FAIL；
//   文案留「撑到/存活至/副本终结」→ (a) FAIL；已清分支误带 refused →
//   (b) FAIL；删掉动作词 → (a)(b) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView, get } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

function forgeSave(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

async function logCount(id) {
  const r = await get(`/saves/${id}/log?limit=400`);
  assert(r.status === 200 && Array.isArray(r.body.log), `log fetch failed (HTTP ${r.status})`);
  return r.body.log.length;
}

const PENALTY_GATE = "ch2_penalty_gate";
const PENALTY_BOSS = "ch2_poison_fang";
const CH3_FIRST = "ch3_association";
const PHANTOM = ["撑到", "存活至", "副本终结", "副本结束"];

// ── (a) Boss 未清：两处封门场景仍是拒绝，但出路只有一条且点名动作词 ──
{
  const id = await makeSave("f139-locked");
  for (const sceneId of [PENALTY_GATE, PENALTY_BOSS]) {
    forgeSave(id, {
      chapter: 2,
      scene: sceneId,
      level: 4,
      boss_cleared_json: "[]",
      encounter_clock: 0,
      encounter_cd: 0,
    });
    const before = (await fetchSaveView(id)).save;
    assert(
      before.scene === sceneId && before.chapter === 2 && before.combat === null,
      `(a) setup broken: ${before.scene} ch${before.chapter}`
    );
    const logsBefore = await logCount(id);

    const r = await act(id, "离开这里");
    assert(
      r.intent === "flee",
      `(a) ${sceneId}「离开这里」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`
    );
    assert(
      r.refused === true,
      `(a) ${sceneId}「离开这里」期望 refused=true，实际 ${JSON.stringify(r.refused)}`
    );
    assert(
      r.escape_locked === true,
      `(a) ${sceneId}「离开这里」期望 escape_locked 标记，实际 ${JSON.stringify(r.escape_locked)}`
    );
    assert(
      r.save.scene === sceneId && r.save.chapter === 2,
      `(a) ${sceneId}「离开这里」挪了位置：${r.save.scene}(ch${r.save.chapter})`
    );
    assert(
      r.save.combat === null,
      `(a) ${sceneId}「离开这里」掷出了遭遇：${JSON.stringify(r.save.combat)}`
    );
    const text = r.reply.content;
    assert(
      text.includes("前进") || text.includes("叫阵"),
      `(a) ${sceneId} 拒绝文案未点名动作词（前进/叫阵）：${text.slice(-120)}`
    );
    for (const bad of PHANTOM) {
      assert(
        !text.includes(bad),
        `(a) ${sceneId} 拒绝文案含 phantom 出路「${bad}」：${text.slice(-120)}`
      );
    }
    assert(
      !text.includes("毒牙蛇"),
      `(a) ${sceneId} 拒绝文案漏了守关者名：${text.slice(-120)}`
    );
    assert(!text.includes("未识别"), `(a) ${sceneId} 落了未识别兜底：${text.slice(-120)}`);
    assert(
      r.save.hp === before.hp && r.save.mp === before.mp,
      `(a) ${sceneId}「离开这里」扣了体力：${before.hp}/${before.mp} -> ${r.save.hp}/${r.save.mp}`
    );
    const logsAfter = await logCount(id);
    assert(
      logsAfter === logsBefore,
      `(a) ${sceneId} 封门拒绝写了 ${logsAfter - logsBefore} 条日志（应零增长）`
    );
  }
  console.log("[OK] (a) Boss 未清：封门拒绝保留，文案单一路径点名「前进/叫阵」、无 phantom 出路");
}

// ── (b) Boss 已清：封门解除——不拒绝、不替玩家推进、指路「前进」──────
{
  const id = await makeSave("f139-cleared");
  for (const sceneId of [PENALTY_GATE, PENALTY_BOSS]) {
    forgeSave(id, {
      chapter: 2,
      scene: sceneId,
      level: 4,
      boss_cleared_json: '["ch2"]',
      encounter_clock: 0,
      encounter_cd: 0,
    });
    const before = (await fetchSaveView(id)).save;
    assert(
      before.scene === sceneId && before.chapter === 2 && before.combat === null,
      `(b) setup broken: ${before.scene} ch${before.chapter}`
    );

    const r = await act(id, "离开这里");
    assert(
      r.intent === "flee",
      `(b) ${sceneId}「离开这里」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`
    );
    assert(
      r.refused !== true,
      `(b) ${sceneId} Boss 已清仍 refused=true（封门没看 boss_cleared）：${JSON.stringify(r.refused)}`
    );
    assert(
      r.save.scene === sceneId && r.save.chapter === 2,
      `(b) ${sceneId}「离开这里」替玩家推进了：${r.save.scene}(ch${r.save.chapter})`
    );
    assert(
      r.save.combat === null,
      `(b) ${sceneId}「离开这里」掷出了遭遇：${JSON.stringify(r.save.combat)}`
    );
    const text = r.reply.content;
    assert(text.includes("前进"), `(b) ${sceneId} 文案缺「前进」指路：${text.slice(-120)}`);
    assert(
      !text.includes("无法撤离"),
      `(b) ${sceneId} Boss 已清仍回「无法撤离」：${text.slice(-120)}`
    );
    assert(
      r.save.hp === before.hp && r.save.mp === before.mp,
      `(b) ${sceneId}「离开这里」扣了体力：${before.hp}/${before.mp} -> ${r.save.hp}/${r.save.mp}`
    );
  }
  console.log("[OK] (b) Boss 已清：不再 refused，指路「前进」且不替玩家推进");
}

// ── (c) 对照：Boss 已清 + 链尾守关房，「前进」正常过门进第 3 章 ──────
{
  const id = await makeSave("f139-next-chapter");
  forgeSave(id, {
    chapter: 2,
    scene: PENALTY_BOSS,
    level: 4,
    boss_cleared_json: '["ch2"]',
    encounter_clock: 0,
    encounter_cd: 0,
  });
  const view = await fetchSaveView(id);
  assert(
    view.save.advance_mode === "next_chapter",
    `(c) 链尾+Boss 已清期望 advance_mode=next_chapter，实际 ${JSON.stringify(view.save.advance_mode)}`
  );
  const r = await act(id, "前进");
  assert(
    r.refused !== true,
    `(c) Boss 已清的过门被 refused：${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.chapter === 3 && r.save.scene === CH3_FIRST,
    `(c)「前进」未过门进第 3 章：${r.save.scene}(ch${r.save.chapter})`
  );
  console.log("[OK] (c) 对照：Boss 已清「前进」正常过门 → 第 3 章，推进无回归");
}

ok("F139 escape_locked boss-cleared contract: all assertions passed");
