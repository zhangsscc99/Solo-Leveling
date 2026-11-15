import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createSave, getLog, getSave, sendAction, LogEntry, Save } from "./api";

const STORAGE_KEY = "solo_leveling_save_id";

function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: "hp" | "mp" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar">
        <div className={`bar-fill ${kind}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-text">
        {value}/{max}
      </span>
    </div>
  );
}

function StatusPanel({ save }: { save: Save }) {
  const s = save.stats;
  return (
    <div className="panel status">
      <div className="status-top">
        <span className="status-name">{save.player_name}</span>
        <span className="status-rank">{save.rank}</span>
        <span className="status-meta">Lv.{save.level}</span>
        <span className="status-meta">第 {save.chapter} 章</span>
        <span className="status-meta">金币 {save.gold}</span>
        <span className="status-meta">XP {save.xp}</span>
      </div>
      <div className="bars">
        <Bar label="HP" value={save.hp} max={save.max_hp} kind="hp" />
        <Bar label="MP" value={save.mp} max={save.max_mp} kind="mp" />
      </div>
      <div className="stats-row">
        <span>力量 <b>{s.strength}</b></span>
        <span>敏捷 <b>{s.agility}</b></span>
        <span>体力 <b>{s.vitality}</b></span>
        <span>智力 <b>{s.intelligence}</b></span>
        <span>感知 <b>{s.perception}</b></span>
      </div>
    </div>
  );
}

export default function App() {
  const [save, setSave] = useState<Save | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLoading(false);
      return;
    }
    getSave(Number(raw))
      .then(async ({ save }) => {
        setSave(save);
        setLog(await getLog(save.id));
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const onCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const playerName = name.trim();
      if (!playerName || busy) return;
      setBusy(true);
      setError(null);
      try {
        const created = await createSave(playerName);
        localStorage.setItem(STORAGE_KEY, String(created.id));
        setSave(created);
        setLog(await getLog(created.id));
      } catch {
        setError("存档创建失败，请重试。");
      } finally {
        setBusy(false);
      }
    },
    [name, busy]
  );

  const onSend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !save || busy) return;
      setBusy(true);
      setInput("");
      const userEntry: LogEntry = { id: Date.now(), role: "user", content: text };
      setLog((l) => [...l, userEntry]);
      try {
        const { reply, save: updated } = await sendAction(save.id, text);
        setSave(updated);
        setLog((l) => [...l, reply]);
      } catch {
        setLog((l) => [
          ...l,
          { id: Date.now() + 1, role: "system", content: "【系统】连接中断，请稍后再试。" },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [input, save, busy]
  );

  if (loading) {
    return <div className="app"><div className="create"><p className="sub">载入中……</p></div></div>;
  }

  if (!save) {
    return (
      <div className="app">
        <div className="create">
          <h1>SOLO LEVELING</h1>
          <p className="sub">
            最弱的 E 级猎人，在双重地下城的尽头获得了「系统」。
            <br />
            输入你的名字，开始这段从底层登顶的旅程。
          </p>
          <form onSubmit={onCreate}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="猎人代号"
              maxLength={20}
              autoFocus
            />
            <button type="submit" disabled={busy || !name.trim()}>
              觉醒
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <StatusPanel save={save} />
      <div className="panel log" ref={logRef}>
        {log.map((entry) => (
          <div key={entry.id} className={`log-entry ${entry.role}`}>
            {entry.content}
          </div>
        ))}
      </div>
      <form className="panel input-bar" onSubmit={onSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的行动……（试试「状态」「帮助」「观察」「前进」）"
          autoFocus
        />
        <button type="submit" disabled={busy || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
