import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  baseAttack,
  baseDefense,
  ChapterView,
  createSave,
  Equipment,
  getChapters,
  getItems,
  getLog,
  getQuests,
  getSave,
  getSkills,
  InventoryRow,
  Item,
  ItemOp,
  sendAction,
  spendStat,
  LogEntry,
  QuestsView,
  Save,
  Shadow,
  ShadowFormation,
  getShadows,
  setShadowDeployment,
  Skill,
  StatKey,
  useItem,
} from "./api";
import CombatPanel, { detectCombatGate } from "./panels/CombatPanel";
import EndingPanel from "./panels/EndingPanel";
import InventoryPanel from "./panels/InventoryPanel";
import MapPanel from "./panels/MapPanel";
import QuestPanel from "./panels/QuestPanel";
import ShadowsPanel from "./panels/ShadowsPanel";
import SkillsPanel from "./panels/SkillsPanel";
import StatsPanel from "./panels/StatsPanel";

const STORAGE_KEY = "solo_leveling_save_id";

const CHAPTERS = [
  "双重地下城",
  "每日任务",
  "猎人协会评级",
  "地下城突袭",
  "转职任务",
  "红门",
  "恶魔城",
  "济州岛",
];

const ACTION_BUTTONS: { label: string; input: string; primary?: boolean; combatBlock?: boolean }[] = [
  { label: "探索前进", input: "前进", primary: true },
  { label: "环顾四周", input: "观察", combatBlock: true },
  { label: "潜行", input: "潜行", combatBlock: true },
  { label: "休息", input: "休息", combatBlock: true },
];

// F094 战斗操作入口：行动栏常驻战斗四键。交战（save.combat，服务端真实
// 交战态）时整组只留这四键——探索组在敌我面前全被服务端门禁改判，
// 「撤离」语义与「逃跑」同一结算（flee + retreatOnFlee），不再单列。
// 无交战时四键常驻 disabled + 可见提示，给玩家明确的「待激活」状态。
// 快捷键沿用 1–4 槽位：键位永远指向当前组内同位置按钮，与系统组 5–9 不冲突。
// 「释放技能」不是指令本身——展开/收起行动栏技能列表（input=null 哨兵）。
const COMBAT_BUTTONS: { label: string; input: string | null }[] = [
  { label: "攻击", input: "攻击" },
  { label: "释放技能", input: null },
  { label: "防御", input: "防御" },
  { label: "逃跑", input: "逃跑" },
];

type TabKey = "inventory" | "skills" | "stats" | "map" | "quests" | "shadows" | "ending";
const TABS: { key: TabKey; label: string }[] = [
  { key: "inventory", label: "背包" },
  { key: "skills", label: "技能" },
  { key: "stats", label: "属性" },
  { key: "map", label: "地图" },
  { key: "quests", label: "任务" },
  { key: "shadows", label: "影子" },
];
// 结算 tab 只在真通关（save.cleared：当前场景为 ch8_epilogue，与服务端
// /ending 门禁同一判定）后出现，不占常驻快捷键位。
const ENDING_TAB: { key: TabKey; label: string } = { key: "ending", label: "结算" };

function RankEmblem({ rank, level }: { rank: string; level: number }) {
  const R = 15.5;
  const C = 2 * Math.PI * R;
  const progress = Math.min(1, (((level - 1) % 10) + 1) / 10);
  const arc = C * (0.12 + 0.88 * progress);
  return (
    <svg className="rank-emblem" viewBox="0 0 48 48" role="img" aria-label={`猎人等级 ${rank}`}>
      <path className="re-diamond" d="M24 2.5 L45.5 24 L24 45.5 L2.5 24 Z" />
      <path className="re-ticks" d="M24 6.5v3M41.5 24h-3M24 41.5v-3M6.5 24h3" />
      <circle className="re-ring" cx="24" cy="24" r={R} />
      <circle
        className="re-arc"
        cx="24"
        cy="24"
        r={R}
        transform="rotate(-90 24 24)"
        strokeDasharray={`${arc.toFixed(1)} ${C.toFixed(1)}`}
      />
      <text className="re-letter" x="24" y="30.5" textAnchor="middle">
        {rank}
      </text>
    </svg>
  );
}

function Gauge({ label, value, max, kind }: { label: string; value: number; max: number; kind: "hp" | "mp" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`gauge gauge-${kind}${pct <= 30 ? " gauge-low" : ""}`}>
      <span className="gauge-label">{label}</span>
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="gauge-num">
        {value}
        <i>/</i>
        {max}
      </span>
    </div>
  );
}

function StatusBar({
  save,
  equipment,
  onOpenDrawer,
}: {
  save: Save;
  equipment: Equipment | null;
  onOpenDrawer: () => void;
}) {
  const s = save.stats;
  // 含装备加成：折算系数与 server/engine/stats.js 保持一致，改动需两边同步。
  const atk = baseAttack(s) + (equipment?.atk ?? 0);
  const def = baseDefense(s) + (equipment?.def ?? 0);
  const chapterName = CHAPTERS[save.chapter - 1] ?? `第${save.chapter}章`;
  return (
    <header className="status">
      <div className="status-id">
        <RankEmblem rank={save.rank} level={save.level} />
        <div className="status-idbox">
          <span className="status-name">{save.player_name}</span>
          <span className="status-sub">
            <span>Lv.{save.level}</span>
            <i className="status-div" />
            <span className="status-chapter">
              <span className="status-chname">
                第{save.chapter}章 {chapterName}
              </span>
              {save.chapter_total > 0 && (
                <i className="status-chprog">
                  {save.chapter_steps}/{save.chapter_total}
                </i>
              )}
            </span>
          </span>
        </div>
      </div>
      <div className="status-gauges">
        <Gauge label="HP" value={save.hp} max={save.max_hp} kind="hp" />
        <Gauge label="MP" value={save.mp} max={save.max_mp} kind="mp" />
      </div>
      <div className="status-nums">
        <span className="stat">
          力<b>{s.strength}</b>
        </span>
        <span className="stat">
          敏<b>{s.agility}</b>
        </span>
        <span className="stat">
          体<b>{s.vitality}</b>
        </span>
        <span className="stat">
          智<b>{s.intelligence}</b>
        </span>
        <span className="stat">
          感<b>{s.perception}</b>
        </span>
        <span className="stat" aria-label={`攻击 ${atk}（含装备加成 ${equipment?.atk ?? 0}）`}>
          攻<b>{atk}</b>
        </span>
        <span className="stat" aria-label={`防御 ${def}（含装备加成 ${equipment?.def ?? 0}）`}>
          防<b>{def}</b>
        </span>
        <span className="stat stat-gold">
          金币<b>{save.gold}</b>
        </span>
        <span className="stat">
          XP<b>{save.xp}</b>
        </span>
      </div>
      <button className="drawer-toggle" onClick={onOpenDrawer} aria-label="打开档案面板">
        档案
      </button>
    </header>
  );
}

function HoloWindow({ entry }: { entry: LogEntry }) {
  const m = entry.content.match(/^【([^】]+)】\s*([\s\S]*)$/);
  const title = m ? m[1] : "系统";
  const body = m ? m[2].trim() : entry.content;
  const danger = /警|错误|失败|中断|危险|惩罚/.test(title);
  return (
    <div className={`holo${danger ? " holo-danger" : ""}`}>
      <div className="holo-inner">
        <div className="holo-title">{title}</div>
        <div className="holo-body">{body}</div>
      </div>
    </div>
  );
}

function StageEntry({ entry }: { entry: LogEntry }) {
  if (entry.role === "system") return <HoloWindow entry={entry} />;
  if (entry.role === "user") {
    return (
      <div className="echo">
        <span className="echo-text">{entry.content}</span>
      </div>
    );
  }
  return <p className="narration">{entry.content}</p>;
}

function SidePanel({
  tab,
  save,
  inventory,
  items,
  equipment,
  itemBusy,
  itemNotice,
  onItemOp,
  skills,
  skillsError,
  busy,
  onRelease,
  statBusy,
  statNotice,
  onSpendStat,
  quests,
  questsError,
  chapters,
  chaptersError,
  shadows,
  shadowsError,
  shadowBusy,
  shadowNotice,
  onToggleShadow,
}: {
  tab: TabKey;
  save: Save;
  inventory: InventoryRow[];
  items: Item[];
  equipment: Equipment | null;
  itemBusy: boolean;
  itemNotice: string | null;
  onItemOp: (itemId: string, op: ItemOp) => void;
  skills: Skill[];
  skillsError: boolean;
  busy: boolean;
  onRelease: (skill: Skill) => void;
  statBusy: boolean;
  statNotice: string | null;
  onSpendStat: (stat: StatKey) => void;
  quests: QuestsView | null;
  questsError: boolean;
  chapters: ChapterView[] | null;
  chaptersError: boolean;
  shadows: ShadowFormation | null;
  shadowsError: boolean;
  shadowBusy: boolean;
  shadowNotice: string | null;
  onToggleShadow: (shadow: Shadow) => void;
}) {
  switch (tab) {
    case "inventory":
      return (
        <InventoryPanel
          save={save}
          inventory={inventory}
          items={items}
          equipment={equipment}
          busy={itemBusy}
          notice={itemNotice}
          onOp={onItemOp}
        />
      );
    case "skills":
      return (
        <SkillsPanel
          save={save}
          skills={skills}
          catalogError={skillsError}
          busy={busy}
          onRelease={onRelease}
        />
      );
    case "stats":
      return (
        <StatsPanel
          save={save}
          equipment={equipment}
          busy={statBusy}
          notice={statNotice}
          onSpend={onSpendStat}
        />
      );
    case "map":
      return <MapPanel data={chapters} error={chaptersError} save={save} />;
    case "quests":
      return <QuestPanel data={quests} error={questsError} />;
    case "shadows":
      return (
        <ShadowsPanel
          data={shadows}
          error={shadowsError}
          busy={shadowBusy}
          notice={shadowNotice}
          onToggle={onToggleShadow}
        />
      );
    case "ending":
      return <EndingPanel saveId={save.id} />;
  }
}

export default function App() {
  const [save, setSave] = useState<Save | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [itemBusy, setItemBusy] = useState(false);
  const [itemNotice, setItemNotice] = useState<string | null>(null);
  const [statBusy, setStatBusy] = useState(false);
  const [statNotice, setStatNotice] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState(false);
  const [quests, setQuests] = useState<QuestsView | null>(null);
  const [questsError, setQuestsError] = useState(false);
  const [chapters, setChapters] = useState<ChapterView[] | null>(null);
  const [chaptersError, setChaptersError] = useState(false);
  const [shadows, setShadows] = useState<ShadowFormation | null>(null);
  const [shadowsError, setShadowsError] = useState(false);
  const [shadowBusy, setShadowBusy] = useState(false);
  const [shadowNotice, setShadowNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("inventory");
  const [drawer, setDrawer] = useState(false);
  const [combatOpen, setCombatOpen] = useState(false);
  const [barSkillOpen, setBarSkillOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<ReturnType<typeof detectCombatGate>>(null);

  useEffect(() => {
    getItems()
      .then(setItems)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getSkills()
      .then(setSkills)
      .catch(() => setSkillsError(true));
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLoading(false);
      return;
    }
    getSave(Number(raw))
      .then(async ({ save, inventory, equipment }) => {
        setSave(save);
        setInventory(inventory);
        setEquipment(equipment);
        setLog(await getLog(save.id));
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // 战斗面板开合：save.combat（服务端真实交战态）是第一信号，日志里的
  // 明确交战信号（遭遇X / 第N回合）做兼容兜底；gate 由 engage 跳变到
  // ended 的那一次收束关闭。边沿触发而非电平触发：ended 残留期内手动
  // 打开的面板不会被后续日志强行关掉，engage 持续期内手动收起的面板
  // 也不会被下一条日志重新顶开。
  const liveCombat = Boolean(save && save.combat);
  // F121 守关房叫阵态：守关者未击杀 + 人已在 boss 场景 + 无交战——
  // 服务端 advance_mode 下发 "challenge_boss"，主按钮换标「叫阵守关者」
  // （点击发起「攻击」开战），行动栏「攻击」同步解禁。
  const challengeBoss = Boolean(save && save.advance_mode === "challenge_boss");
  const liveRef = useRef(false);
  useEffect(() => {
    if (liveCombat && !liveRef.current) setCombatOpen(true);
    liveRef.current = liveCombat;
  }, [liveCombat]);
  // 行动栏技能列表只在交战态存在：脱战（含死亡回溯/逃跑成功）自动收起。
  useEffect(() => {
    if (!liveCombat) setBarSkillOpen(false);
  }, [liveCombat]);
  useEffect(() => {
    const gate = detectCombatGate(log);
    const prev = gateRef.current;
    gateRef.current = gate;
    if (gate === "engage" && prev !== "engage") setCombatOpen(true);
    else if (gate === "ended" && prev === "engage" && !liveCombat) setCombatOpen(false);
  }, [log, liveCombat]);

  const dispatch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !save || busy) return;
      setBusy(true);
      setLog((l) => [...l, { id: Date.now(), role: "user", content: trimmed }]);
      try {
        const { reply, save: updated } = await sendAction(save.id, trimmed);
        setSave(updated);
        setLog((l) => [...l, reply]);
      } catch {
        setLog((l) => [
          ...l,
          { id: Date.now() + 1, role: "system", content: "【警报】与系统的连接中断。请检查网络后重试。" },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [save, busy]
  );

  // 真通关（save.cleared）后追加「结算」tab；快捷键位仍只覆盖常驻 5 个。
  // useMemo 稳定引用，避免 keydown effect 每次渲染都重挂监听。
  const cleared = Boolean(save && save.cleared);
  const tabs = useMemo(() => (cleared ? [...TABS, ENDING_TAB] : TABS), [cleared]);

  // save 变化后当前 tab 可能已不在 tabs 内（如结算态被回退），此时回 inventory。
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab("inventory");
  }, [tabs, tab]);

  const openTab = useCallback((key: TabKey) => {
    setTab(key);
    setDrawer(true);
    setItemNotice(null);
    setStatNotice(null);
  }, []);

  // 背包操作：只上报 item_id + op，效果与数值都由服务端结算后回灌。
  const onItemOp = useCallback(
    async (itemId: string, op: ItemOp) => {
      if (!save || itemBusy) return;
      setItemBusy(true);
      setItemNotice(null);
      try {
        const r = await useItem(save.id, itemId, op);
        setSave(r.save);
        setInventory(r.inventory);
        setEquipment(r.equipment);
        setLog((l) => [...l, r.reply]);
      } catch (e) {
        const msg = e instanceof Error && !/^API \d+$/.test(e.message) ? e.message : null;
        setItemNotice(
          msg ?? (op === "use" ? "无法使用该物品。" : op === "equip" ? "无法装备该物品。" : "无法丢弃该物品。")
        );
      } finally {
        setItemBusy(false);
      }
    },
    [save, itemBusy]
  );

  // 属性点分配：只上报 stat，扣点与属性/上限结算由服务端返回的最新存档回灌。
  const onSpendStat = useCallback(
    async (stat: StatKey) => {
      if (!save || statBusy) return;
      setStatBusy(true);
      setStatNotice(null);
      try {
        const { reply, save: updated } = await spendStat(save.id, stat);
        setSave(updated);
        if (reply) setLog((l) => [...l, reply]);
      } catch (e) {
        const msg = e instanceof Error && !/^API \d+$/.test(e.message) ? e.message : null;
        setStatNotice(msg ?? "无法分配属性点。");
      } finally {
        setStatBusy(false);
      }
    },
    [save, statBusy]
  );

  // 技能释放只发文本指令：MP 扣减、回合冷却与伤害全部由服务端结算后
  // 随 save.skills 回灌（cooldown_remaining/can_cast/reason），面板不再本地起表。
  const onRelease = useCallback(
    (skill: Skill) => {
      dispatch(`释放技能 ${skill.name}`);
    },
    [dispatch]
  );

  useEffect(() => {
    if (tab !== "inventory" || !save) return;
    getSave(save.id)
      .then((r) => {
        setInventory(r.inventory);
        setEquipment(r.equipment);
      })
      .catch(() => {});
  }, [tab, save]);

  // 任务面板打开时拉取；save 每次动作后变化 → 进度与倒计时顺带刷新。
  useEffect(() => {
    if (tab !== "quests" || !save) return;
    getQuests(save.id)
      .then((view) => {
        setQuests(view);
        setQuestsError(false);
      })
      .catch(() => setQuestsError(true));
  }, [tab, save]);

  // 地图面板打开时拉取章节视图；save 每次动作后变化 → 三态与章内进度顺带刷新。
  useEffect(() => {
    if (tab !== "map" || !save) return;
    getChapters(save.id)
      .then((list) => {
        setChapters(list);
        setChaptersError(false);
      })
      .catch(() => setChaptersError(true));
  }, [tab, save]);

  // 影子面板打开时拉取编队视图；出战态持久化在服务端，重开面板自动回灌。
  useEffect(() => {
    if (tab !== "shadows" || !save) return;
    getShadows(save.id)
      .then((r) => {
        setShadows({ ...r.formation, shadows: r.shadows });
        setShadowsError(false);
      })
      .catch(() => setShadowsError(true));
  }, [tab, save]);

  // 出战/撤回：只上报 shadow_id + op，满员判定与文案由服务端结算后回灌。
  const onToggleShadow = useCallback(
    async (shadow: Shadow) => {
      if (!save || shadowBusy) return;
      setShadowBusy(true);
      setShadowNotice(null);
      try {
        const r = await setShadowDeployment(save.id, shadow.id, shadow.deployed ? "undeploy" : "deploy");
        setShadows({ ...r.formation, shadows: r.shadows });
        setSave(r.save);
        setLog((l) => [...l, r.reply]);
      } catch (e) {
        const msg = e instanceof Error && !/^API \d+$/.test(e.message) ? e.message : null;
        setShadowNotice(msg ?? "影子编队操作失败。");
      } finally {
        setShadowBusy(false);
      }
    },
    [save, shadowBusy]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        setCombatOpen(false);
        setBarSkillOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= COMBAT_BUTTONS.length && liveCombat) {
        // 交战态：1–4 槽位指向战斗四键，与按钮上的键帽提示一致。
        // 「释放技能」键只开合技能列表，不发指令。
        const b = COMBAT_BUTTONS[n - 1];
        if (b.input === null) setBarSkillOpen((v) => !v);
        else dispatch(b.input);
      } else if (n >= 1 && n <= ACTION_BUTTONS.length && !liveCombat) {
        const b = ACTION_BUTTONS[n - 1];
        // 终章态快捷键 1 与按钮同义：不再发「前进」，直接开结算。
        // 守关房叫阵态快捷键 1 与「叫阵守关者」同义：发「攻击」就地开战。
        if (b.input === "前进" && cleared) openTab("ending");
        else if (b.input === "前进" && challengeBoss) dispatch("攻击");
        else dispatch(b.input);
      } else if (n >= 5 && n < 5 + tabs.length && tabs[n - 5]) openTab(tabs[n - 5].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, openTab, tabs, cleared, liveCombat, challengeBoss]);

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
        const full = await getSave(created.id);
        setSave(full.save);
        setInventory(full.inventory);
        setEquipment(full.equipment);
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
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      dispatch(text);
    },
    [input, dispatch]
  );

  if (loading) {
    return (
      <div className="app app-gate">
        <div className="holo">
          <div className="holo-inner">
            <div className="holo-title">系统</div>
            <div className="holo-body">正在接入猎人行会终端……</div>
          </div>
        </div>
      </div>
    );
  }

  if (!save) {
    return (
      <div className="app app-gate">
        <div className="holo holo-gate">
          <div className="holo-inner">
            <div className="holo-title">觉醒协议</div>
            <div className="holo-body gate-body">
              <p className="gate-line">检测到适格者。最弱兵器，亦可登顶。</p>
              <p className="gate-line">登记猎人代号，接入「系统」。</p>
              <form className="gate-form" onSubmit={onCreate}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="猎人代号"
                  maxLength={20}
                  autoFocus
                />
                <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
                  觉醒
                </button>
              </form>
              {error && <p className="gate-error">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <StatusBar save={save} equipment={equipment} onOpenDrawer={() => setDrawer(true)} />

      <main className="stage" ref={logRef}>
        <div className="stage-col">
          {combatOpen && (
            <CombatPanel
              save={save}
              log={log}
              skills={save.skills ?? skills}
              inventory={inventory}
              items={items}
              busy={busy}
              onAction={dispatch}
              onUseItem={(itemId) => onItemOp(itemId, "use")}
              onClose={() => setCombatOpen(false)}
            />
          )}
          {log.map((entry) => (
            <StageEntry key={entry.id} entry={entry} />
          ))}
          {save.at_epilogue && (
            // F089 一次性终章文案：按 save.at_epilogue 常驻一块横幅，不落
            // 日志、不随动作刷屏；附结算入口，与「查看结算」按钮同向。
            <div className="epilogue-banner" role="status">
              <div className="epilogue-kicker">故事的终章</div>
              <p className="epilogue-text">
                船已进港，账已结清。所有战斗与抉择都凝固成了战绩——前路已尽，剩下的只有回看。
              </p>
              <button className="btn primary" onClick={() => openTab("ending")}>
                查看结算
              </button>
            </div>
          )}
          {busy && (
            <div className="pending">
              <span className="pending-dot" />
              系统处理中
            </div>
          )}
        </div>
      </main>

      <div className={`drawer-veil${drawer ? " show" : ""}`} onClick={() => setDrawer(false)} />
      <aside className={`sidebar${drawer ? " open" : ""}`} aria-label="档案面板">
        <div className="side-head">
          <div className="side-title">
            <span>档案</span>
            <i className="status-div" aria-hidden="true" />
            <span className="cur">{tabs.find((t) => t.key === tab)?.label}</span>
          </div>
          <button className="side-close" onClick={() => setDrawer(false)} aria-label="关闭档案面板">
            ×
          </button>
        </div>
        <div className="side-body">
          <div className="side-scroll">
            <SidePanel
              tab={tab}
              save={save}
              inventory={inventory}
              items={items}
              equipment={equipment}
              itemBusy={itemBusy}
              itemNotice={itemNotice}
              onItemOp={onItemOp}
              skills={save.skills ?? skills}
              skillsError={skillsError}
              busy={busy}
              onRelease={onRelease}
              statBusy={statBusy}
              statNotice={statNotice}
              onSpendStat={onSpendStat}
              quests={quests}
              questsError={questsError}
              chapters={chapters}
              chaptersError={chaptersError}
              shadows={shadows}
              shadowsError={shadowsError}
              shadowBusy={shadowBusy}
              shadowNotice={shadowNotice}
              onToggleShadow={onToggleShadow}
            />
          </div>
          <div className="side-foot">
            <span>面板 5–0</span>
            <span className="foot-esc">ESC 关闭</span>
            <span className="foot-tap">点 × 关闭</span>
          </div>
        </div>
      </aside>

      <footer className="actions">
        <div className="actions-main">
          <div className="action-groups">
            <div className="btn-group">
              <span className="group-label">行动</span>
              {/* F094：探索组只在非交战渲染；交战中整组换为下方战斗四键，
                  服务端对和平意图的门禁（改判提示、零收益）与前台隐藏一致。 */}
              {!liveCombat &&
                ACTION_BUTTONS.map((b, i) => {
                // 休息吃 F086 配额口径：满状态/次数用尽时禁用，原因文案由
                // 服务端 save.rest 下发，不硬编码。
                const restInfo = b.input === "休息" ? save.rest : null;
                const restBlocked = Boolean(restInfo && !restInfo.available);
                // F089：终章态（save.at_epilogue，服务端字段）「探索前进」
                // 改写为「查看结算」——服务端对终章「前进」整体拒绝，前台
                // 不再发这条必拒指令。F096/F106：守关者未击杀被门挡时
                // （站在 boss 场景之后含章尾）主按钮按服务端 advance_mode
                // 换标「折返守关者」，不在前端猜场景。F121：人已站在守关
                // 房内时主按钮换标「叫阵守关者」——点击发起「攻击」就地
                // 开战（与自由输入「攻击」同一服务端结算），这是房内唯一
                // 可点的出路。F117：主线链尾（守关者已击杀、chapter_completed）
                // 主按钮换标「进入第N章 · 章名」——章号章名来自服务端
                // save.next_chapter，过门零消耗；前端不推断完成态。
                const retreatToBoss =
                  b.input === "前进" && save.advance_mode === "retreat_to_boss";
                const challenge =
                  b.input === "前进" && save.advance_mode === "challenge_boss";
                const nextChapter =
                  b.input === "前进" &&
                  save.advance_mode === "next_chapter" &&
                  save.next_chapter
                    ? save.next_chapter
                    : null;
                if (b.input === "前进" && save.at_epilogue) {
                  return (
                    <button
                      key={b.label}
                      className="btn primary"
                      onClick={() => openTab("ending")}
                      title="快捷键 1"
                    >
                      查看结算
                      <kbd>{i + 1}</kbd>
                    </button>
                  );
                }
                return (
                  <button
                    key={b.label}
                    className={`btn${b.primary ? " primary" : ""}${nextChapter ? " cta-next" : ""}`}
                    disabled={busy || restBlocked}
                    onClick={() => dispatch(challenge ? "攻击" : b.input)}
                    title={
                      (restBlocked && (restInfo?.reason || "暂时无法休息")) ||
                      (challenge
                        ? `守关者就在面前 · 叫阵开战 · 快捷键 ${i + 1}`
                        : nextChapter
                          ? `进入第${nextChapter.index}章 · 过门不耗体力 · 快捷键 ${i + 1}`
                          : retreatToBoss
                            ? `守关者未击杀 · 需先击败它 · 快捷键 ${i + 1}`
                            : `快捷键 ${i + 1}`)
                    }
                    aria-disabled={busy || restBlocked}
                  >
                    {challenge ? (
                      "叫阵守关者"
                    ) : nextChapter ? (
                      <span className="btn-cta">
                        进入第{nextChapter.index}章<span className="btn-cta-sep"> · </span>
                        <span className="btn-cta-title">{nextChapter.title}</span>
                      </span>
                    ) : retreatToBoss ? (
                      "折返守关者"
                    ) : (
                      b.label
                    )}
                    {restInfo ? <span className="rest-count">{restInfo.remaining}</span> : null}
                    <kbd>{i + 1}</kbd>
                  </button>
                );
              })}
              {/* F094 战斗四键常驻：交战中可用（键帽 1–4），无交战 disabled
                  + 可见提示——玩家不必靠战斗面板/快捷键猜入口。
                  F121：守关房叫阵态（challengeBoss）「攻击」解禁——守关者
                  就封在出口，原地叫阵即开战，与主按钮同一结算路径。 */}
              {COMBAT_BUTTONS.map((b, i) => {
                const challengeable = challengeBoss && b.input === "攻击";
                const disabled = busy || (!liveCombat && !challengeable);
                return (
                  <button
                    key={b.label}
                    className={`btn${liveCombat && i === 0 ? " primary" : ""}${
                      b.input === null && barSkillOpen ? " on" : ""
                    }`}
                    disabled={disabled}
                    aria-disabled={disabled}
                    aria-expanded={b.input === null ? barSkillOpen : undefined}
                    title={
                      liveCombat
                        ? b.input === null
                          ? `展开技能列表 · 快捷键 ${i + 1}`
                          : `快捷键 ${i + 1}`
                        : challengeable
                          ? "守关者就在面前 — 叫阵开战"
                          : "当前没有可攻击的目标"
                    }
                    onClick={() =>
                      b.input === null ? setBarSkillOpen((v) => !v) : dispatch(b.input as string)
                    }
                  >
                    {b.label}
                    {liveCombat && <kbd>{i + 1}</kbd>}
                  </button>
                );
              })}
              {!liveCombat && (
                <span className="bar-combat-hint">
                  {challengeBoss ? "守关者封着出口——叫阵即开战" : "当前没有可攻击的目标"}
                </span>
              )}
            </div>
            <div className="btn-group btn-group-sys">
              <span className="group-label">系统</span>
              {tabs.map((t, i) => (
                <button
                  key={t.key}
                  className="btn"
                  onClick={() => openTab(t.key)}
                  title={i + 5 < 10 ? `快捷键 ${i + 5}` : undefined}
                >
                  {t.label}
                  {i + 5 < 10 && <kbd>{i + 5}</kbd>}
                </button>
              ))}
              <button
                className="btn"
                onClick={() => setCombatOpen((v) => !v)}
                title="战斗面板开关"
              >
                战斗
              </button>
              <button
                className="btn"
                disabled={busy || Boolean(save.combat)}
                title={save.combat ? "交战中无法存档" : undefined}
                onClick={() => dispatch("存档")}
              >
                存档
              </button>
            </div>
          </div>
          {/* F094 行动栏技能列表：只在交战态由「释放技能」开合。MP 消耗 /
              冷却 / 可释放性全部读服务端 save.skills 视图（与技能面板、
              /action 门禁同一口径），点击指令原样发出，MP/伤害由服务端结算。 */}
          {barSkillOpen && liveCombat && (
            <ul className="bar-skills" aria-label="战斗技能">
              {(save.skills ?? skills).map((s) => {
                const unlocked = s.unlocked ?? s.learn_level <= save.level;
                const cd = s.cooldown_remaining ?? 0;
                const mpOk = s.mp_enough ?? save.mp >= s.mp_cost;
                const canCast = s.can_cast ?? (unlocked && cd === 0 && mpOk && liveCombat);
                const disabled = busy || !canCast;
                const reason = !unlocked
                  ? `需 Lv.${s.learn_level}`
                  : cd > 0
                    ? `冷却中 ${cd} 回合`
                    : !mpOk
                      ? "MP 不足"
                      : null;
                return (
                  <li key={s.id}>
                    <button
                      className="bar-skill"
                      disabled={disabled}
                      aria-disabled={disabled}
                      title={
                        reason ??
                        `${s.desc}${
                          s.damage_preview
                            ? ` · 预计伤害 ${s.damage_preview.min}–${s.damage_preview.max}`
                            : ""
                        }`
                      }
                      onClick={() => dispatch(`释放技能 ${s.name}`)}
                    >
                      <span className="bar-skill-name">{s.name}</span>
                      <span className="bar-skill-meta">
                        MP {s.mp_cost} · 冷却 {s.cooldown}
                        {s.damage_preview
                          ? ` · 预计伤害 ${s.damage_preview.min}–${s.damage_preview.max}`
                          : ""}
                      </span>
                      {reason && <span className="bar-skill-reason">{reason}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form className="input-row" onSubmit={onSend}>
            <span className="input-prompt" aria-hidden="true">
              &gt;
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="做点别的……（自由行动）"
              aria-label="自由行动输入"
            />
            <button type="submit" className="input-send" disabled={busy || !input.trim()} aria-label="发送">
              ↵ Enter
            </button>
          </form>
        </div>
        <div className="actions-side" aria-hidden="true" />
      </footer>
    </div>
  );
}
