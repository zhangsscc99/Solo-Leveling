// Chapter / scene data model for Solo Leveling.
//
// Pure functions over a single JSON file (server/data/chapters.json). The file
// is read once and cached; every lookup is O(chapters) at worst, which is fine
// for 8 chapters. Validation is fail-fast: loadChapters() throws an Error whose
// message enumerates every broken reference, so a bad edit never reaches the
// runtime as "undefined is not a function".

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "chapters.json");

// Scene kinds the UI knows how to render.
const VALID_KINDS = ["story", "dungeon", "boss", "rest"];

// F115 场景遭遇许可（可选字段）："none" = 现实世界/收束场景不掷遭遇；
// "dungeon" = 显式掷怪（与字段缺失同义，缺省即旧行为）。白名单校验让
// 笔误在加载期炸出来，而不是静默落回「掷怪」把 bug 藏起来。
const VALID_ENCOUNTERS = ["none", "dungeon"];

// The story arc is fixed at 8 chapters (SPEC §8). A mismatch is a hard error.
const CHAPTER_COUNT = 8;

// Optional per-choice gating (requires) and outcome payloads (effects).
// Both are additive: scenes that omit them validate exactly as before, and
// runtimes that don't understand them can ignore them safely.
const VALID_REQUIRE_KEYS = ["min_level", "flag"];
const VALID_EFFECT_KEYS = ["xp", "gold", "hp", "mp", "item", "flag"];

// F133 场景叙述名（可选）：narr_name 是正文/场景显示名用的可读称呼，
// 与内部 title（分类/守关者口径）解耦——title 可以是「玩家」这类内部
// 占位串，narr_name 绝不可以。黑名单命中即加载期炸出来，不许带病进
// 运行时让模板把内部串念给玩家看。
const NARR_NAME_FORBIDDEN = new Set(["玩家", "todo", "undefined", "null", "test", "占位"]);

let cached = null;
let derived = null;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Returns { ok, errors }. Never throws: callers that want fail-fast semantics
// go through loadChapters().
function validateChapters(data) {
  const errors = [];

  if (!isPlainObject(data)) {
    return { ok: false, errors: ["chapters.json 顶层必须是对象 { version, chapters }"] };
  }
  if (!Array.isArray(data.chapters)) {
    return { ok: false, errors: ["chapters 必须是数组"] };
  }

  const chapters = data.chapters;

  if (chapters.length !== CHAPTER_COUNT) {
    errors.push(`章节数应为 ${CHAPTER_COUNT}，实际 ${chapters.length}`);
  }

  // Pass 1: chapter-level shape, index continuity, chapter id uniqueness.
  const chapterIds = new Set();
  chapters.forEach((chapter, i) => {
    const at = `chapters[${i}]`;
    if (!isPlainObject(chapter)) {
      errors.push(`${at} 必须是对象`);
      return;
    }
    if (!isNonEmptyString(chapter.id)) {
      errors.push(`${at}.id 必须是非空字符串`);
    } else if (chapterIds.has(chapter.id)) {
      errors.push(`${at}.id 重复: ${chapter.id}`);
    } else {
      chapterIds.add(chapter.id);
    }

    if (!isPositiveInt(chapter.index)) {
      errors.push(`${at}.index 必须是正整数`);
    } else if (chapter.index !== i + 1) {
      errors.push(`${at}.index 应为 ${i + 1}（需从 1 连续递增），实际 ${chapter.index}`);
    }

    ["title", "subtitle", "summary"].forEach((field) => {
      if (!isNonEmptyString(chapter[field])) {
        errors.push(`${at}.${field} 必须是非空字符串`);
      }
    });

    if (chapter.unlock !== undefined) {
      if (!isPlainObject(chapter.unlock)) {
        errors.push(`${at}.unlock 必须是对象`);
      } else {
        const { level, chapter: after } = chapter.unlock;
        if (level !== undefined && !isPositiveInt(level)) {
          errors.push(`${at}.unlock.level 必须是正整数`);
        }
        if (after !== undefined && !(isPositiveInt(after) && after < chapter.index)) {
          errors.push(`${at}.unlock.chapter 必须是指向更早章节的正整数（实际 ${after}）`);
        }
      }
    }

    if (!Array.isArray(chapter.scenes)) {
      errors.push(`${at}.scenes 必须是数组`);
      return;
    }
    const minScenes = chapter.index === 1 ? 3 : 2;
    if (chapter.scenes.length < minScenes) {
      errors.push(`${at}.scenes 至少需要 ${minScenes} 个场景，实际 ${chapter.scenes.length}`);
    }
  });

  // Pass 2: collect every scene id first so forward references are legal.
  const sceneIds = new Set();
  chapters.forEach((chapter, i) => {
    if (!isPlainObject(chapter) || !Array.isArray(chapter.scenes)) return;
    chapter.scenes.forEach((scene, j) => {
      if (!isPlainObject(scene)) return;
      const at = `chapters[${i}].scenes[${j}]`;
      if (!isNonEmptyString(scene.id)) {
        errors.push(`${at}.id 必须是非空字符串`);
        return;
      }
      if (sceneIds.has(scene.id)) {
        errors.push(`${at}.id 全局重复: ${scene.id}`);
        return;
      }
      sceneIds.add(scene.id);
    });
  });

  // Pass 3: per-scene content + every outbound reference.
  chapters.forEach((chapter, i) => {
    if (!isPlainObject(chapter) || !Array.isArray(chapter.scenes)) return;
    chapter.scenes.forEach((scene, j) => {
      if (!isPlainObject(scene)) {
        errors.push(`chapters[${i}].scenes[${j}] 必须是对象`);
        return;
      }
      const at = `chapters[${i}].scenes[${j}]${isNonEmptyString(scene.id) ? `(${scene.id})` : ""}`;

      if (!isNonEmptyString(scene.title)) {
        errors.push(`${at}.title 必须是非空字符串`);
      }
      if (!isNonEmptyString(scene.text)) {
        errors.push(`${at}.text 必须是非空叙述文本`);
      }
      if (scene.narr_name !== undefined) {
        if (!isNonEmptyString(scene.narr_name)) {
          errors.push(`${at}.narr_name 必须是非空字符串`);
        } else if (NARR_NAME_FORBIDDEN.has(scene.narr_name.trim().toLowerCase())) {
          errors.push(
            `${at}.narr_name 是占位串「${scene.narr_name}」（叙述名必须是玩家可读的场景称呼）`
          );
        }
      }
      if (!VALID_KINDS.includes(scene.kind)) {
        errors.push(`${at}.kind 非法: ${JSON.stringify(scene.kind)}（应为 ${VALID_KINDS.join("/")}）`);
      }

      if (scene.encounters !== undefined) {
        if (!VALID_ENCOUNTERS.includes(scene.encounters)) {
          errors.push(
            `${at}.encounters 非法: ${JSON.stringify(scene.encounters)}（应为 ${VALID_ENCOUNTERS.join("/")}）`
          );
        } else if (scene.kind === "boss" && scene.encounters === "none") {
          // 守关战是主线硬门：boss 场景标 "none" 会让守关者永不现形，
          // 章节被数据层软锁——loadChapters 首次被调用时拒绝，不许带病
          // 进运行时（进程照常 listening，首个读章节数据的请求 500）。
          errors.push(`${at}.encounters 不得在 kind='boss' 场景标 "none"（守关战是主线硬门）`);
        }
      }

      if (scene.next_scene !== undefined && scene.next_scene !== null && !sceneIds.has(scene.next_scene)) {
        errors.push(`${at}.next_scene 指向不存在的场景: ${scene.next_scene}`);
      }

      if (scene.choices !== undefined) {
        if (!Array.isArray(scene.choices)) {
          errors.push(`${at}.choices 必须是数组`);
        } else {
          const choiceIds = new Set();
          scene.choices.forEach((choice, k) => {
            const cat = `${at}.choices[${k}]`;
            if (!isPlainObject(choice)) {
              errors.push(`${cat} 必须是对象`);
              return;
            }
            if (!isNonEmptyString(choice.id)) {
              errors.push(`${cat}.id 必须是非空字符串`);
            } else if (choiceIds.has(choice.id)) {
              errors.push(`${cat}.id 在本场景内重复: ${choice.id}`);
            } else {
              choiceIds.add(choice.id);
            }
            if (!isNonEmptyString(choice.label)) {
              errors.push(`${cat}.label 必须是非空字符串`);
            }
            const next = choice.next;
            if (next !== null && !sceneIds.has(next)) {
              errors.push(`${cat}.next 指向不存在的场景: ${JSON.stringify(next)}`);
            }

            if (choice.requires !== undefined) {
              if (!isPlainObject(choice.requires) || Object.keys(choice.requires).length === 0) {
                errors.push(`${cat}.requires 必须是非空对象`);
              } else {
                Object.keys(choice.requires).forEach((key) => {
                  if (!VALID_REQUIRE_KEYS.includes(key)) {
                    errors.push(`${cat}.requires 含未知字段: ${key}`);
                  }
                });
                const { min_level, flag } = choice.requires;
                if (min_level !== undefined && !isPositiveInt(min_level)) {
                  errors.push(`${cat}.requires.min_level 必须是正整数`);
                }
                if (flag !== undefined && !isNonEmptyString(flag)) {
                  errors.push(`${cat}.requires.flag 必须是非空字符串`);
                }
              }
            }

            if (choice.effects !== undefined) {
              if (!isPlainObject(choice.effects) || Object.keys(choice.effects).length === 0) {
                errors.push(`${cat}.effects 必须是非空对象`);
              } else {
                Object.entries(choice.effects).forEach(([key, value]) => {
                  if (!VALID_EFFECT_KEYS.includes(key)) {
                    errors.push(`${cat}.effects 含未知字段: ${key}`);
                    return;
                  }
                  if (key === "xp" || key === "gold") {
                    if (!Number.isInteger(value) || value <= 0 || value > 9999) {
                      errors.push(`${cat}.effects.${key} 必须是 1–9999 的整数`);
                    }
                  } else if (key === "hp" || key === "mp") {
                    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 9999) {
                      errors.push(`${cat}.effects.${key} 必须是非零整数（绝对值 ≤ 9999）`);
                    }
                  } else if (!isNonEmptyString(value)) {
                    errors.push(`${cat}.effects.${key} 必须是非空字符串`);
                  }
                });
              }
            }
          });
        }
      }

      if (scene.phases !== undefined) {
        if (scene.kind !== "boss") {
          errors.push(`${at}.phases 只允许出现在 kind='boss' 的场景上`);
        }
        if (!Array.isArray(scene.phases) || scene.phases.length === 0) {
          errors.push(`${at}.phases 必须是非空数组`);
        } else {
          scene.phases.forEach((phase, p) => {
            const pat = `${at}.phases[${p}]`;
            if (!isPlainObject(phase)) {
              errors.push(`${pat} 必须是对象`);
              return;
            }
            ["id", "title", "desc"].forEach((field) => {
              if (!isNonEmptyString(phase[field])) {
                errors.push(`${pat}.${field} 必须是非空字符串`);
              }
            });
          });
        }
      }
    });
  });

  // Pass 4: the finale must actually stage a multi-phase boss fight.
  const finale = chapters[CHAPTER_COUNT - 1];
  if (isPlainObject(finale) && Array.isArray(finale.scenes)) {
    const multiPhase = finale.scenes.some(
      (s) => isPlainObject(s) && s.kind === "boss" && Array.isArray(s.phases) && s.phases.length >= 2
    );
    if (!multiPhase) {
      errors.push("第 8 章必须包含至少一个带 phases（≥2 阶段）的 boss 场景");
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function clearCache() {
  cached = null;
  derived = null;
}

// Reads + validates once, lazily. Throws on any validation error so a corrupt
// data file fails on the first call that touches chapter data (e.g. the first
// /chapters request 500s) instead of midway through a playthrough. The process
// itself still boots and listens — validation is not a boot-time gate.
function loadChapters() {
  if (cached) return cached;

  let raw;
  try {
    raw = fs.readFileSync(DATA_PATH, "utf8");
  } catch (err) {
    throw new Error(`无法读取 chapters.json (${DATA_PATH}): ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`chapters.json 不是合法 JSON: ${err.message}`);
  }

  const { ok, errors } = validateChapters(data);
  if (!ok) {
    const err = new Error(`chapters.json 校验失败（${errors.length} 项）:\n- ${errors.join("\n- ")}`);
    err.code = "CHAPTERS_INVALID";
    err.details = errors;
    throw err;
  }

  cached = data;
  derived = null;
  return cached;
}

// Chapter array in index order. Shallow copy so callers can't splice the cache.
function listChapters() {
  return loadChapters().chapters.slice();
}

function buildIndex() {
  const data = loadChapters();
  if (derived && derived.data === data) return derived;

  const byIndex = new Map();
  const byId = new Map();
  const scenes = new Map();

  data.chapters.forEach((chapter) => {
    byIndex.set(chapter.index, chapter);
    byId.set(chapter.id, chapter);
    chapter.scenes.forEach((scene) => {
      if (!scenes.has(scene.id)) scenes.set(scene.id, scene);
    });
  });

  derived = { data, byIndex, byId, scenes };
  return derived;
}

// Accepts 1-based index (number or numeric string) or a chapter id like "ch3".
function getChapter(indexOrId) {
  if (indexOrId === null || indexOrId === undefined) return null;
  const { byIndex, byId } = buildIndex();

  let key = indexOrId;
  if (typeof key === "string" && /^\d+$/.test(key.trim())) key = Number(key.trim());
  if (typeof key === "string") return byId.get(key) || null;
  if (typeof key === "number" && Number.isInteger(key)) return byIndex.get(key) || null;
  return null;
}

function getScene(sceneId) {
  if (typeof sceneId !== "string" || sceneId === "") return null;
  return buildIndex().scenes.get(sceneId) || null;
}

// Which chapter a scene belongs to (or null). Handy for the map panel.
function getChapterOfScene(sceneId) {
  if (typeof sceneId !== "string" || sceneId === "") return null;
  return listChapters().find((c) => c.scenes.some((s) => s.id === sceneId)) || null;
}

// Entry scene for a save. Uses save.scene when it still belongs to save.chapter,
// otherwise falls back to the first scene of the chapter's main chain — the
// same landing spot the 「前进」self-heal writes (chapterPath(chapter)[0]).
function currentScene(save) {
  if (!isPlainObject(save)) return null;

  const chapter = getChapter(save.chapter);
  if (!chapter || !Array.isArray(chapter.scenes) || chapter.scenes.length === 0) return null;

  if (typeof save.scene === "string" && save.scene !== "") {
    const scene = getScene(save.scene);
    if (scene && chapter.scenes.some((s) => s.id === scene.id)) return scene;
  }

  return firstSceneOf(chapter);
}

// ---------------------------------------------------------------------------
// 场景运行时（F074/F075）
// ---------------------------------------------------------------------------

// 本章首个场景：主线链首（currentScene 兜底 / 首推自愈 / 章节门落点同源）。
function firstSceneOf(chapter) {
  const path = chapterPath(chapter);
  return path[0] || null;
}

// scene.id 在本章 scenes[] 的下标（0 基；-1 = 不属于本章）。
function sceneIndexIn(chapter, sceneId) {
  const scenes = chapter && Array.isArray(chapter.scenes) ? chapter.scenes : [];
  return scenes.findIndex((s) => s && s.id === sceneId);
}

// 场景的默认下一步：next_scene，缺失时取首个带目标的选择项的 next。
// 返回值可能为 null（终点场景）或跨界/悬空 id，调用方自行兜底。
function nextSceneOf(scene) {
  if (!scene || typeof scene !== "object") return null;
  if (typeof scene.next_scene === "string" && scene.next_scene) return scene.next_scene;
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  const pick = choices.find((c) => c && typeof c.next === "string" && c.next);
  return pick ? pick.next : null;
}

// 本章主线链：从首场景出发，只沿 next_scene（缺失时取首个指向本章内
// 未到访场景的 choices[].next，如 ch8_beru.final -> ch8_aftermath）前进，
// 到链尾即止。绝不用数组顺序补位：支线场景（如 ch1_watch / ch1_death）
// 只能通过对应 choice 进入，不计入主线进度；链长度即 chapter_total
// （ch1 = 7，不是 scenes.length = 9）。
function chapterPath(chapter) {
  const scenes = chapter && Array.isArray(chapter.scenes) ? chapter.scenes : [];
  const byId = new Map(scenes.map((s) => [s && s.id, s]));
  const path = [];
  const seen = new Set();
  let cur = scenes[0] || null;
  while (cur && !seen.has(cur.id)) {
    path.push(cur);
    seen.add(cur.id);
    let nextId =
      typeof cur.next_scene === "string" && cur.next_scene && !seen.has(cur.next_scene) && byId.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nextId) {
      const pick = (Array.isArray(cur.choices) ? cur.choices : []).find(
        (c) => c && typeof c.next === "string" && c.next && !seen.has(c.next) && byId.has(c.next)
      );
      nextId = pick ? pick.next : null;
    }
    cur = nextId ? byId.get(nextId) : null;
  }
  return path;
}

// scene.id 在主线链中的位置（0 基；-1 = 不在链上：支线场景/错章/悬空）。
function pathIndexOf(chapter, sceneId) {
  return chapterPath(chapter).findIndex((s) => s && s.id === sceneId);
}

// 下一章准入（章节门）：当前是软门——unlock.chapter（已抵达前置章节）与
// unlock.level（推荐等级）满足其一即可进入。返回 { ok, level, chapter,
// level_ok, chapter_ok }：ok 是放行结论，level_ok / chapter_ok 分别暴露
// 两条腿的判定，供结算播报与 saveView.chapter_unlock 显性化（等级不足也
// 放行，但必须写明压制提示，不得静默）。
// TODO(F088): F082 升级闭环落地后，此处改回 AND 语义（等级是硬门）；现在 AND 会让 Lv1 存档永久卡在 1 章，因为服务端尚无升级路径。
function unlockedFor(save, chapter) {
  const req = chapter && chapter.unlock;
  const levelReq = req && Number.isInteger(req.level) ? req.level : null;
  const chapterReq = req && Number.isInteger(req.chapter) ? req.chapter : null;
  const level = Math.trunc(Number(save && save.level) || 0);
  const ch = Math.trunc(Number(save && save.chapter) || 0);
  const levelOk = levelReq === null ? true : level >= levelReq;
  const chapterOk = chapterReq === null ? true : ch >= chapterReq;
  const ok =
    (levelReq !== null && level >= levelReq) ||
    (chapterReq !== null && ch >= chapterReq) ||
    (levelReq === null && chapterReq === null);
  return { ok, level: levelReq, chapter: chapterReq, level_ok: levelOk, chapter_ok: chapterOk };
}

// F116 解锁门视图：判定仍走 unlockedFor（F093 软门口径与数值一律不动），
// 本函数只把判定翻译成展示态 —— state（locked/soft/open）+
// blocked_reasons（仅列尚未满足的前置，已满足的条件不出现）+
// hint（服务端写好的诚实文案）。/api/chapters 与 saveView.chapter_unlock
// 共用此出口，前端不再自拼「需 Lv.X / 需完成第X章主线」，软门期间地图
// 也不许再写「锁定」。
function unlockView(save, chapter) {
  const gate = unlockedFor(save, chapter);
  const blockedReasons = [];
  if (gate.chapter !== null && !gate.chapter_ok) {
    blockedReasons.push(`需完成第${gate.chapter}章主线`);
  }
  if (gate.level !== null && !gate.level_ok) {
    blockedReasons.push(`需 Lv.${gate.level}`);
  }
  let state;
  let hint;
  if (!gate.ok) {
    state = "locked";
    hint = blockedReasons.join(" · ") || null;
  } else if (blockedReasons.length === 0) {
    state = "open";
    hint = null;
  } else {
    // 软门：OR 判定放行但仍有未达前置 —— 诚实写「推荐 X · 可强行进入」，
    // 不出现「锁定」措辞。
    state = "soft";
    const softReqs = [];
    if (gate.chapter !== null && !gate.chapter_ok) softReqs.push(`完成第${gate.chapter}章主线`);
    if (gate.level !== null && !gate.level_ok) softReqs.push(`Lv.${gate.level}`);
    hint = `推荐 ${softReqs.join("、")} · 可强行进入（受压制）`;
  }
  return { ...gate, state, blocked_reasons: blockedReasons, hint };
}

module.exports = {
  DATA_PATH,
  VALID_KINDS,
  VALID_ENCOUNTERS,
  VALID_REQUIRE_KEYS,
  VALID_EFFECT_KEYS,
  CHAPTER_COUNT,
  loadChapters,
  clearCache,
  validateChapters,
  listChapters,
  getChapter,
  getScene,
  getChapterOfScene,
  currentScene,
  firstSceneOf,
  sceneIndexIn,
  nextSceneOf,
  chapterPath,
  pathIndexOf,
  unlockedFor,
  unlockView,
};
