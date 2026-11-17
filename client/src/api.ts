const API = "/game/api";

export interface Stats {
  strength: number;
  agility: number;
  vitality: number;
  intelligence: number;
  perception: number;
}

export type StatKey = keyof Stats;

export interface CombatEnemy {
  id: string | null;
  name: string;
  rank: string;
  level: number;
  hp: number;
  max_hp: number;
  atk: number;
  def: number;
}

// F088 服务端交战态：save.combat 非空即真实交战，敌人 HP/回合全部可信。
export interface CombatState {
  enemy: CombatEnemy;
  turn: number;
  started_at: string | null;
}

// F116 解锁门三态：服务端 chaptersEngine.unlockView 统一下发，
// 前端只渲染 state/blocked_reasons/hint，不再自拼门槛文案。
export type ChapterGateState = "locked" | "soft" | "open";

export interface ChapterUnlockView {
  level: number | null;
  chapter: number | null;
  level_ok?: boolean;
  chapter_ok?: boolean;
  state?: ChapterGateState | null;
  blocked_reasons?: string[];
  hint: string | null;
}

// F117 章尾入口：advance_mode === "next_chapter" 时主按钮按此换标
// 「进入第N章 · 章名」——章号/章名由服务端数据下发，不写死。
export interface NextChapterView {
  index: number;
  id: string;
  title: string;
  subtitle: string;
}

export interface SceneChoice {
  id: string;
  label: string;
  // F196：服务端把该选项 effects 的代价折成一句话（「体力 −5」），
  // 无可见代价时为 null，前端原样渲染不自算。
  cost?: string | null;
}

// F086 休息可用性：服务端统一给出口径（满状态/次数用尽/交战中），
// 前端只消费 reason 文案，不各自推导。
export interface RestStatus {
  available: boolean;
  remaining: number;
  reason: string | null;
}

export interface Save {
  id: number;
  player_name: string;
  level: number;
  rank: string;
  xp: number;
  xp_to_next: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  stats: Stats;
  free_points: number;
  gold: number;
  kills: number;
  deaths: number;
  chapter: number;
  combat: CombatState | null;
  rest: RestStatus;
  cleared: boolean;
  // F089 终章态信号（=cleared，当前场景即 ch8_epilogue）：前端按字段渲染
  // 「查看结算」入口与终章横幅，不做文本匹配。
  at_epilogue: boolean;
  // F096 收尾：守关者未击杀而人站在 boss 场景之后（含章尾）时主按钮的
  // 真实语义——"retreat_to_boss" = 折返回守关房再战，"advance" = 正常
  // 推进。F121：人已站在守关房内且无交战时下发 "challenge_boss"——
  // 主按钮换标「叫阵守关者」、点击发起「攻击」就地开战。
  // 服务端按主线链位置下发，前端只按字段换标。
  // F117："next_chapter" = 人已站在已击杀守关者的主线链尾——主按钮换标
  // 「进入第N章 · 章名」，点击过门穿章（零消耗、不掷遭遇、不计步）。
  advance_mode: "advance" | "retreat_to_boss" | "challenge_boss" | "next_chapter";
  // F074 场景运行时字段（saveView 派生，服务端结算）：
  // 当前场景 + 本章主线进度 steps/total + 本章 unlock 软门判定。
  scene: string | null;
  scene_title: string | null;
  scene_index: number;
  chapter_steps: number;
  chapter_total: number;
  chapter_progress: string;
  chapter_completed: boolean;
  chapter_unlock: ChapterUnlockView | null;
  next_chapter: NextChapterView | null;
  next_choices: SceneChoice[];
  // F081：技能可释放性视图（目录字段 + unlocked/cooldown_remaining/
  // mp_enough/engaged/can_cast/reason），服务端随存档下发，前端只渲染。
  skills: Skill[];
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

// ── 战斗数值折算 ──
// 与 server/engine/stats.js 保持一致，改动需两边同步：
//   攻击基数 = 1.6 × 力量（K.dmgStr），防御基数 = 0.8 × 体力（K.dmgPerVit）。
// 展示口径：基础值 floor 取整后叠加装备加成，合计 = base + equipment.atk/def。
export const baseAttack = (s: Stats) => Math.floor(Math.max(0, Number(s.strength) || 0) * 1.6);
export const baseDefense = (s: Stats) => Math.floor(Math.max(0, Number(s.vitality) || 0) * 0.8);

export interface InventoryRow {
  item_id: string;
  qty: number;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  mp_cost: number;
  cooldown: number;
  power: number;
  rarity: ItemRarity;
  learn_level: number;
  // F111 服务端随 save.skills 下发的引擎同源预计伤害区间（目录接口不带）。
  damage_preview?: { min: number; max: number };
  // F081 服务端随 save.skills 下发的可释放性（旧 /skills 目录响应不带）。
  unlocked?: boolean;
  cooldown_remaining?: number;
  mp_enough?: boolean;
  engaged?: boolean;
  can_cast?: boolean;
  reason?: "等级不足" | "冷却中" | "MP 不足" | "无交锋目标" | null;
}

export type MainQuestStatus = "active" | "done" | "locked";
export type DailyQuestStatus = "active" | "done";

export interface QuestProgress {
  current: number;
  target: number;
}

export interface QuestReward {
  xp: number;
  gold: number;
  items?: { id: string; name: string; qty: number }[];
}

export interface MainQuest {
  id: string;
  chapter: number;
  title: string;
  desc: string;
  progress: QuestProgress;
  reward: QuestReward;
  status: MainQuestStatus;
}

export interface DailyQuest {
  id: string;
  title: string;
  desc: string;
  progress: QuestProgress;
  reward: QuestReward;
  status: DailyQuestStatus;
}

export interface QuestPenalty {
  active: boolean;
  seconds_left: number;
  desc: string;
}

export interface QuestsView {
  main: MainQuest[];
  daily: DailyQuest[];
  daily_reset_at: string;
  penalty: QuestPenalty;
}

export interface EndingStats {
  level: number;
  kills: number;
  shadows: number;
  clear_time: string;
  chapters_cleared: number;
}

export interface Ending {
  chapter: number;
  title: string;
  epilogue: string;
  stats: EndingStats;
  lines: string[];
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

// F136 存档找回：同名匹配由服务端 NFKC+trim+大小写折叠精确匹配，
// 前端只透传代号并渲染 saves 摘要数组，不在本地另算口径。
export interface SaveSummary {
  id: number;
  player_name: string;
  level: number;
  chapter: number;
  hp: number;
  max_hp: number;
  cleared_at: string | null;
  created_at: string;
  updated_at: string;
}

export const findSaves = (player_name: string) =>
  req<{ saves: SaveSummary[] }>(`/saves?player_name=${encodeURIComponent(player_name)}`).then(
    (r) => r.saves
  );

// mode === "new"：玩家在重名对话框里明确选「另起新档」，服务端才允许
// 同名并存（旧档不删）；缺省走重名检测，命中即 409。
export const createSave = (player_name: string, mode?: "new") =>
  req<{ save: Save }>("/saves", {
    method: "POST",
    body: JSON.stringify(mode ? { player_name, mode } : { player_name }),
  }).then((r) => r.save);

export const getSave = (id: number) =>
  req<{ save: Save; inventory: InventoryRow[]; equipment: Equipment }>(`/saves/${id}`);

export const getLog = (id: number, limit = 50) =>
  req<{ log: LogEntry[] }>(`/saves/${id}/log?limit=${limit}`).then((r) => r.log);

export const getItems = () => req<{ items: Item[] }>("/items").then((r) => r.items);

// 技能目录与物品目录同为纯数据，只读；习得/解锁由 learn_level 与存档等级判定。
export const getSkills = () => req<{ skills: Skill[] }>("/skills").then((r) => r.skills);

// ── 地图面板（F090）──
// 章节静态信息 + 按存档推导的三态/主线进度，全部服务端结算，面板只渲染。

export type ChapterState = "cleared" | "current" | "locked";

export interface ChapterView {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  summary: string;
  // F116：unlock 携带服务端门态（state/blocked_reasons/hint），
  // 地图面板按字段渲染——软门写「可强行进入」，不再自拼「需 Lv.X」。
  unlock: ChapterUnlockView;
  scene_count: number;
  main_total: number;
  state: ChapterState;
  progress: QuestProgress;
}

export const getChapters = (saveId: number) =>
  req<{ chapters: ChapterView[] }>(`/chapters?save_id=${saveId}`).then((r) => r.chapters);

// 任务视图：主线由章节推导，每日进度与惩罚倒计时全部服务端结算。
export const getQuests = (id: number) => req<QuestsView>(`/saves/${id}/quests`);

// 通关结算：等级/击杀/影子/耗时全部服务端按存档实时结算，本地只渲染。
export const fetchEnding = (saveId: number): Promise<Ending> =>
  req<{ ending: Ending }>(`/saves/${saveId}/ending`).then((r) => r.ending);

// 背包操作：只传 item_id 与 op，所有数值（回复量、装备加成、qty）由服务端决定。
export const useItem = (save_id: number, item_id: string, op: ItemOp) =>
  req<{ reply: LogEntry; save: Save; inventory: InventoryRow[]; equipment: Equipment }>(
    `/saves/${save_id}/item`,
    { method: "POST", body: JSON.stringify({ item_id, op }) }
  );

// 属性点分配：只报要加哪一项，扣点与上限联动由服务端结算后回灌存档。
export const spendStat = (save_id: number, stat: StatKey) =>
  req<{ reply: LogEntry | null; save: Save; inventory: InventoryRow[]; equipment: Equipment }>(
    `/saves/${save_id}/spend`,
    { method: "POST", body: JSON.stringify({ stat }) }
  );

export const sendAction = (save_id: number, input: string) =>
  req<{ reply: LogEntry; save: Save; shadows?: ShadowFormation; ending_ready?: boolean }>("/action", {
    method: "POST",
    body: JSON.stringify({ save_id, input }),
  });

// ── 影子编队（F051）──
// 出战位上限/战力由服务端结算；面板只渲染视图并上报 shadow_id + op。

export interface ShadowStats {
  atk: number;
  def: number;
  hp: number;
}

export interface Shadow {
  id: string;
  name: string;
  rank: string;
  level: number;
  source: string | null;
  skills: unknown[];
  deployed: boolean;
  stats: ShadowStats;
  power: number;
  createdAt: string;
}

export interface ShadowFormation {
  max: number;
  count: number;
  power: number;
  shadows: Shadow[];
}

export const getShadows = (id: number) =>
  req<{ shadows: Shadow[]; formation: Omit<ShadowFormation, "shadows"> }>(`/saves/${id}/shadows`);

export const setShadowDeployment = (save_id: number, shadow_id: string, op: "deploy" | "undeploy") =>
  req<{
    reply: LogEntry;
    shadows: Shadow[];
    formation: Omit<ShadowFormation, "shadows">;
    save: Save;
  }>(`/saves/${save_id}/shadow`, {
    method: "POST",
    body: JSON.stringify({ shadow_id, op }),
  });
