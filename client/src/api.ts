const API = "/game/api";

export interface Stats {
  strength: number;
  agility: number;
  vitality: number;
  intelligence: number;
  perception: number;
}

export interface Save {
  id: number;
  player_name: string;
  level: number;
  rank: string;
  xp: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  stats: Stats;
  gold: number;
  chapter: number;
}

export interface LogEntry {
  id: number;
  role: "user" | "system" | "narrator";
  content: string;
  created_at?: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export const createSave = (player_name: string) =>
  req<{ save: Save }>("/saves", {
    method: "POST",
    body: JSON.stringify({ player_name }),
  }).then((r) => r.save);

export const getSave = (id: number) =>
  req<{ save: Save; inventory: { item_id: string; qty: number }[] }>(`/saves/${id}`);

export const getLog = (id: number, limit = 50) =>
  req<{ log: LogEntry[] }>(`/saves/${id}/log?limit=${limit}`).then((r) => r.log);

export const sendAction = (save_id: number, input: string) =>
  req<{ reply: LogEntry; save: Save }>("/action", {
    method: "POST",
    body: JSON.stringify({ save_id, input }),
  });
