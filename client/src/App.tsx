import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  baseAttack,
  baseDefense,
  ChapterView,
  createSave,
  Equipment,
  findSaves,
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
  SaveSummary,
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
import vocab from "../../shared/intents.json";

const STORAGE_KEY = "solo_leveling_save_id";

// F084 日志回溯窗口：「加载更早」每次 +50，服务端硬上限 200。
// 探测多取 1 条判断是否还有更早记录——fetched.length > limit 即还有历史。
// F227：续档/切档回灌放宽为整窗 LOG_CAP——旧码只灌末 50 条，内存态
// 累积超窗的战斗/叙述行在刷新后凭空少行。
const LOG_PAGE = 50;
const LOG_CAP = 200;

// F167 遭遇播报拆条：服务端把「剧情正文 + 代价行 + 【遭遇】 + 【系统】
// 状态提示教学段」拼成一条日志下发，这里只在渲染层按段落拆成多个
// .stage-col 子节点——请求/响应字段、日志落库与数值结算一概不动，
// 刷新回灌的旧日志行走同一规则拆分（渲染期拆分天然覆盖全部行）。
//   · 行首【遭遇】→ 独立条目（代价行留在前条，绝不混入）；
//   · 行首【系统】且是战斗教学/状态提示 → 独立条目；
//   · 其余行按原顺序并入所在条目——【战斗】【主线】【升级】【任务】
//     等行不单独拆，保持现状。
const SEG_ENCOUNTER_RE = /^【遭遇】/;
const SEG_SYS_TEACH_RE =
  /^【系统】[^\n]*(状态提示|状态预警|估算每回合|每回合约能|说「攻击」)/;

// F118：/ai-action 降级回包（degraded:true）给该条气泡挂的渲染期标记——
// 不落库不改字段，仅指示气泡尾部追加降级小字。
// F222：ephemeral 标记只活在内存态的本地回执行（技能/道具抽屉展开回执、
// 断线警报）——服务端不落库，刷新后自然消失；挂 .holo-ephemeral 让
// 「刷新前后 .stage-col 行数一致」的断言能把这类已知差异显式豁免，
// 而不是把整条日志行吞掉装作没看见。
type UiEntry = LogEntry & { degradedNote?: boolean; ephemeral?: boolean };

function splitStageEntry(entry: UiEntry): UiEntry[] {
  if (entry.role === "user") return [entry];
  const paras = entry.content.split("\n").filter((p) => p.trim() !== "");
  if (paras.length <= 1) return [entry];
  const groups: string[][] = [[]];
  for (const p of paras) {
    if (SEG_ENCOUNTER_RE.test(p) || SEG_SYS_TEACH_RE.test(p)) groups.push([p]);
    else groups[groups.length - 1].push(p);
  }
  const segs = groups.filter((g) => g.length > 0);
  if (segs.length <= 1) return [entry];
  return segs.map((g) => ({ ...entry, content: g.join("\n") }));
}

// F213 开场正文拆段（纯渲染层）：服务端下发的长正文把多个自然段
// 用换行塞进同一条日志，旧渲染把整条塞进一个 <p.narration> 成了一堵
// 字墙。这里只改渲染——entry.content / 日志条数 / splitStageEntry 的
// 条目语义一概不动：
//   · 段边界 = 换行（上游 splitStageEntry 已把空行折成单换行，语料里
//     不存在段内单换行，故每个 \n 都是自然段边界）；
//   · 单段仍 >200 字时，只在句末标点（。！？…」）后继续切，逐字不改；
//   · 拆出的每段各渲染一个 <p.narration>，间距沿用既有 --sp-4 口径。
const NARR_PARA_MAX = 200;
const SENT_END_RE = /[。！？…」]/;
function splitNarrationParas(content: string): string[] {
  const raw = content.split(/\n+/).filter((p) => p.trim() !== "");
  const out: string[] = [];
  for (const para of raw) {
    let rest = para;
    while ([...rest].length > NARR_PARA_MAX) {
      const chars = [...rest];
      let cut = -1;
      for (let i = 0; i < NARR_PARA_MAX; i++) {
        if (SENT_END_RE.test(chars[i])) cut = i + 1;
      }
      if (cut <= 0) break; // 前 200 字无句末标点——不造新字也不硬切，原样保留
      out.push(chars.slice(0, cut).join(""));
      rest = chars.slice(cut).join("");
    }
    if (rest.trim() !== "") out.push(rest);
  }
  return out.length > 0 ? out : [content];
}

// F118 自由输入分流：指令形态照旧走 /action（战斗回显、面板路由等既有
// 口径不变），自然语言长句才走 /ai-action 的叙事引擎——是否「指令形态」
// 镜像 server/ai/free-action.js 的 echoRequired 判定（单一事实源：
// 去空白 <8 字 → 指令形态；含指令信号词/数字键位 → 指令形态）。
const COMMAND_SIGNAL_RE =
  /攻击|前进|休息|潜行|观察|逃跑|防御|技能|道具|使用|存档|帮助|状态|属性|背包|地图|任务|影子|叫阵|遭遇|回合|撤离|药水|[0-9０-９]/;
const isNarrationInput = (text: string) => {
  const s = text.replace(/\s+/g, "");
  return s.length >= 8 && !COMMAND_SIGNAL_RE.test(s);
};

// F231 must_choose 未决时「前进」的即时回执：这类输入服务端必返
// refused（P204 门，结算/日志/去重口径照旧在服务端），但线上回包
// ~1.1s 起步——拒绝提示先在点击当帧由 .sys-toast 槽位点亮，不等回包。
// 预判口径镜像 server/ai/keywords.js；F235 起词表不再各自写字面量——
// 三条正则全部由 shared/intents.json（前后端单一事实源）构造：
// advance 词命中、非疑问句守卫、且不再命中排在 advance 之前的意图族
// ——词表按表序取首个命中，被早位意图（观察/攻击/离开……）抢走的
// 输入在服务端根本轮不到 must_choose 门，提前弹「先选一个」是谎报。
interface IntentRule {
  intent: string;
  pattern: string | null;
  flags: string | null;
  client_pattern?: string;
}
const INTENT_RULES = vocab.intents as IntentRule[];
const ADVANCE_IDX = INTENT_RULES.findIndex((r) => r.intent === "advance");
const ADVANCE_INTENT_RE = new RegExp(
  INTENT_RULES[ADVANCE_IDX].pattern!,
  INTENT_RULES[ADVANCE_IDX].flags || ""
);
const QUESTION_FORM_RE = new RegExp(vocab.question_form.pattern, vocab.question_form.flags);
// 早位意图族：表序在 advance 之前的条目的并集——影子三条的真实正则
// 句首锚定在服务端引擎（JSON 里 pattern=null），前端用 client_pattern
// 宽口径近似遮住「影子/编队」输入，宁多不少。
const PRE_ADVANCE_INTENT_RE = new RegExp(
  INTENT_RULES.slice(0, ADVANCE_IDX)
    .map((r) => r.client_pattern ?? r.pattern)
    .filter((p): p is string => p != null)
    .join("|"),
  "i"
);

// 拒绝文案只指路不复述选项名——选项名在首条拒绝正文（.stage-col
// 落库行）里，瞬时层只说清「先选一个」这一步要做的动作。
const DENY_CHOICE_TEXT = "抉择未定——先选一个：点选项键，或输入「选择 <选项名>」";

// F231：must_choose 由 saveView 随场景视图下发（api.ts 冻结不动——
// 本地窄化取值，与 reply.panel 等回包附加字段同一读法）。带可选
// 分支的非必选场景（next_choices ≥2 但 must_choose 缺席）不命中，
// 「前进」在那些场景是合法推进，不得提前弹拒绝提示。
const sceneMustChoose = (s: Save | null | undefined): boolean =>
  Boolean(s && (s as Save & { must_choose?: boolean }).must_choose === true);

interface ActionResponse {
  reply: LogEntry;
  save?: Save;
  shadows?: ShadowFormation;
  degraded?: boolean;
}

// /action 走 api.ts 的 sendAction；/ai-action 是同构回包（reply/save/
// shadows + 顶层 degraded 标记），api.ts 冻结故在此直连同一 API 前缀。
async function postAiAction(save_id: number, input: string): Promise<ActionResponse> {
  const res = await fetch("/game/api/ai-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_id, input }),
  });
  if (!res.ok) {
    let message = `API ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error) message = body.error;
    } catch {
      /* 非 JSON 响应，保留状态码文案 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<ActionResponse>;
}

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

const ACTION_BUTTONS: { label: string; input: string; combatBlock?: boolean }[] = [
  { label: "探索前进", input: "前进" },
  { label: "环顾四周", input: "观察", combatBlock: true },
  { label: "潜行", input: "潜行", combatBlock: true },
  { label: "休息", input: "休息", combatBlock: true },
];

// F094 战斗操作入口：行动栏常驻战斗五键。交战（save.combat，服务端真实
// 交战态）时整组只留这五键——探索组在敌我面前全被服务端门禁改判，
// 「撤离」语义与「逃跑」同一结算（flee + retreatOnFlee），不再单列。
// F163：交战态的唯一控制组——浮层战斗面板只留情报，攻击/技能/防御/
// 道具/逃跑全部收口到这里；「道具」由浮层迁入，与「释放技能」同为
// 展开器（input=null + expand 哨兵），不是指令本身。
// 无交战时五键折叠为 .combat-entry 单行矮入口（F113/F119 高度预算）。
// 快捷键沿用 1–5 槽位：键位永远指向当前组内同位置按钮；交战态 5=逃跑，
// 系统组 5–9 的键位在交战时不抢占（else-if 链先吃战斗组）。
// P205：连击整次固定代价 6 MP——数值唯一事实源在服务端
// server/index.js COMBO_MP_COST（门禁与实扣都在那边结算），前端只按
// 同一常数做展示态：键面标代价、MP 不足时 disabled 并在键面上给可见
// 理由（移动端无 hover，可见文字落键面而非只挂 title）。
const COMBO_MP_COST = 6;

const COMBAT_BUTTONS: {
  label: string;
  input: string | null;
  expand?: "skills" | "items";
  cls?: string;
}[] = [
  { label: "攻击", input: "攻击" },
  // F200 连击 ×3：一次点击由服务端连续结算至多 3 回合（战斗提前结束即
  // 停），只在交战态出现在「攻击」之后——与自由输入「连击」同一动作。
  { label: `连击 ×3 · ${COMBO_MP_COST}MP`, input: "连击", cls: "combat-act" },
  { label: "释放技能", input: null, expand: "skills" },
  { label: "防御", input: "防御" },
  { label: "道具", input: null, expand: "items" },
  { label: "逃跑", input: "逃跑" },
];

// F228 唯一主行动：首屏同一时刻只允许一颗主 CTA——390/1440 下四个
// 探索键与剧情分支键视觉权重接近，vision 走查两次判「不知道点哪」。
// 纯函数是主位的单一事实源：各按钮只比对返回值挂 primary/cta-primary，
// 不在 JSX 各处散落判定。优先级（高→低）：
//   a. 剧情分支接管——save.next_choices ≥2 且存在未锁定项 → 第一条未
//      锁定分支键（通用四键降为次级）；
//   b. liveCombat → 战斗组第一键「攻击」（交战期 next_choices 本就不
//      渲染，分支判定位列交战之前也天然取不到）；
//   c–f. 其余一律落在行动组「前进」槽：challenge_boss→叫阵守关者、
//      at_epilogue→查看结算、next_chapter→进入第N章、其余（含
//      retreat_to_boss 与常规探索）→探索前进——四种换标形态是同一个
//      DOM 槽位，主位解析结果相同。
type PrimaryCta = { kind: "choice"; id: string } | { kind: "attack" } | { kind: "advance" };

function pickPrimaryCta(save: Save, liveCombat: boolean): PrimaryCta {
  if (!liveCombat && (save.next_choices?.length ?? 0) >= 2) {
    const first = save.next_choices.find((c) => c.locked !== true);
    if (first) return { kind: "choice", id: first.id };
  }
  if (liveCombat) return { kind: "attack" };
  return { kind: "advance" };
}

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
// F129：服务端「面板名直开」下发的 reply.panel 只认 TabKey 白名单——
// 陌生串按普通日志处理，绝不弹面板。
const PANEL_TAB_KEYS = new Set<TabKey>([...TABS.map((t) => t.key), ENDING_TAB.key]);

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

// F218 顶栏跳字：跟随 save.hp/mp 的逐次差值渲染一枚 ~1.1s 浮字
// （绝对定位不占行高、pointer-events:none 不拦点击）。差值为 0 不浮字；
// 同槽位连续变动时换 key 重放动画，数值按最新一次差值更新。
function useGaugeDelta(value: number): { key: number; delta: number } | null {
  const prevRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const [delta, setDelta] = useState<{ key: number; delta: number } | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev === null || prev === value) return;
    seqRef.current += 1;
    setDelta({ key: seqRef.current, delta: value - prev });
    const t = setTimeout(() => setDelta(null), 1100);
    return () => clearTimeout(t);
  }, [value]);
  return delta;
}

function Gauge({
  label,
  value,
  max,
  kind,
  delta,
}: {
  label: string;
  value: number;
  max: number;
  kind: "hp" | "mp";
  delta?: { key: number; delta: number } | null;
}) {
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
        {delta && (
          <span
            key={delta.key}
            className={`gauge-delta ${delta.delta > 0 ? "gd-up" : "gd-dn"}`}
            aria-hidden="true"
          >
            {delta.delta > 0 ? `+${delta.delta}` : delta.delta}
          </span>
        )}
      </span>
    </div>
  );
}

function StatusBar({
  save,
  equipment,
  degraded,
  saveHint,
  onDismissDegraded,
  onOpenDrawer,
  onHelp,
  onFreePoints,
}: {
  save: Save;
  equipment: Equipment | null;
  degraded: boolean;
  saveHint: { id: number; text: string } | null;
  onDismissDegraded: () => void;
  onOpenDrawer: () => void;
  onHelp: () => void;
  onFreePoints: () => void;
}) {
  const s = save.stats;
  // 含装备加成：折算系数与 server/engine/stats.js 保持一致，改动需两边同步。
  const atk = baseAttack(s) + (equipment?.atk ?? 0);
  const def = baseDefense(s) + (equipment?.def ?? 0);
  const chapterName = CHAPTERS[save.chapter - 1] ?? `第${save.chapter}章`;
  const freePoints = Math.max(0, Number(save.free_points) || 0);
  const inCombat = Boolean(save.combat);
  // P208：顶栏 XP 极细进度条。真值只读 save.xp / save.xp_to_next，
  // 前端不推算等级曲线；xp_to_next 缺失/异常时退化为空轨道。
  const xpNeed = Number(save.xp_to_next) || 0;
  const xpPct = xpNeed <= 0 ? 0 : Math.min(100, Math.max(0, (save.xp / xpNeed) * 100));
  const xpTip = `经验 ${save.xp}/${save.xp_to_next} · 距 Lv.${save.level + 1} 还需 ${Math.max(0, xpNeed - save.xp)}`;
  // F218 顶栏 HP/MP 跳字：每次 /action 回包带出的差值各浮一枚，
  // ≤1.1s 自动卸载。
  const hpDelta = useGaugeDelta(save.hp);
  const mpDelta = useGaugeDelta(save.mp);
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
        <Gauge label="HP" value={save.hp} max={save.max_hp} kind="hp" delta={hpDelta} />
        <Gauge label="MP" value={save.mp} max={save.max_mp} kind="mp" delta={mpDelta} />
      </div>
      <div className="status-nums">
        {/* F164 属性点徽标：free_points>0 时钉在属性组首位——可点直达
            「属性」面板；交战中仍显示，点击由上层给同口径提示。 */}
        {freePoints > 0 && (
          <button
            type="button"
            className="stat-points-badge"
            onClick={onFreePoints}
            title={inCombat ? "交战中无法分配属性点" : "打开「属性」面板分配"}
          >
            <span className="fpb-label">属性点</span>
            <b className="fpb-num">+{freePoints}</b>
          </button>
        )}
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
        <span
          className="stat stat-xp"
          title={xpTip}
          aria-label={xpTip}
        >
          XP<b>{save.xp}</b>
          <i className="xp-bar" aria-hidden="true">
            <i className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
          </i>
        </span>
      </div>
      <button className="drawer-toggle" onClick={onOpenDrawer} aria-label="打开档案面板">
        档案
      </button>
      {/* F221：帮助入口从兜底回包的指令表尾巴挪到顶栏「?」键——点击
          走与手动输入「帮助」完全相同的 dispatch 通道，服务端返回的
          完整指令表照旧落日志行。 */}
      <button
        type="button"
        className="help-toggle"
        onClick={onHelp}
        aria-label="查看可用指令"
        title="可用指令"
      >
        ?
      </button>
      {/* F201「已记录」微提示：绝对定位锚在顶栏下缘右侧，不进文档流、
          不遮数值、不拦点击；1.8s 淡出后由 App 计时移除。 */}
      {saveHint && (
        <span key={saveHint.id} className="save-hint" role="status">
          {saveHint.text}
        </span>
      )}
      {/* F118 叙事降级一次性细条：会话内首次 /ai-action 降级后浮现，
          在文档流内不遮输入框与行动按钮；× 收起后本会话不再出现，
          刷新后随会话态重置可再提示一次。 */}
      {degraded && (
        <div className="degraded-banner" role="status">
          <span className="degraded-banner-text">
            叙事引擎：规则模式（AI 暂不可用）· 点 × 收起
          </span>
          <button
            type="button"
            className="degraded-banner-close"
            aria-label="收起降级提示"
            onClick={onDismissDegraded}
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}

function HoloWindow({ entry }: { entry: UiEntry }) {
  const m = entry.content.match(/^【([^】]+)】\s*([\s\S]*)$/);
  const title = m ? m[1] : "系统";
  const body = m ? m[2].trim() : entry.content;
  const danger = /警|错误|失败|中断|危险|惩罚/.test(title);
  return (
    <div className={`holo${danger ? " holo-danger" : ""}${entry.ephemeral ? " holo-ephemeral" : ""}`}>
      <div className="holo-inner">
        <div className="holo-title">{title}</div>
        <div className="holo-body">
          {body}
          {entry.degradedNote && (
            <div className="degraded-note">（系统叙事降级：按规则解析）</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageEntry({ entry }: { entry: UiEntry }) {
  if (entry.role === "system") return <HoloWindow entry={entry} />;
  if (entry.role === "user") {
    return (
      <div className="echo">
        <span className="echo-text">{entry.content}</span>
      </div>
    );
  }
  const paras = splitNarrationParas(entry.content);
  return (
    <>
      {paras.map((p, i) => (
        <p className="narration" key={i}>
          {p}
          {i === paras.length - 1 && entry.degradedNote && (
            <span className="degraded-note">（系统叙事降级：按规则解析）</span>
          )}
        </p>
      ))}
    </>
  );
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
  const [log, setLog] = useState<UiEntry[]>([]);
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
  // F084：hidden = 没有更早记录（控件不渲染）；more = 还有历史可回溯；
  // start = 已到最初（控件留作「已到最初」死键占位，不再发请求）。
  const [logLimit, setLogLimit] = useState(LOG_PAGE);
  const [logTail, setLogTail] = useState<"hidden" | "more" | "start">("hidden");
  const [logPaging, setLogPaging] = useState(false);
  // 回灌装填前的滚动锚点：加载更早是向上翻页，视口要停在原位置而非被
  // [log] 效应一把甩回最底。
  const keepLogPosRef = useRef<{ height: number; top: number } | null>(null);
  // F136 重名建档：GET /saves?player_name= 命中后挂起创建流程，等玩家在
  // 「继续这个存档 / 另起新档」二选一。confirmNew 是「另起新档」的二次
  // 确认门槛（点了第一下先换确认文案，再点才真发 mode:"new"）。
  const [conflict, setConflict] = useState<{ name: string; saves: SaveSummary[] } | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("inventory");
  const [drawer, setDrawer] = useState(false);
  // F190 重新登记二次确认：点「重新登记」先挂起确认层（不立即解绑）——
  // 「确定」才走既有 onRebind，「取消」只收层，玩家仍在游戏内。
  const [rebindConfirm, setRebindConfirm] = useState(false);
  const [combatOpen, setCombatOpen] = useState(false);
  // F163 行动栏展开器互斥开合：技能列表 / 道具列表同一槽位，同时至多
  // 展开一个；脱战（含死亡回溯/逃跑成功）自动收起。
  const [barList, setBarList] = useState<"skills" | "items" | null>(null);
  // F132 系统键就地反馈：脱战「战斗」空态 /「存档」进度与确认共用的
  // 短提示条（底栏上缘浮现，计时自动消散）。
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  // F118 降级一次性提示：本会话见过 degraded:true 回包即点亮细条，
  // × 收起后本会话不再出现（刷新后随会话态重置可再提示一次）；
  // degradedNoteRef 保证尾注只盖在第一条降级气泡上，不逐条盖章。
  const [degraded, setDegraded] = useState(false);
  const [degradedDismissed, setDegradedDismissed] = useState(false);
  const degradedNoteRef = useRef(false);
  // F186 ≤880px 判定：窄屏交战时不再渲染 .combat-lock-hint，「无法推进
  // 剧情」语义并进 .save-blocked-hint 一条——整页可见交战提示收敛为 1。
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 880px)").matches
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // F219：must_choose 拒绝时选项组一次性描边高亮——拒绝文案不再含
  // 方位指代，可点选项的位置由这次闪光直接指给玩家。值为触发时刻的
  // 时间戳（同一槽位 key 翻新可重播动画），计时自动归零。
  const [choiceAttn, setChoiceAttn] = useState(0);
  const choiceAttnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // F201「已记录」微提示：每个 /action 成功回包都意味着服务端已落库
  // （刷新后 Lv./HP/战报逐项保留），但此前只有手动「存档」有完成播报，
  // 玩家在刷新前会怀疑进度白打。顶栏下缘挂一条 1.8s 淡出的细字——
  // 不进日志、不占行高、不动布局。交战态存档禁用是设计，文案换为
  // 「交战结束后可写入」，绝不谎报「已写入存档」。
  const [saveHint, setSaveHint] = useState<{ id: number; text: string } | null>(null);
  const saveHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<ReturnType<typeof detectCombatGate>>(null);
  // F141 日志基线：整页回灌/接入存档时已有的行是「旧行」——历史战报
  // 不得重新点亮战斗面板；只有此后新写入的行才算日志侧交战信号。
  const logBaseRef = useRef(0);
  // F255：系统组不再横滑（见 styles.css 窄屏块），.sys-scroll 退化为透明
  // 包裹（display:contents），refs 仅为结构对齐保留；F212 的横滑暗示与
  // .sys-fade 渐隐条已停用——横滑容器会让视口外的键真实手指按不到。
  const sysScrollRef = useRef<HTMLDivElement>(null);
  const sysGroupRef = useRef<HTMLDivElement>(null);

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
    const mq = window.matchMedia("(max-width: 880px)");
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // F212 横滚状态 effect 已随 F255 停用：系统组折行平铺后无横滚，
  // data-at-* 恒为两端满足，留这段只会空转 ResizeObserver。

  // F227 续档回灌整窗：直接取到服务端硬上限 LOG_CAP——旧码只灌末 50
  // 条，刷新前内存里累积超窗的战斗/叙述行回灌后凭空少行。回灌行数
  // 顶到上限说明可能仍有更早历史，「加载更早」入口保留翻页。
  const resumeLog = useCallback(async (saveId: number) => {
    const rows = await getLog(saveId, LOG_CAP);
    logBaseRef.current = rows.length;
    setLog(rows);
    setLogLimit(LOG_CAP);
    setLogTail(rows.length >= LOG_CAP ? "more" : "hidden");
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
        await resumeLog(save.id);
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setLoading(false));
  }, [resumeLog]);

  // F262：正文列可滚且未到底时，在列底（.actions 正上方）挂
  // 「还有下文」渐隐提示——首屏停顶态读者不再把渐隐行误读成
  // 「被底栏裁切/遮住」。节点放在 .stage 内、.stage-col 外（不占
  // 滚动流高，不进 > * 行数口径）；到底即卸载，非 display:none。
  const [logHint, setLogHint] = useState(false);
  const syncLogHint = useCallback(() => {
    const el = logRef.current;
    setLogHint(
      Boolean(
        el &&
          el.scrollHeight > el.clientHeight + 4 &&
          el.scrollTop + el.clientHeight < el.scrollHeight - 8
      )
    );
  }, []);
  useEffect(() => {
    window.addEventListener("resize", syncLogHint);
    return () => window.removeEventListener("resize", syncLogHint);
  }, [syncLogHint]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const keep = keepLogPosRef.current;
    keepLogPosRef.current = null;
    if (keep) el.scrollTo({ top: el.scrollHeight - keep.height + keep.top });
    // F217 新档首屏停在正文开头：整窗日志里尚无玩家输入行（开场条目
    // 全是 narrator/system，玩家每次动作服务端都会先落一条 user 行），
    // 此时不再自动沉底，让开场第一段落在首屏；有任何动作史的老档
    // （含刷新回灌、同档追加动作后重进）照旧滚到底部。
    else if (log.some((entry) => entry.role === "user"))
      el.scrollTo({ top: el.scrollHeight });
    else el.scrollTo({ top: 0 });
    // scrollTo 是即时定位、scroll 事件随后才到——这里同步核一次，
    // 保证沉底后提示立刻卸载、停顶后立刻挂上。
    syncLogHint();
  }, [log, syncLogHint]);

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
  // F247：must_choose 未决时「探索前进」是服务端必拒的死选项——
  // 置灰为不可点（disabled + 视觉转暗），不再「看得见、按得动、永远
  // 无效」。换标形态不在本列：at_epilogue 查看结算 / challenge_boss
  // 叫阵 / next_chapter 过章 / retreat_to_boss 折返仍是合法出路，
  // 不得顺带锁死。交战态「前进」是撤离掷逃，同样不禁。
  const forwardChoiceLocked = Boolean(
    save &&
      !liveCombat &&
      sceneMustChoose(save) &&
      !save.at_epilogue &&
      save.advance_mode !== "challenge_boss" &&
      save.advance_mode !== "next_chapter" &&
      save.advance_mode !== "retreat_to_boss"
  );
  // F257：不可掷怪场景复核区「看尽」锁定后「环顾四周」是服务端必拒
  // 的死键——置灰为不可点并给出理由，不再是「看得见、按得动、每次
  // 仍涨 190 字」的空转键。口径由 save.observe 下发，前端不猜场景。
  const observeLocked = Boolean(
    save && !liveCombat && save.observe && !save.observe.available
  );
  // F228：当前屏唯一主行动——分支/交战/叫阵/终章/下章/探索按优先级
  // 解析成一颗，JSX 只按结果挂 primary cta-primary + data-primary-cta。
  const primaryCta = save ? pickPrimaryCta(save, liveCombat) : null;
  const liveRef = useRef(false);
  useEffect(() => {
    if (liveCombat && !liveRef.current) setCombatOpen(true);
    liveRef.current = liveCombat;
  }, [liveCombat]);
  // 行动栏技能/道具列表只在交战态存在：脱战（含死亡回溯/逃跑成功）自动收起。
  useEffect(() => {
    if (!liveCombat) setBarList(null);
  }, [liveCombat]);
  useEffect(() => {
    const gate = detectCombatGate(log, { live: liveCombat, freshFrom: logBaseRef.current });
    const prev = gateRef.current;
    gateRef.current = gate;
    if (gate === "engage" && prev !== "engage") setCombatOpen(true);
    else if (gate === "ended" && prev === "engage" && !liveCombat) setCombatOpen(false);
  }, [log, liveCombat]);

  const openTab = useCallback((key: TabKey) => {
    setTab(key);
    setDrawer(true);
    setItemNotice(null);
    setStatNotice(null);
  }, []);

  // F190：抽屉关闭（× / veil / Esc / 换号落地）同时收掉挂起的确认层——
  // 重开抽屉不应面对一条残留的待确认。
  useEffect(() => {
    if (!drawer) setRebindConfirm(false);
  }, [drawer]);

  // 连续两次提示只重置计时与文案——同一 .sys-toast 槽位不换元素。
  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // 连续拒绝只重置计时——同一组选项键槽位不换元素，key 翻新让动画
  // 从头播，避免连点「前进」时第二次闪光被第一次吃掉。
  const flashChoices = useCallback(() => {
    setChoiceAttn(Date.now());
    if (choiceAttnTimer.current) clearTimeout(choiceAttnTimer.current);
    choiceAttnTimer.current = setTimeout(() => setChoiceAttn(0), 1400);
  }, []);

  // 连续动作只重置计时与文案——同一 .save-hint 槽位不换元素；key 翻
  // 新让淡出动画从头播，避免「闪一下看不清」。
  const showSaveHint = useCallback((inCombat: boolean) => {
    setSaveHint({ id: Date.now(), text: inCombat ? "交战结束后可写入" : "已记录" });
    if (saveHintTimer.current) clearTimeout(saveHintTimer.current);
    saveHintTimer.current = setTimeout(() => setSaveHint(null), 2000);
  }, []);

  // F164 状态栏属性点徽标：复用 openTab 直达「属性」面板，不另起面板
  // 路由。交战中不静默——面板照开（面板内同口径禁用 +1），另浮一条
  // 就地提示，文案与面板/服务端拒绝口径一致。
  const onFreePointsBadge = useCallback(() => {
    openTab("stats");
    if (liveCombat) showToast("交战中无法分配属性点");
  }, [openTab, showToast, liveCombat]);

  // 返回本次指令是否真的发到服务端并收回回包（调用方据此决定是否
  // 播报完成态——如「存档已写入」）；busy/空输入/异常都算没落成。
  const dispatch = useCallback(
    async (text: string, choiceId?: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || !save || busy) return false;
      // F231：must_choose 未决 + 指令形态的「前进」＝服务端必拒——
      // 回执不等回包，点击当帧点亮 .sys-toast（300ms 反馈预算内），
      // F219 选项组描边闪光同步指路。交战态「前进」是撤离掷逃、显式
      // choice_id 是真选项，两类都不在本列。
      if (
        !choiceId &&
        !save.combat &&
        sceneMustChoose(save) &&
        ADVANCE_INTENT_RE.test(trimmed) &&
        !QUESTION_FORM_RE.test(trimmed) &&
        !PRE_ADVANCE_INTENT_RE.test(trimmed)
      ) {
        showToast(DENY_CHOICE_TEXT);
        flashChoices();
      }
      setBusy(true);
      setLog((l) => [...l, { id: Date.now(), role: "user", content: trimmed }]);
      try {
        // F118 分流：自然语言长句交给 /ai-action 叙事引擎（降级时回包带
        // degraded:true），指令形态仍走 /action——两条端点回包同构，
        // 下文统一按 reply/save 处理。F198：选项按钮是显式分支指令，
        // label 原文足够长会被误判成叙述句——带 choice_id 一律钉在
        // /action，服务端按当前场景数据结算，不归 AI 网关。
        const useAi = !choiceId && isNarrationInput(trimmed);
        const r: ActionResponse = useAi
          ? await postAiAction(save.id, trimmed)
          : await sendAction(save.id, trimmed, choiceId);
        const { reply, save: updated, degraded: replyDegraded } = r;
        if (updated) setSave(updated);
        // F219：被拒且场上还有选项组（must_choose 门）时给选项组一次
        // 描边闪光——文案不再说「上方/下方」，可点位置由这次高亮指认。
        if (
          (r as { refused?: boolean }).refused === true &&
          ((updated ?? save).next_choices?.length ?? 0) >= 2
        ) {
          flashChoices();
        }
        // F231：服务端确认这是 must_choose 门的「前进」拒绝（含预判未
        // 覆盖的路径——/ai-action 由 AI 判入 advance 的叙述句）——同一
        // .sys-toast 槽位补亮指路文案；连发时只是重置计时，不换元素。
        if (
          (r as { refused?: boolean }).refused === true &&
          (r as { intent?: string }).intent === "advance" &&
          sceneMustChoose(updated ?? save)
        ) {
          showToast(DENY_CHOICE_TEXT);
        }
        showSaveHint(Boolean((updated ?? save).combat));
        // F200 连击：一次动作可能带回多条战报（replies），逐条入日志；
        // 单条动作仍只有 reply 一条。回包 reply.id 缺失时补本地 id
        // （/ai-action 兜底回包无 DB 行）——React key 与日志行都需要稳定 id。
        const replyList: LogEntry[] =
          Array.isArray((r as { replies?: LogEntry[] }).replies) &&
          (r as { replies?: LogEntry[] }).replies!.length
            ? (r as { replies?: LogEntry[] }).replies!
            : [reply];
        const rows: UiEntry[] = replyList.map((rp, i) =>
          typeof rp.id === "number" ? rp : { ...rp, id: Date.now() + 1 + i }
        );
        if ((r as { choice_refusal_repeat?: boolean }).choice_refusal_repeat === true) {
          // F226：must_choose 重复拒绝服务端本就不落库——撤回上面乐观
          // 追加的 user 行、不追加 reply 行（连点拒绝一次 +2 行把正文
          // 顶走）。首条拒绝正文仍在日志里；本次轻提示走 .sys-toast
          // 瞬时层（actions 浮层，2.6s 自消，不动 .stage-col 子元素），
          // 选项组闪光已由上方 refused 分支触发。F231：提示文案改走
          // DENY_CHOICE_TEXT——说清「先选一个」，不复读三个选项名。
          setLog((l) => l.slice(0, -1));
          showToast(DENY_CHOICE_TEXT);
        } else if (replyDegraded === true) {
          const firstDegraded = !degradedNoteRef.current;
          degradedNoteRef.current = true;
          setLog((l) => [
            ...l,
            ...(firstDegraded ? [{ ...rows[0], degradedNote: true }, ...rows.slice(1)] : rows),
          ]);
          setDegraded(true);
        } else {
          setLog((l) => [...l, ...rows]);
        }
        // F129：服务端把「裸面板名」路由成 reply.panel——口述「地图」
        // 等价于点对应面板按钮，复用 openTab，不另起状态机。panel 是
        // 回包附加字段（不落库），LogEntry 未声明，本地窄化取值。
        const panel = (reply as { panel?: string }).panel;
        if (panel && PANEL_TAB_KEYS.has(panel as TabKey)) {
          openTab(panel as TabKey);
        }
        return true;
      } catch {
        setLog((l) => [
          ...l,
          {
            id: Date.now() + 1,
            role: "system",
            ephemeral: true,
            content: "【警报】与系统的连接中断。请检查网络后重试。",
          },
        ]);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [save, busy, openTab, showSaveHint, showToast, flashChoices]
  );

  // F221：顶栏「?」帮助键——与玩家手动输入「帮助」走同一条 dispatch
  // 通道（指令形态 → /action → help 意图 → 完整指令表落日志）。
  const onHelpToggle = useCallback(() => {
    void dispatch("帮助");
  }, [dispatch]);

  // 真通关（save.cleared）后追加「结算」tab；快捷键位仍只覆盖常驻 5 个。
  // useMemo 稳定引用，避免 keydown effect 每次渲染都重挂监听。
  const cleared = Boolean(save && save.cleared);
  const tabs = useMemo(() => (cleared ? [...TABS, ENDING_TAB] : TABS), [cleared]);

  // save 变化后当前 tab 可能已不在 tabs 内（如结算态被回退），此时回 inventory。
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab("inventory");
  }, [tabs, tab]);

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

  // F155「释放技能」开合回执：抽屉只本地开合、不走服务端，玩家需要一条
  // .stage-col 里的系统行确认面板开了——口径与 F143 面板动词回执一致。
  // 只在展开时写（收起不刷屏）；技能与可用性全部读 save.skills 视图，
  // 与行动栏列表同一数据源，不新造数值。
  const toggleBarSkills = useCallback(() => {
    if (!save || !liveCombat) return;
    if (barList === "skills") {
      setBarList(null);
      return;
    }
    setBarList("skills");
    const parts = (save.skills ?? skills).map((s) => {
      const unlocked = s.unlocked ?? s.learn_level <= save.level;
      const cd = s.cooldown_remaining ?? 0;
      const mpOk = s.mp_enough ?? save.mp >= s.mp_cost;
      const canCast = s.can_cast ?? (unlocked && cd === 0 && mpOk);
      if (canCast) return `${s.name}（MP ${s.mp_cost}）`;
      const reason = !unlocked
        ? `需 Lv.${s.learn_level}`
        : cd > 0
          ? `冷却中 ${cd} 回合`
          : !mpOk
            ? "MP 不足"
            : (s.reason ?? "不可用");
      return `${s.name}（${reason}）`;
    });
    setLog((l) => [
      ...l,
      {
        id: Date.now(),
        role: "system",
        ephemeral: true,
        content: `【系统】已调出技能面板 · 可用：${parts.join("/") || "无"}`,
      },
    ]);
  }, [save, skills, liveCombat, barList]);

  // F163 行动栏道具抽屉：交战期消耗品列表（与浮层道具子列表同一数据
  // 口径——背包 consumable 且 qty>0）。展开写一条系统回执行，口径与
  // F155 技能抽屉一致；点选发「使用道具 <名>」走战斗指令（占一回合，
  // 由服务端结算并反击），库存随回包回灌。
  const consumables = useMemo(() => {
    const catalog = new Map(items.map((it) => [it.id, it]));
    return inventory
      .map((row) => ({ row, item: catalog.get(row.item_id) }))
      .filter((r): r is { row: InventoryRow; item: Item } => Boolean(r.item) && r.row.qty > 0)
      .filter((r) => r.item.category === "consumable");
  }, [inventory, items]);

  const toggleBarItems = useCallback(() => {
    if (!save || !liveCombat) return;
    if (barList === "items") {
      setBarList(null);
      return;
    }
    setBarList("items");
    const parts = consumables.map(({ row, item }) => `${item.name}×${row.qty}`);
    setLog((l) => [
      ...l,
      {
        id: Date.now(),
        role: "system",
        ephemeral: true,
        content: `【系统】已调出道具面板 · 可用：${parts.join("/") || "无"}`,
      },
    ]);
  }, [save, liveCombat, barList, consumables]);

  // F148 口径兜底：背包页签已在当前位时重开面板也要回灌——drawer 开合
  // 纳入依赖，否则击杀后新掉落的栈在「背包」原位重开时仍显示旧计数。
  useEffect(() => {
    if (tab !== "inventory" || !save) return;
    getSave(save.id)
      .then((r) => {
        setInventory(r.inventory);
        setEquipment(r.equipment);
      })
      .catch(() => {});
  }, [tab, save, drawer]);

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
        setBarList(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= COMBAT_BUTTONS.length && liveCombat) {
        // 交战态：1–5 槽位指向战斗五键，与按钮上的键帽提示一致。
        // 「释放技能」「道具」键只开合对应抽屉，不发指令。
        const b = COMBAT_BUTTONS[n - 1];
        if (b.expand === "skills") toggleBarSkills();
        else if (b.expand === "items") toggleBarItems();
        // P205：快捷键与按钮同口径——连击 MP 不足不发请求，就地提示
        // （按钮已 disabled，键位不能绕出一次必拒的请求）。
        else if (b.input === "连击" && (save?.mp ?? 0) < COMBO_MP_COST)
          showToast(`魔力不足：连击需要 ${COMBO_MP_COST} MP——「攻击」零消耗`);
        else dispatch(b.input as string);
      } else if (n >= 1 && n <= ACTION_BUTTONS.length && !liveCombat) {
        const b = ACTION_BUTTONS[n - 1];
        // 终章态快捷键 1 与按钮同义：不再发「前进」，直接开结算。
        // 守关房叫阵态快捷键 1 与「叫阵守关者」同义：发「攻击」就地开战。
        if (b.input === "前进" && cleared) openTab("ending");
        else if (b.input === "前进" && challengeBoss) dispatch("攻击");
        // F247：must_choose 未决时快捷键 1 与按钮同口径——不发这条
        // 必拒的「前进」请求，就地弹指路提示（不静默）。
        else if (b.input === "前进" && forwardChoiceLocked) {
          showToast(DENY_CHOICE_TEXT);
          flashChoices();
        }
        // F257：「看尽」锁定态快捷键与按钮同口径——不发这条必拒的
        // 「观察」请求，就地弹服务端下发的理由（不静默）。
        else if (b.input === "观察" && observeLocked)
          showToast(save?.observe?.reason || "此处已看尽");
        else dispatch(b.input);
      } else if (n >= 5 && n < 5 + tabs.length && tabs[n - 5]) openTab(tabs[n - 5].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, openTab, tabs, cleared, liveCombat, challengeBoss, forwardChoiceLocked, observeLocked, flashChoices, toggleBarSkills, toggleBarItems, save, showToast]);

  // F136 接入既有存档的唯一入口：写入 localStorage 并回灌完整存档视图
  // （建档与「继续这个存档」共用，避免两条路径各自拼状态）。
  const enterSave = useCallback(async (saveId: number) => {
    localStorage.setItem(STORAGE_KEY, String(saveId));
    const full = await getSave(saveId);
    setSave(full.save);
    setInventory(full.inventory);
    setEquipment(full.equipment);
    await resumeLog(saveId);
    setConflict(null);
    setConfirmNew(false);
  }, [resumeLog]);

  // F084「加载更早」：窗口 50→100→150→200 逐级放宽，整窗回灌替换。
  // 指令间隙才允许翻页（busy 期回灌可能吞掉未落地的本地回显行）。
  const onLoadEarlier = useCallback(async () => {
    if (!save || busy || logPaging || logTail !== "more") return;
    const next = Math.min(logLimit + LOG_PAGE, LOG_CAP);
    setLogPaging(true);
    try {
      const fetched = await getLog(save.id, next + 1);
      const more = fetched.length > next;
      const rows = more ? fetched.slice(fetched.length - next) : fetched;
      const el = logRef.current;
      keepLogPosRef.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
      logBaseRef.current = rows.length;
      setLog(rows);
      setLogLimit(next);
      setLogTail(more ? "more" : "start");
    } catch {
      showToast("回溯失败，请稍后重试");
    } finally {
      setLogPaging(false);
    }
  }, [save, busy, logPaging, logTail, logLimit, showToast]);

  const onCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const playerName = name.trim();
      if (!playerName || busy) return;
      setBusy(true);
      setError(null);
      try {
        // 先查同名档：命中 → 挂起创建流程，弹「继续 / 另起新档」二选一；
        // 未命中 → 走原有创建流程，无额外步骤。
        const hits = await findSaves(playerName);
        if (hits.length) {
          setConflict({ name: playerName, saves: hits });
          setConfirmNew(false);
          return;
        }
        const created = await createSave(playerName);
        await enterSave(created.id);
      } catch {
        setError("存档创建失败，请重试。");
      } finally {
        setBusy(false);
      }
    },
    [name, busy, enterSave]
  );

  // 「继续这个存档」：直接接入 updated_at 最新的同名档（服务端倒序首条）。
  const onContinueSave = useCallback(async () => {
    if (!conflict || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enterSave(conflict.saves[0].id);
    } catch {
      setError("接入存档失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [conflict, busy, enterSave]);

  // 「另起新档」：第一下只翻成确认文案，再点才真发 mode:"new"——
  // 旧档不删，但本浏览器此后只认新档，确认门槛必须显性。
  const onNewSave = useCallback(async () => {
    if (!conflict || busy) return;
    if (!confirmNew) {
      setConfirmNew(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createSave(conflict.name, "new");
      await enterSave(created.id);
    } catch {
      setError("存档创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [conflict, confirmNew, busy, enterSave]);

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

  // F159 重新登记：只解本机绑定（清 localStorage 的存档 id 并卸掉内存态），
  // 存档本体留在服务端——回觉醒页后用原代号登记会走 F136 的
  // 「继续这个存档」找回。不做删除请求，也不弹二次确认。
  const onRebind = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (saveHintTimer.current) clearTimeout(saveHintTimer.current);
    if (choiceAttnTimer.current) clearTimeout(choiceAttnTimer.current);
    setChoiceAttn(0);
    setToast(null);
    setSaveHint(null);
    setSave(null);
    setLog([]);
    setInventory([]);
    setEquipment(null);
    setQuests(null);
    setChapters(null);
    setShadows(null);
    setTab("inventory");
    setDrawer(false);
    setCombatOpen(false);
    setBarList(null);
    setConflict(null);
    setConfirmNew(false);
    setName("");
    setInput("");
    setError(null);
    logBaseRef.current = 0;
    setLogLimit(LOG_PAGE);
    setLogTail("hidden");
  }, []);

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
              <p className="gate-line gate-line-action">登记猎人代号，接入「系统」。</p>
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
              {!name.trim() && (
                <p className="gate-hint">先登记一个猎人代号，再按「觉醒」。</p>
              )}
              <p className="gate-note">存档绑定本机浏览器，换设备请用同一猎人代号找回。</p>
              {conflict && (
                <div className="gate-conflict" role="alertdialog" aria-label="检测到已有存档">
                  <p className="gate-conflict-line">
                    检测到已有猎人「{conflict.saves[0].player_name}」（Lv.
                    {conflict.saves[0].level} · 第{conflict.saves[0].chapter}章）已有存档。
                  </p>
                  <div className="gate-conflict-actions">
                    <button className="btn primary" disabled={busy} onClick={onContinueSave}>
                      继续这个存档
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={onNewSave}
                      title="旧档将无法在此浏览器找回"
                    >
                      {confirmNew ? "确认另起新档" : "另起新档（旧档将无法在此浏览器找回）"}
                    </button>
                  </div>
                  {confirmNew && (
                    <p className="gate-conflict-warn">
                      再点一次「确认另起新档」将从 Lv.1 重新开始；旧档仍保留，但此浏览器不再接入。
                    </p>
                  )}
                </div>
              )}
              {error && <p className="gate-error">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // F252：每条日志收进一个独立可查询的 .log-entry 节点——一条日志可拆
  // 多段（splitStageEntry）、单段正文再按自然段拆多个 <p.narration>，
  // 条目边界此前在 DOM 里不可寻址。最新一段挂 data-latest="1"（唯一，
  // 供左侧强调轨 + 极淡底色指认「刚落下的那一段」）；ephemeral 标记
  // 随段上移到包装节点，.stage-col > .holo-ephemeral 的既有豁免口径
  // （resume-log-count 直接子节点选择器）因此不变。
  const stageSegs = log.flatMap((entry) =>
    splitStageEntry(entry).map((seg, i) => ({ seg, key: `${entry.id}:${i}` }))
  );

  return (
    <div className="app">
      <StatusBar
        key={save.id}
        save={save}
        equipment={equipment}
        degraded={degraded && !degradedDismissed}
        saveHint={saveHint}
        onDismissDegraded={() => setDegradedDismissed(true)}
        onOpenDrawer={() => setDrawer(true)}
        onHelp={onHelpToggle}
        onFreePoints={onFreePointsBadge}
      />

      <main className="stage">
        {/* F218：交战面板从 .stage-col 内 sticky 浮层改为舞台顶部的独立
            槽位——.stage 纵向 flex，面板钉在正文滚动区之外，矩形与
            .stage-col 恒不相交（390 下不再压住日志正文）；正文滚动职责
            随 logRef 一并下放 .stage-col。 */}
        {combatOpen && (
          <CombatPanel
            save={save}
            log={log}
            logBase={logBaseRef.current}
            equipment={equipment}
            onClose={() => setCombatOpen(false)}
          />
        )}
        {/* F084 日志顶部回溯控件：只放 stage-col 外（不进 .stage-col > *
            的行数口径）。有更早记录时是「加载更早」活键，翻到底后留
            「已到最初」死键占位；历史不足一屏时整块不渲染。 */}
        {logTail !== "hidden" && (
          <div className="log-earlier">
            <button
              type="button"
              className="log-earlier-btn"
              disabled={logPaging || logTail === "start" || busy}
              onClick={onLoadEarlier}
            >
              {logTail === "start" ? "已到最初" : logPaging ? "回溯中…" : "加载更早"}
            </button>
          </div>
        )}
        <div className="stage-col log" ref={logRef} onScroll={syncLogHint}>
          {/* F167：一条日志可拆成多个 .stage-col 子节点（遭遇/教学段独立
              成条），splitStageEntry 对回灌旧行与新行同规则生效。
              F252：每段再包一层 .log-entry——此前多段正文的每个
              <p.narration> 各挂为一个直接子节点，现收进所属段节点；
              子节点粒度由「段内段落」收敛为「段」，条目边界转为可查询
              结构。 */}
          {stageSegs.map(({ seg, key }, idx) => (
            <div
              key={key}
              className={`log-entry${seg.ephemeral ? " holo-ephemeral" : ""}`}
              data-latest={idx === stageSegs.length - 1 ? "1" : undefined}
            >
              <StageEntry entry={seg} />
            </div>
          ))}
          {save.at_epilogue && (
            // F089 一次性终章文案：按 save.at_epilogue 常驻一块横幅，不落
            // 日志、不随动作刷屏；附结算入口，与「查看结算」按钮同向。
            <div className="epilogue-banner" role="status">
              <div className="epilogue-kicker">故事的终章</div>
              <p className="epilogue-text">
                船已进港，账已结清。所有战斗与抉择都凝固成了战绩——前路已尽，剩下的只有回看。
              </p>
              {/* F228：全屏唯一主 CTA 在行动栏「查看结算」键上——横幅入口
                  降为普通 .btn，不再与主位同级高亮。 */}
              <button className="btn" onClick={() => openTab("ending")}>
                查看结算
              </button>
            </div>
          )}
          {busy && (
            <div className="pending">
              <span className="pending-dot" />
              正在书写……
            </div>
          )}
        </div>
        {logHint && (
          <div className="log-scroll-hint" data-scroll-hint="1" aria-hidden="true">
            <span className="hint-mark">▾</span>
          </div>
        )}
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
          {/* F192 抽屉内面板切换：与底部系统键同一 tabs 数据源，点击只换
              .side-scroll 内容、抽屉保持打开——移动端「档案→×→再点」的
              四跳收敛为抽屉内一跳。类名单立 .side-nav，不复用 .inv-tab
              （panels.mjs 的页签计数断言口径不变）。 */}
          <div className="side-nav" role="tablist" aria-label="档案面板切换">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab}
                className={`side-nav-btn${t.key === tab ? " on" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
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
          {/* F190 站内二次确认：不用 window.confirm（Playwright 对原生
              dialog 处理不稳）。确认条钉在 .side-foot 之上、.side-scroll
              之外——不被滚动区裁掉，抽屉打开即可见。确定执行既有 onRebind
              （一字不改），取消只收层。 */}
          {rebindConfirm && (
            <div
              className="rebind-confirm"
              role="alertdialog"
              data-testid="rebind-confirm"
              aria-label="确认重新登记"
            >
              <p className="rebind-confirm-text">
                确定重新登记猎人代号吗？本浏览器将回到觉醒页；原存档仍在服务器，用原代号可找回。
              </p>
              <div className="rebind-confirm-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setRebindConfirm(false);
                    onRebind();
                  }}
                >
                  确定
                </button>
                <button type="button" className="btn" onClick={() => setRebindConfirm(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
          <div className="side-foot">
            <div className="foot-row">
              <span>
                第 {tabs.findIndex((t) => t.key === tab) + 1} / {tabs.length} 面板
              </span>
              <span className="foot-esc">ESC 关闭</span>
              <span className="foot-tap">点 × 关闭</span>
            </div>
            {/* F159 换号入口：只解本机绑定不删档（原档用原代号可找回）。
                按钮 + 后果小字两行，与脚注同一 10px 等宽小字口径。
                F190：点击不再直接解绑——先弹上方的站内确认条。 */}
            <div className="foot-rebind">
              <button
                type="button"
                className="foot-rebind-btn"
                onClick={() => setRebindConfirm(true)}
              >
                重新登记（换猎人代号）
              </button>
              <span className="foot-rebind-note">原存档仍在服务器，用原代号可找回</span>
            </div>
          </div>
        </div>
      </aside>

      <footer className="actions">
        {toast && (
          <div key={toast.id} className="sys-toast" role="status">
            {toast.text}
          </div>
        )}
        {/* F255：F212 的首屏「左滑还有 地图/任务/影子…」暗示随横滑容器一并
            停用——系统键改为折行平铺后全部落在视口内，横滑暗示既失真也占位。 */}
        <div className={`actions-main${liveCombat ? " actions-combat" : ""}`}>
          <div className="action-groups">
            <div className="btn-group">
              <span className="group-label">行动</span>
              {/* F185/F185b：交战态探索组整组换五键，页面上没有一行字解释
                  主线为何暂停——说明小字收为「行动」组标签的行内后缀：桌面
                  .btn-group 是 flex 行、标签与按钮同行（零新增高度）。
                  F186：≤880px 整屏不再另挂第二条近义提示（无论挂 footer
                  还是 .stage 都会与 .save-blocked-hint 重复），「无法推进
                  剧情」语义并进 .save-blocked-hint 的合并文案——整页可见
                  交战提示收敛为 1。脱战（liveCombat=false）即不渲染。 */}
              {liveCombat && !narrow && (
                <span className="combat-lock-hint" role="note">
                  交战中无法推进剧情 · 先打完或「逃跑」脱身
                </span>
              )}
              {/* F094：探索组只在非交战渲染；交战中整组换为下方战斗五键，
                  服务端对和平意图的门禁（改判提示、零收益）与前台隐藏一致。 */}
              {!liveCombat &&
                ACTION_BUTTONS.map((b, i) => {
                // 休息吃 F086 配额口径：满状态/次数用尽时禁用，原因文案由
                // 服务端 save.rest 下发，不硬编码。
                const restInfo = b.input === "休息" ? save.rest : null;
                const restBlocked = Boolean(restInfo && !restInfo.available);
                // F257：「看尽」锁定吃 save.observe 口径——与休息键同构
                // （disabled + title 理由 + 就地小字），锁定原因由服务端
                // 给出，前端不硬编码文案。
                const obsInfo = b.input === "观察" ? save.observe : null;
                const obsBlocked = Boolean(obsInfo && !obsInfo.available);
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
                  const isCta = primaryCta?.kind === "advance";
                  return (
                    <button
                      key={b.label}
                      className={`btn${isCta ? " primary cta-primary" : ""}`}
                      data-primary-cta={isCta ? "1" : undefined}
                      onClick={() => openTab("ending")}
                      title="快捷键 1"
                    >
                      查看结算
                      <kbd className="key-badge">{i + 1}</kbd>
                    </button>
                  );
                }
                // F228：主位由 pickPrimaryCta 裁定——分支/交战态接管时
                // 「前进」槽（含叫阵/下章/折返换标）降为普通 .btn。
                const isCta = b.input === "前进" && primaryCta?.kind === "advance";
                // F247：must_choose 未决只锁「探索前进」原形——叫阵/下章/
                // 折返换标（上面三个布尔）仍是合法出路，不在锁定列。
                const choiceLocked =
                  b.input === "前进" && forwardChoiceLocked;
                const btn = (
                  <button
                    key={b.label}
                    className={`btn${isCta ? " primary cta-primary" : ""}${nextChapter ? " cta-next" : ""}${restBlocked || obsBlocked ? " rest-dim" : ""}`}
                    data-primary-cta={isCta ? "1" : undefined}
                    data-rest-state={restInfo ? (restBlocked ? "blocked" : "available") : undefined}
                    data-observe-state={obsInfo ? (obsBlocked ? "locked" : "available") : undefined}
                    disabled={busy || restBlocked || choiceLocked || obsBlocked}
                    onClick={() => dispatch(challenge ? "攻击" : b.input)}
                    title={
                      (obsBlocked && (obsInfo?.reason || "此处已看尽")) ||
                      (choiceLocked &&
                        "先做出选择——点选项键，或输入「选择 <选项名>」") ||
                      (restBlocked && (restInfo?.reason || "暂时无法休息")) ||
                      (challenge
                        ? `守关者就在面前 · 叫阵开战 · 快捷键 ${i + 1}`
                        : nextChapter
                          ? `进入第${nextChapter.index}章 · 过门不耗体力 · 快捷键 ${i + 1}`
                          : retreatToBoss
                            ? `守关者未击杀 · 需先击败它 · 快捷键 ${i + 1}`
                            : `快捷键 ${i + 1}`)
                    }
                    aria-disabled={busy || restBlocked || choiceLocked || obsBlocked}
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
                    {!restBlocked && !obsBlocked && <kbd className="key-badge">{i + 1}</kbd>}
                  </button>
                );
                // F245：禁用态「休息」点了毫无回执（F236 之前连小字都没
                // 有，现在只剩常驻 .rest-hint）——真实 pointer 点击落在
                // disabled 键上没有任何反馈，玩家分不清「没点上」还是
                // 「系统没理」。给禁用键外包一层透明承接壳：绝对定位覆盖
                // 按钮全区域，真实点击/Enter/Space 点亮 .sys-toast，文案
                // 透传服务端 save.rest.reason（满状态/次数用尽同一口径，
                // 前端不硬编码）；原生 disabled 键不收 DOM .click()，F236
                // 「禁用键零副作用」契约不破。可休息态整层不渲染，点击
                // 照旧走 button onClick 真回血。
                return restBlocked ? (
                  <span
                    key={b.label}
                    className="rest-tap-catcher"
                    role="button"
                    tabIndex={0}
                    aria-label={`休息（${restInfo?.reason || "暂时无法休息"}）`}
                    title={restInfo?.reason || "暂时无法休息"}
                    onClick={() => showToast(restInfo?.reason || "暂时无法休息")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        showToast(restInfo?.reason || "暂时无法休息");
                      }
                    }}
                  >
                    {btn}
                  </span>
                ) : (
                  btn
                );
              })}
              {/* F094/F113/F163 战斗五键：交战态整组展开（键帽 1–5），
                  是交战期唯一控制组——浮层战斗面板只剩情报不再渲染动作
                  键；守关房叫阵态（challengeBoss）只留承担开战的那一键
                  （F135——「释放技能/防御/道具/逃跑」的 disabled 残键像
                  半截战斗栏，不再渲染），按钮文案自带「叫阵」，点击就地
                  开战，与主按钮同一「攻击」结算路径。其余非交战态五键
                  折叠为下方 .combat-entry 单行矮入口（F113/F119 高度预算）。 */}
              {(liveCombat || challengeBoss) &&
                COMBAT_BUTTONS.map((b, i) => {
                const challengeable = challengeBoss && !liveCombat && b.input === "攻击";
                if (challengeBoss && !liveCombat && !challengeable) return null;
                // P205：连击 MP 不足即死键——disabled + 键面可见理由
                // （「（不足）」后缀，移动端无 hover 也读得到）+ title/
                // aria-label 给完整口径；服务端同条件 refused 兜底。
                const comboShort =
                  b.input === "连击" && liveCombat && save.mp < COMBO_MP_COST;
                const disabled = busy || (!liveCombat && !challengeable) || comboShort;
                // F228：交战主位只落在第一键「攻击」；叫阵态主位在行动组
                // 「叫阵守关者」上，这里的「叫阵 · 攻击」降为普通键。
                const isCta = primaryCta?.kind === "attack" && i === 0;
                return (
                  <button
                    key={b.label}
                    className={`btn${isCta ? " primary cta-primary" : ""}${
                      b.expand && barList === b.expand ? " on" : ""
                    }${b.cls ? ` ${b.cls}` : ""}`}
                    data-primary-cta={isCta ? "1" : undefined}
                    disabled={disabled}
                    aria-disabled={disabled}
                    aria-expanded={b.expand ? barList === b.expand : undefined}
                    aria-label={
                      comboShort
                        ? `连击 ×3 · 魔力不足：需要 ${COMBO_MP_COST} MP（当前 ${save.mp} MP），「攻击」零消耗`
                        : undefined
                    }
                    title={
                      comboShort
                        ? `魔力不足：连击需要 ${COMBO_MP_COST} MP（当前 ${save.mp} MP）·「攻击」零消耗，或先喝魔力药剂`
                        : liveCombat
                          ? b.expand
                            ? `${b.expand === "skills" ? "展开技能列表" : "展开道具列表"} · 快捷键 ${i + 1}`
                            : b.input === "连击"
                              ? `一次结算至多 3 回合 · 代价 ${COMBO_MP_COST} MP · 快捷键 ${i + 1}`
                              : `快捷键 ${i + 1}`
                          : challengeable
                            ? "守关者就在面前 — 叫阵开战"
                            : "当前没有可攻击的目标"
                    }
                    onClick={() =>
                      b.expand === "skills"
                        ? toggleBarSkills()
                        : b.expand === "items"
                          ? toggleBarItems()
                          : dispatch(b.input as string)
                    }
                  >
                    {challengeable ? "叫阵 · 攻击" : comboShort ? `${b.label}（不足）` : b.label}
                    {liveCombat && <kbd className="key-badge">{i + 1}</kbd>}
                  </button>
                );
              })}
              {!liveCombat && challengeBoss && (
                <span className="bar-combat-hint">守关者封着出口——叫阵即开战</span>
              )}
            </div>
            {/* F196 分支选项：当前场景有 ≥2 个真实选项时铺一排选项键。
                F198：回显行与请求 input 都用 label 原文——内部 id 只走
                choice_id 字段归属（服务端按当前场景数据判定，与口述同一
                结算路径），不暴露给玩家。选项带 effects 时代价小字随
                save 下发的 cost 字段渲染（「体力 −5」），前端不自算。 */}
            {!liveCombat && save.next_choices && save.next_choices.length >= 2 && (
              <div
                key={choiceAttn || "choice"}
                className={`btn-group btn-group-choice${choiceAttn ? " attn" : ""}`}
              >
                <span className="group-label">选择</span>
                {save.next_choices.map((c) => {
                  // F211：requires 前置未达的选项置灰——disabled +
                  // aria-disabled 保留语义，title 给服务端可执行说明
                  // （锁键不再把 label 复读一遍）；服务端 choice 拒绝
                  // 分支仍是兜底。
                  const locked = c.locked === true;
                  // F228：分支接管主位——第一条未锁定选项是唯一主 CTA，
                  // 其余分支键保持普通 .btn。
                  const isCta = primaryCta?.kind === "choice" && primaryCta.id === c.id;
                  return (
                    <button
                      key={c.id}
                      className={`btn${isCta ? " primary cta-primary" : ""}`}
                      data-primary-cta={isCta ? "1" : undefined}
                      disabled={busy || locked}
                      aria-disabled={busy || locked}
                      title={
                        locked
                          ? c.locked_reason || c.label
                          : c.cost
                            ? `${c.label} · 代价：${c.cost}`
                            : c.label
                      }
                      onClick={() => dispatch(c.label, c.id)}
                    >
                      {c.label}
                      {c.cost ? <span className="rest-count">{c.cost}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
            {/* F211 锁键原因就地常驻：title 在触屏等于不存在——选项组
                下方一行小字，文案取所有锁定项里第一条 locked_reason
                （服务端原文透传，与 .rest-hint 同一口径）；无锁定项时
                不渲染、不占行，交战态整组换战斗五键时一并消失。 */}
            {!liveCombat &&
              save.next_choices &&
              save.next_choices.length >= 2 &&
              (() => {
                const first = save.next_choices.find(
                  (c) => c.locked === true && c.locked_reason
                );
                return first ? (
                  <div className="choice-hint" role="note">
                    {first.locked_reason}
                  </div>
                ) : null;
              })()}
            {/* F177「休息」死键的就地原因：title 在触屏等于不存在——
                禁用态在四键下方常驻一行小字，文案原样透传服务端
                save.rest.reason（单一事实源，前端不另写措辞）；可休息
                不渲染不占位，交战态整组换战斗五键时一并消失。 */}
            {!liveCombat && save.rest && !save.rest.available && save.rest.reason && (
              <div className="rest-hint" role="note">
                {save.rest.reason}
              </div>
            )}
            {/* F257「看尽」锁键理由就地常驻：与休息键同一口径——title 在
                触屏等于不存在，禁用原因在四键下方常驻一行小字透传服务端
                save.observe.reason；可观察时不渲染不占位。 */}
            {!liveCombat && save.observe && !save.observe.available && save.observe.reason && (
              <div className="rest-hint observe-hint" role="note">
                {save.observe.reason}
              </div>
            )}
            {/* F113/F119 非交战战斗入口：单行矮槽位，disabled +
                aria-disabled 保留语义，文案即「当前没有可攻击的目标」提示；
                桌面下跟随行动组同行，移动端与系统组共享一行 meta 条。 */}
            {!liveCombat && !challengeBoss && (
              <button
                type="button"
                className="combat-entry"
                data-testid="combat-entry"
                disabled
                aria-disabled="true"
                title="当前没有可攻击的目标"
              >
                <span className="combat-entry-label">战斗</span>
                <i className="combat-entry-div" aria-hidden="true" />
                <span className="combat-entry-hint">当前没有可攻击的目标</span>
              </button>
            )}
            {/* F212 横滑暗示容器：.sys-scroll 桌面 display:contents
                透明透传（.btn-group-sys 仍是 .action-groups 的直接 flex
                子项，结构语义不变）；≤880px 收成 position:relative 的
                flex 槽，两枚 .sys-fade 装饰节点钉在可视左右缘——它们是
                可测量的元素而非 mask，pointer-events:none 不拦命中。 */}
            <div className="sys-scroll" ref={sysScrollRef}>
              <div className="btn-group btn-group-sys" ref={sysGroupRef}>
                <span className="group-label">系统</span>
                {tabs.map((t, i) => (
                  <button
                    key={t.key}
                    className="btn"
                    onClick={() => openTab(t.key)}
                    title={
                      i + 5 < 10 && !(liveCombat && i + 5 <= COMBAT_BUTTONS.length)
                        ? `快捷键 ${i + 5}`
                        : undefined
                    }
                  >
                    {t.label}
                    {/* F163：交战态 1–5 槽位归战斗组——「背包」的 kbd「5」
                        在交战时是假提示（按下实为逃跑），交战期摘下；6–9
                        仍然有效，照常显示。 */}
                    {i + 5 < 10 && !(liveCombat && i + 5 <= COMBAT_BUTTONS.length) && (
                      <kbd className="key-badge">{i + 5}</kbd>
                    )}
                  </button>
                ))}
                <button
                  className="btn"
                  onClick={() => {
                    // F132：脱战点开的是空面板（挂在 stage 列顶，长日志
                    // 滚到底后不在视口内），先给一行就地可见的空态提示。
                    if (!liveCombat) showToast("当前没有交战目标");
                    setCombatOpen((v) => !v);
                  }}
                  title="战斗面板开关"
                >
                  战斗
                </button>
                <button
                  className="btn"
                  disabled={busy || Boolean(save.combat)}
                  title={save.combat ? "交战中无法存档" : undefined}
                  onClick={() => {
                    // F132：点击即给就地反馈；回包落地后换成完成确认。
                    showToast("正在写入存档…");
                    void dispatch("存档").then((ok) => {
                      if (ok) showToast(`存档已写入 · 存档 #${save.id}`);
                    });
                  }}
                >
                  存档
                </button>
              </div>
              <i className="sys-fade sys-fade-l" aria-hidden="true" />
              <i className="sys-fade sys-fade-r" aria-hidden="true" />
            </div>
            {/* F160 交战存档死键的就地说明：移动端无 hover，title 等于
                不存在——紧随 .btn-group-sys 常驻一条整行小字（与
                .bar-combat-hint 同口径），脱战即消失不占位。 */}
            {liveCombat && (
              <div className="save-blocked-hint" role="note">
                {/* F186：窄屏并入「无法推进剧情」语义（F185 浮层不再单独
                    挂 footer），桌面保留 F160 原文。「交战中无法写入存档」
                    须连续出现——save-blocked-hint 断言是子串匹配。 */}
                {narrow
                  ? "交战中无法写入存档、也无法推进剧情 · 先「逃跑」或打赢这一场"
                  : "交战中无法写入存档 · 先「逃跑」或打赢这一场"}
              </div>
            )}
          </div>
          {/* F094 行动栏技能列表：只在交战态由「释放技能」开合。MP 消耗 /
              冷却 / 可释放性全部读服务端 save.skills 视图（与技能面板、
              /action 门禁同一口径），点击指令原样发出，MP/伤害由服务端结算。 */}
          {barList === "skills" && liveCombat && (
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
          {/* F163 行动栏道具列表：与技能抽屉同语言的二级列表。交战中点选
              发「使用道具 <名>」走战斗指令（占一回合、敌方结算反击），
              与浮层旧道具子列表同一服务端路径；qty 随 /action 回包回灌。 */}
          {barList === "items" && liveCombat && (
            <ul className="bar-skills" aria-label="战斗道具">
              {consumables.length === 0 ? (
                <li className="combat-sub-empty">背包里没有可用补给。</li>
              ) : (
                consumables.map(({ row, item }) => (
                  <li key={item.id}>
                    <button
                      className="bar-skill"
                      disabled={busy}
                      aria-disabled={busy}
                      title={item.desc}
                      onClick={() => dispatch(`使用道具 ${item.name}`)}
                    >
                      <span className="bar-skill-name">{item.name}</span>
                      <span className="bar-skill-meta">
                        ×{row.qty}
                        {item.heal ? ` · 恢复 ${item.heal} HP` : ""}
                        {item.mp ? ` · 恢复 ${item.mp} MP` : ""}
                      </span>
                    </button>
                  </li>
                ))
              )}
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
