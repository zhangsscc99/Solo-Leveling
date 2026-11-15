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

export type ItemCategory = "weapon" | "armor" | "consumable" | "material";
export type ItemRarity = "common" | "rare" | "epic" | "legendary";
export type ItemOp = "use" | "equip" | "discard";

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  desc: string;
  atk?: number;
  def?: number;
  heal?: number;
  mp?: number;
}

export interface EquippedSlot {
  item_id: string;
  name: string;
  rarity: ItemRarity;
  atk: number;
  def: number;
}

export interface Equipment {
  weapon: EquippedSlot | null;
  armor: EquippedSlot | null;
  atk: number;
  def: number;
}

export interface InventoryRow {
  item_id: string;
  qty: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    // 服务端的 {error} 文案（如「当前状态已是满值」）优先透出，便于面板提示。
    let message = `API ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error) message = body.error;
    } catch {
      /* 非 JSON 响应，保留状态码文案 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const createSave = (player_name: string) =>
  req<{ save: Save }>("/saves", {
    method: "POST",
    body: JSON.stringify({ player_name }),
  }).then((r) => r.save);

export const getSave = (id: number) =>
  req<{ save: Save; inventory: InventoryRow[]; equipment: Equipment }>(`/saves/${id}`);

export const getLog = (id: number, limit = 50) =>
  req<{ log: LogEntry[] }>(`/saves/${id}/log?limit=${limit}`).then((r) => r.log);

export const getItems = () => req<{ items: Item[] }>("/items").then((r) => r.items);

// 背包操作：只传 item_id 与 op，所有数值（回复量、装备加成、qty）由服务端决定。
export const useItem = (save_id: number, item_id: string, op: ItemOp) =>
  req<{ reply: LogEntry; save: Save; inventory: InventoryRow[]; equipment: Equipment }>(
    `/saves/${save_id}/item`,
    { method: "POST", body: JSON.stringify({ item_id, op }) }
  );

export const sendAction = (save_id: number, input: string) =>
  req<{ reply: LogEntry; save: Save }>("/action", {
    method: "POST",
    body: JSON.stringify({ save_id, input }),
  });
