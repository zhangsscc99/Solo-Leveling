import { useMemo } from "react";
import { CombatState, Equipment, LogEntry, Save } from "../api";

/* ────────────────────────────────────────────────
   战斗面板：save.combat（服务端交战态）是唯一事实源；
   日志文本只做渐进增强（敌名 / 回合数 / 伤害与治疗飘字），
   且脱战口径下指令表行与刷新前旧行一律不算交战信号（F141）。
   推断不到敌人时仍可由「战斗」入口手动打开。
   F163：面板退化为纯情报区（敌名 / HP 条 / 回合 / 每回合
   伤害预估 / 我方 HP·MP）——所有战斗动作由行动栏五键
   独占，面板不再渲染任何动作键，关掉面板照样能打。
──────────────────────────────────────────────── */

const SCAN = 16;
const MAX_FLOATERS = 4;

const ENEMY_RE = /遭遇[「『]?([^\s，。！？「」『』]{1,12})/;
const COUNTER_RE = /([^\s，。！？」』]{1,12})的反击/;
const TURN_RE = /第\s*(\d+)\s*回合/;
const DMG_RE = /造成\s*(\d+)\s*点伤害/g;
const HEAL_RE = /恢复\s*(\d+)\s*点生命/g;
const END_RE = /战斗结束|脱离战斗|成功逃跑|已经倒下|倒下了/;
const LEVEL_RE = /Lv\.\s*(\d+)|等级\s*(\d+)/;
const SEGMENT_RE = /遭遇|第\s*1\s*回合/;
// F141 系统指令表行：「帮助」回包里的「可用指令：…遭遇战中：「攻击」…」
// 是指令说明不是战报，行内「遭遇战中：」不得被 ENEMY_RE 抓成敌人名。
const SYS_TABLE_RE = /可用指令|遭遇战中/;

// 交战门控：save.combat（live）是第一信号；脱战时只信本会话新写入的
// 战报行（「遭遇X / 第N回合」）——指令表行与刷新回灌的旧行一律不算，
// 开场白与日常叙述里的「战斗」「受到」「倒下」等泛词同样不算。
// 最近一条结束语（END_RE）命中即收束；同一条内交战与结束同时出现时结束优先。
export type CombatGate = "engage" | "ended" | null;

export interface GateOpts {
  live: boolean; // save.combat 非空（服务端真实交战态，唯一事实源，见 F088）
  freshFrom?: number; // 会话内新日志的起始下标；此前的行是回灌旧行
}

function gateIndexes(log: LogEntry[], opts: GateOpts): { engage: number; end: number } {
  const tail = log.slice(-SCAN);
  const offset = log.length - tail.length;
  const freshFrom = opts.freshFrom ?? 0;
  let engage = -1;
  let end = -1;
  for (let i = 0; i < tail.length; i++) {
    // 玩家输入行（role "user"）不参与交战/结束判定：自由文本写什么都进
    // 日志，不能由玩家自己骗开面板。/action 的占位回显是 system 角色且
    // 内嵌原输入，真实战斗信号仍由服务端行触发，不受影响。
    if (tail[i].role === "user") continue;
    const c = tail[i].content;
    // 脱战口径：旧行与指令表行不计入交战——刷新后历史战报不得重新点亮
    // 面板；服务端交战（live）时不设限，战报行原样参与推断兜底。
    const countable = opts.live || (offset + i >= freshFrom && !SYS_TABLE_RE.test(c));
    if (countable && (ENEMY_RE.test(c) || TURN_RE.test(c))) engage = i;
    if (END_RE.test(c)) end = i;
  }
  return { engage, end };
}

// 供 App 判定面板开合：
//   "engage" → 自动展开；"ended" → 收束关闭；null → 不干预（保留手动开关）。
export function detectCombatGate(log: LogEntry[], opts: GateOpts): CombatGate {
  // 服务端交战态优先：结构字段非空直接判 engage，不走日志正则反推。
  if (opts.live) return "engage";
  const { engage, end } = gateIndexes(log, opts);
  if (end >= engage && end >= 0) return "ended";
  if (engage >= 0) return "engage";
  return null;
}

export interface CombatContext {
  inCombat: boolean;
  ended: boolean;
  enemyName: string | null;
  enemyLevel: number | null;
  enemyHp: number | null;
  enemyMaxHp: number | null;
  turn: number | null;
}

export interface Floater {
  id: string;
  side: "player" | "enemy";
  kind: "dmg" | "heal";
  value: number;
}

function inferContext(log: LogEntry[], opts: GateOpts): CombatContext {
  const tail = log.slice(-SCAN);
  const offset = log.length - tail.length;
  const freshFrom = opts.freshFrom ?? 0;
  const { engage, end } = gateIndexes(log, opts);
  let enemyName: string | null = null;
  let enemyLevel: number | null = null;
  let turn: number | null = null;
  for (let i = 0; i < tail.length; i++) {
    const e = tail[i];
    // 与门控同口径：指令表行与刷新前旧行不喂展示字段——否则敌名会被
    // 「遭遇战中：」覆盖、回合数会被旧战报回填。
    if (!opts.live && (offset + i < freshFrom || SYS_TABLE_RE.test(e.content))) continue;
    const enc = e.content.match(ENEMY_RE);
    if (enc) enemyName = enc[1];
    const counter = e.content.match(COUNTER_RE);
    if (counter) enemyName = counter[1];
    const lv = e.content.match(LEVEL_RE);
    if (lv) enemyLevel = Number(lv[1] ?? lv[2]);
    const t = e.content.match(TURN_RE);
    if (t) turn = Number(t[1]);
  }
  const inCombat = engage > end && engage >= 0;
  return {
    inCombat,
    ended: !inCombat && end >= 0,
    enemyName,
    enemyLevel,
    enemyHp: null,
    enemyMaxHp: null,
    turn,
  };
}

// 飘字归属：含「反击 / 受到」等受击措辞的行记到玩家侧，其余伤害记到敌人侧。
function inferFloaters(log: LogEntry[], enemyName: string | null): Floater[] {
  const tail = log.slice(-SCAN);
  let start = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (SEGMENT_RE.test(tail[i].content)) {
      start = i;
      break;
    }
  }
  const segment = start >= 0 ? tail.slice(start + 1) : log.slice(-4);
  const out: Floater[] = [];
  for (const e of segment) {
    const hurtsPlayer =
      (enemyName && e.content.includes(`${enemyName}的反击`)) ||
      /受到|向你.*(?:伤害|攻击)|你被/.test(e.content);
    let m: RegExpExecArray | null;
    DMG_RE.lastIndex = 0;
    while ((m = DMG_RE.exec(e.content))) {
      out.push({
        id: `${e.id}-d${out.length}`,
        side: hurtsPlayer ? "player" : "enemy",
        kind: "dmg",
        value: Number(m[1]),
      });
    }
    HEAL_RE.lastIndex = 0;
    while ((m = HEAL_RE.exec(e.content))) {
      out.push({ id: `${e.id}-h${out.length}`, side: "player", kind: "heal", value: Number(m[1]) });
    }
  }
  return out.slice(-MAX_FLOATERS);
}

function CombatGauge({
  label,
  hp,
  maxHp,
  kind,
}: {
  label: string;
  hp: number | null;
  maxHp: number | null;
  kind: "hp" | "mp";
}) {
  const known = hp !== null && maxHp !== null && maxHp > 0;
  const pct = hp !== null && maxHp !== null && maxHp > 0 ? Math.min(100, (hp / maxHp) * 100) : 0;
  return (
    <div className={`gauge combat-gauge gauge-${kind}${known && pct <= 30 ? " gauge-low" : ""}`}>
      <span className="gauge-label">{label}</span>
      <div className="gauge-track">
        <div
          className={`gauge-fill${known ? "" : " combat-gauge-unknown"}`}
          style={{ width: known ? `${pct}%` : "100%" }}
        />
      </div>
      <span className="gauge-num">
        {known ? (
          <>
            {hp}
            <i>/</i>
            {maxHp}
          </>
        ) : (
          <>
            —<i>/</i>—
          </>
        )}
      </span>
    </div>
  );
}

export default function CombatPanel({
  save,
  log,
  logBase = 0,
  onClose,
}: {
  save: Save;
  log: LogEntry[];
  logBase?: number;
  equipment: Equipment | null;
  onClose: () => void;
}) {
  const inferred = useMemo(
    () => inferContext(log, { live: Boolean(save.combat), freshFrom: logBase }),
    [log, save.combat, logBase]
  );
  // F088 单一事实源：save.combat（服务端交战态）优先；日志推断只做
  // 兼容兜底（面板开合信号与无真实敌人数据时的「未知目标」槽位）。
  const ctx = useMemo<CombatContext>(() => {
    const live = save.combat;
    if (live) {
      return {
        inCombat: true,
        ended: false,
        enemyName: live.enemy.name,
        enemyLevel: live.enemy.level,
        enemyHp: live.enemy.hp,
        enemyMaxHp: live.enemy.max_hp,
        turn: live.turn,
      };
    }
    return inferred;
  }, [save.combat, inferred]);
  const floaters = useMemo(() => inferFloaters(log, ctx.enemyName), [log, ctx.enemyName]);

  // F191 口径修正：单回合预估区间完全由服务端 combatView 下发——
  // 与 guardianWarning/resolveTurn 同一条 computeDamage（装备折算进
  // 属性、rank 压制、体力减伤、暴击上下限），前端不再裸算攻防差。
  // 四个字段缺一即不渲染，保持「非 live 推断态不渲染」的既有行为。
  const est = useMemo(() => {
    const live = save.combat as
      | (CombatState & {
          est_deal_lo?: number;
          est_deal_hi?: number;
          est_take_lo?: number;
          est_take_hi?: number;
        })
      | null;
    if (!live) return null;
    const { est_deal_lo, est_deal_hi, est_take_lo, est_take_hi } = live;
    const nums = [est_deal_lo, est_deal_hi, est_take_lo, est_take_hi];
    if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
    return {
      dealLo: Math.trunc(est_deal_lo as number),
      dealHi: Math.trunc(est_deal_hi as number),
      takeLo: Math.trunc(est_take_lo as number),
      takeHi: Math.trunc(est_take_hi as number),
    };
  }, [save.combat]);

  const floatsFor = (side: "player" | "enemy") =>
    floaters.filter((f) => f.side === side).slice(-MAX_FLOATERS);

  return (
    <section className="combat" aria-label="战斗面板">
      <div className="combat-head">
        <span className="combat-title">{ctx.inCombat ? "交战" : "战斗"}</span>
        <i className="status-div" aria-hidden="true" />
        <span className="combat-turn">{ctx.turn !== null ? `第 ${ctx.turn} 回合` : "回合 —"}</span>
        {ctx.ended && <span className="combat-ended">已结束</span>}
        <button className="combat-close" onClick={onClose} aria-label="关闭战斗面板">
          ×
        </button>
      </div>

      <div className="combat-sides">
        <div className="combatant">
          <div className="combatant-head">
            <span className="combatant-name">{save.player_name}</span>
            <span className="combatant-lv">Lv.{save.level}</span>
          </div>
          <div className="combatant-gauge">
            <CombatGauge label="HP" hp={save.hp} maxHp={save.max_hp} kind="hp" />
            <div className="combat-floats" aria-hidden="true">
              {floatsFor("player").map((f) => (
                <span key={f.id} className={`combat-float cf-${f.kind}`}>
                  {f.kind === "heal" ? `+${f.value}` : `-${f.value}`}
                </span>
              ))}
            </div>
          </div>
          <CombatGauge label="MP" hp={save.mp} maxHp={save.max_mp} kind="mp" />
        </div>

        <div className="combat-vs" aria-hidden="true">
          VS
        </div>

        <div className="combatant combatant-enemy">
          {ctx.inCombat ? (
            <>
              <div className="combatant-head">
                <span className="combatant-name">{ctx.enemyName ?? "未知目标"}</span>
                <span className="combatant-lv">
                  {ctx.enemyLevel !== null ? `Lv.${ctx.enemyLevel}` : "Lv.—"}
                </span>
              </div>
              <div className="combatant-gauge">
                <CombatGauge label="HP" hp={ctx.enemyHp} maxHp={ctx.enemyMaxHp} kind="hp" />
                <div className="combat-floats" aria-hidden="true">
                  {floatsFor("enemy").map((f) => (
                    <span key={f.id} className={`combat-float cf-${f.kind}`}>
                      {f.kind === "heal" ? `+${f.value}` : `-${f.value}`}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="combatant-empty">当前没有交战目标</div>
          )}
        </div>
      </div>

      {est && (
        <div
          className="combat-est"
          aria-label="单回合预计伤害"
          title="区间为不暴击下限–暴击上限，未计入闪避"
        >
          <span className="combat-est-label">每回合预估</span>
          <span className="combat-est-num">
            攻击 <b>{est.dealLo === est.dealHi ? est.dealLo : `${est.dealLo}–${est.dealHi}`}</b>
          </span>
          <span className="combat-est-num">
            承伤 <b>{est.takeLo === est.takeHi ? est.takeLo : `${est.takeLo}–${est.takeHi}`}</b>
          </span>
          <span className="combat-est-note">未计闪避</span>
        </div>
      )}
    </section>
  );
}
