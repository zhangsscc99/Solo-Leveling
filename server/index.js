const path = require("path");
const express = require("express");
const store = require("./db");

const VERSION = "0.1.0";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3020);
const BASE = "/game";

const app = express();
app.use(express.json());

const MAX_INPUT_LEN = 200;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function vitalsLine(save) {
  return `HP ${save.hp}/${save.max_hp} · MP ${save.mp}/${save.max_mp}`;
}

// Whitelisted intents. Each entry owns its keyword match, log role, the
// deterministic state delta and the narration text — every number is computed
// here on the server, never taken from the client payload.
const INTENTS = [
  {
    id: "status",
    role: "system",
    match: /状态|面板|属性|status|stat/i,
    build: (save) => {
      const s = save.stats || {};
      return {
        patch: null,
        content:
          `【状态】${save.player_name} — Lv.${save.level} · ${save.rank}级猎人 · 第${save.chapter}章\n` +
          `${vitalsLine(save)} · XP ${save.xp} · 金币 ${save.gold}\n` +
          `力量 ${s.strength} · 敏捷 ${s.agility} · 体力 ${s.vitality} · 智力 ${s.intelligence} · 感知 ${s.perception}`,
      };
    },
  },
  {
    id: "help",
    role: "system",
    match: /帮助|指令|help/i,
    build: () => ({
      patch: null,
      content:
        "【系统】可用指令：\n" +
        "「状态」查看属性面板 · 「帮助」列出指令 · 「观察」环顾四周\n" +
        "「前进」推进剧情（消耗少量体力） · 「潜行」压低气息（消耗 5 MP）\n" +
        "「休息」恢复体力与魔力 · 「存档」写入当前进度\n" +
        "其余自由输入将交由叙事层判定，未识别的动作不会改变状态。",
    }),
  },
  {
    id: "observe",
    role: "narrator",
    match: /观察|查看|环顾|四周|环境|look/i,
    build: () => ({
      patch: null,
      content:
        "你环顾四周：残破的神殿大厅内烛火摇曳，远处的石门紧闭，门缝里渗出幽蓝色的微光，空气里弥漫着尘土与铁锈的气味。石像的嘴角似乎还残留着那抹笑意。",
    }),
  },
  {
    id: "advance",
    role: "narrator",
    match: /前进|探索|走|移动|离开|进入|advance|go/i,
    build: (save) => {
      const hp = clamp(save.hp - 3, 1, save.max_hp);
      const mp = clamp(save.mp - 2, 0, save.max_mp);
      return {
        patch: { hp, mp },
        content:
          `你踩着碎石向那扇石门挪去，脚下的石砖忽然下沉半寸，机关咬合的声音在暗处响起。你屏住呼吸，从缝隙里挤了过去。\n` +
          `（体力消耗 HP ${save.hp}→${hp} · MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "sneak",
    role: "narrator",
    match: /潜行|藏匿|隐蔽|sneak|stealth/i,
    build: (save) => {
      const mp = clamp(save.mp - 5, 0, save.max_mp);
      return {
        patch: { mp },
        content:
          `你把魔力压进四肢，脚步轻得几乎没有声音。石像的目光扫过你所立之处，停顿了一瞬——又缓缓移开。\n` +
          `（魔力消耗 MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "rest",
    role: "narrator",
    match: /休息|睡觉|休整|小憩|rest|sleep/i,
    build: (save) => {
      const hp = clamp(save.hp + 15, 0, save.max_hp);
      const mp = clamp(save.mp + 8, 0, save.max_mp);
      return {
        patch: { hp, mp },
        content:
          `你背靠石柱坐下，闭上眼调整呼吸。系统在视野边缘安静地跳动着，体力与魔力一点点回流。\n` +
          `（恢复 HP ${save.hp}→${hp} · MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "save",
    role: "system",
    match: /存档|保存|save/i,
    build: (save) => ({
      patch: null,
      content: `【系统】存档已写入。第${save.chapter}章 · Lv.${save.level} · ${vitalsLine(save)} · 金币 ${save.gold}。`,
    }),
  },
];

const PLACEHOLDER = {
  role: "system",
  content: null, // filled per-request with the raw input
};

function resolveAction(save, input) {
  for (const intent of INTENTS) {
    if (intent.match.test(input)) {
      const built = intent.build(save);
      return { intent: intent.id, role: intent.role, patch: built.patch, content: built.content };
    }
  }
  return {
    intent: "unknown",
    role: PLACEHOLDER.role,
    patch: null,
    content: `【系统】指令已接收：「${input}」。命运之线仍在编织中……（叙事引擎尚未接入，此处为占位回应。输入「帮助」查看当前可用指令。）`,
  };
}

const api = express.Router();

api.get("/health", (req, res) => {
  res.json({ ok: true, version: VERSION });
});

api.post("/saves", (req, res) => {
  const playerName = String((req.body && req.body.player_name) || "").trim();
  if (!playerName) {
    return res.status(400).json({ error: "player_name is required" });
  }
  res.status(201).json({ save: store.createSave(playerName) });
});

api.get("/saves/:id", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  res.json({ save, inventory: store.getInventory(save.id) });
});

api.get("/saves/:id/log", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ log: store.getLog(save.id, limit) });
});

api.post("/action", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // save_id must be a positive integer, whether sent as a number or numeric string.
  const rawId = body.save_id;
  const saveId =
    typeof rawId === "number" ? rawId : typeof rawId === "string" && rawId.trim() !== "" ? Number(rawId) : NaN;
  if (!Number.isInteger(saveId) || saveId <= 0) {
    return res.status(400).json({ error: "save_id must be a positive integer" });
  }

  // input must be a non-empty string of at most MAX_INPUT_LEN characters.
  const rawInput = body.input;
  if (typeof rawInput !== "string") {
    return res.status(400).json({ error: "input is required" });
  }
  const input = rawInput.trim();
  if (!input) {
    return res.status(400).json({ error: "input is required" });
  }
  if (input.length > MAX_INPUT_LEN) {
    return res.status(400).json({ error: `input must be at most ${MAX_INPUT_LEN} characters` });
  }

  const save = store.getSave(saveId);
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }

  store.appendLog(save.id, "user", input);

  // Server-side authority: the resolved intent's own delta is applied and the
  // result is clamped, so any numbers in the client payload are ignored.
  const outcome = resolveAction(save, input);
  if (outcome.patch) {
    store.updateSave(save.id, outcome.patch);
  }
  const reply = store.appendLog(save.id, outcome.role, outcome.content);
  res.json({ reply, save: store.getSave(save.id) });
});

api.use((req, res) => res.status(404).json({ error: "not found" }));

app.use(`${BASE}/api`, api);

const distDir = path.join(__dirname, "..", "client", "dist");
app.get(BASE, (req, res) => res.sendFile(path.join(distDir, "index.html")));
app.use(BASE, express.static(distDir));
app.use(BASE, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`solo-leveling listening on http://${HOST}:${PORT}${BASE}`);
});
