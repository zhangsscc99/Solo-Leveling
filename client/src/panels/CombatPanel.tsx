import { useMemo, useState } from "react";
import { InventoryRow, Item, LogEntry, Save, Skill } from "../api";

/* ────────────────────────────────────────────────
   战斗面板：服务端暂无结构化战斗态字段，
   这里从最近日志文本里推断战斗上下文（敌人名 /
   回合数 / 伤害与治疗数值），做成渐进增强覆盖层。
   推断不到敌人时仍可由「战斗」入口手动打开。
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

// 交战门控：只有「遭遇X / 第N回合」这类明确信号才算进入战斗态——
// 开场白与日常叙述里的「战斗」「受到」「倒下」等泛词一律不算。
// 最近一条结束语（END_RE）命中即收束；同一条内交战与结束同时出现时结束优先。
export type CombatGate = "engage" | "ended" | null;

function gateIndexes(log: LogEntry[]): { engage: number; end: number } {
  const tail = log.slice(-SCAN);
  let engage = -1;
  let end = -1;
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i].content;
    if (ENEMY_RE.test(c) || TURN_RE.test(c)) engage = i;
    if (END_RE.test(c)) end = i;
  }
  return { engage, end };
}

// 供 App 判定面板开合：
//   "engage" → 自动展开；"ended" → 收束关闭；null → 不干预（保留手动开关）。
export function detectCombatGate(log: LogEntry[]): CombatGate {
  const { engage, end } = gateIndexes(log);
  if (end >= engage && end >= 0) return "ended";
  if (engage >= 0) return "engage";
  return null;
}

export interface CombatContext {
  inCombat: boolean;
  ended: boolean;
  enemyName: string | null;
  enemyLevel: number | null;
  turn: number | null;
}

export interface Floater {
  id: string;
  side: "player" | "enemy";
  kind: "dmg" | "heal";
  value: number;
}

function inferContext(log: LogEntry[]): CombatContext {
  const tail = log.slice(-SCAN);
  const { engage, end } = gateIndexes(log);
  let enemyName: string | null = null;
  let enemyLevel: number | null = null;
  let turn: number | null = null;
  for (const e of tail) {
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
  return { inCombat, ended: !inCombat && end >= 0, enemyName, enemyLevel, turn };
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
            ??<i>/</i>??
          </>
        )}
      </span>
    </div>
  );
}

export default function CombatPanel({
  save,
  log,
  skills,
  inventory,
  items,
  busy,
  onAction,
  onUseItem,
  onClose,
}: {
  save: Save;
  log: LogEntry[];
  skills: Skill[];
  inventory: InventoryRow[];
  items: Item[];
  busy: boolean;
  onAction: (input: string) => void;
  onUseItem: (itemId: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"skill" | "item" | null>(null);

  const ctx = useMemo(() => inferContext(log), [log]);
  const floaters = useMemo(() => inferFloaters(log, ctx.enemyName), [log, ctx.enemyName]);

  const hasEnemy = ctx.enemyName !== null;
  const actDisabled = busy || !hasEnemy;
  const actTitle = hasEnemy ? undefined : "当前没有敌人";
  const learned = useMemo(
    () => skills.filter((s) => s.learn_level <= save.level),
    [skills, save.level]
  );
  const consumables = useMemo(() => {
    const catalog = new Map(items.map((it) => [it.id, it]));
    return inventory
      .map((row) => ({ row, item: catalog.get(row.item_id) }))
      .filter((r): r is { row: InventoryRow; item: Item } => Boolean(r.item) && r.row.qty > 0)
      .filter((r) => r.item.category === "consumable");
  }, [inventory, items]);

  const act = (input: string) => {
    setMode(null);
    onAction(input);
  };

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
          {hasEnemy ? (
            <>
              <div className="combatant-head">
                <span className="combatant-name">{ctx.enemyName}</span>
                <span className="combatant-lv">
                  {ctx.enemyLevel !== null ? `Lv.${ctx.enemyLevel}` : "Lv.—"}
                </span>
              </div>
              <div className="combatant-gauge">
                <CombatGauge label="HP" hp={null} maxHp={null} kind="hp" />
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

      <div className="combat-acts" role="group" aria-label="战斗行动">
        <button
          className="combat-btn primary"
          disabled={actDisabled}
          aria-disabled={actDisabled}
          title={actTitle}
          onClick={() => act("攻击")}
        >
          攻击
        </button>
        <button
          className={`combat-btn${mode === "skill" ? " on" : ""}`}
          disabled={actDisabled}
          aria-disabled={actDisabled}
          title={actTitle}
          onClick={() => setMode((m) => (m === "skill" ? null : "skill"))}
        >
          技能
        </button>
        <button
          className="combat-btn"
          disabled={actDisabled}
          aria-disabled={actDisabled}
          title={actTitle}
          onClick={() => act("防御")}
        >
          防御
        </button>
        <button
          className={`combat-btn${mode === "item" ? " on" : ""}`}
          disabled={actDisabled}
          aria-disabled={actDisabled}
          title={actTitle}
          onClick={() => setMode((m) => (m === "item" ? null : "item"))}
        >
          道具
        </button>
        <button
          className="combat-btn combat-flee"
          disabled={actDisabled}
          aria-disabled={actDisabled}
          title={actTitle}
          onClick={() => act("逃跑")}
        >
          逃跑
        </button>
      </div>

      {mode === "skill" && (
        <ul className="combat-sub">
          {learned.length === 0 ? (
            <li className="combat-sub-empty">尚未习得技能。</li>
          ) : (
            learned.map((s) => (
              <li key={s.id} className="combat-sub-row">
                <span className="combat-sub-name">{s.name}</span>
                <span className="combat-sub-meta">
                  MP {s.mp_cost} · 威力 {s.power}
                </span>
                <button
                  className="combat-sub-btn"
                  disabled={busy || save.mp < s.mp_cost}
                  onClick={() => act(`释放技能 ${s.name}`)}
                >
                  {save.mp < s.mp_cost ? "MP 不足" : "释放"}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {mode === "item" && (
        <ul className="combat-sub">
          {consumables.length === 0 ? (
            <li className="combat-sub-empty">背包里没有可用补给。</li>
          ) : (
            consumables.map(({ row, item }) => (
              <li key={item.id} className="combat-sub-row">
                <span className="combat-sub-name">{item.name}</span>
                <span className="combat-sub-meta">×{row.qty}</span>
                <button
                  className="combat-sub-btn"
                  disabled={busy}
                  onClick={() => {
                    setMode(null);
                    onUseItem(item.id);
                  }}
                >
                  使用
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
