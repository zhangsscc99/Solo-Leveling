const path = require("path");
const express = require("express");
const store = require("./db");

const VERSION = "0.1.0";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3020);
const BASE = "/game";

const app = express();
app.use(express.json());

// Placeholder action resolver. Once the AI narrative engine (OpenCode Go) is
// integrated, this is the single seam where requests get delegated to it.
function resolveAction(save, input) {
  const s = save.stats;
  if (/状态|面板|status/i.test(input)) {
    return {
      role: "system",
      content:
        `【状态】${save.player_name} — Lv.${save.level} · ${save.rank}级猎人 · 第${save.chapter}章\n` +
        `HP ${save.hp}/${save.max_hp} · MP ${save.mp}/${save.max_mp} · XP ${save.xp} · 金币 ${save.gold}\n` +
        `力量 ${s.strength} · 敏捷 ${s.agility} · 体力 ${s.vitality} · 智力 ${s.intelligence} · 感知 ${s.perception}`,
    };
  }
  if (/帮助|help/i.test(input)) {
    return {
      role: "system",
      content: "【系统】可用指令：状态 / 帮助 / 观察 / 前进。更多指令将随剧情推进解锁。",
    };
  }
  if (/观察|查看|四周|环境/.test(input)) {
    return {
      role: "narrator",
      content: "你环顾四周：残破的神殿大厅内烛火摇曳，远处的石门紧闭，门缝里渗出幽蓝色的微光。空气中弥漫着尘土与铁锈的气味。",
    };
  }
  if (/前进|走|移动|离开|进入/.test(input)) {
    return {
      role: "narrator",
      content: "你朝着那扇渗着蓝光的石门走去。就在指尖触及门扉的一瞬，光幕弹出——",
    };
  }
  return {
    role: "system",
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
  const saveId = Number(req.body && req.body.save_id);
  const input = String((req.body && req.body.input) || "").trim();
  const save = store.getSave(saveId);
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  if (!input) {
    return res.status(400).json({ error: "input is required" });
  }
  store.appendLog(save.id, "user", input);
  const { role, content } = resolveAction(save, input);
  const reply = store.appendLog(save.id, role, content);
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
