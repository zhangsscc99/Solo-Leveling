import { baseAttack, baseDefense, Equipment, Save, StatKey } from "../api";

/* ────────────────────────────────────────────────
   属性面板：五项属性仪表行 + 自由属性点分配 + 经验条。
   只上报要加哪一项（stat），扣点、上限联动、文案
   全部由服务端结算回灌；本地只管 busy 与禁用态。
──────────────────────────────────────────────── */

const STATS: { key: StatKey; label: string }[] = [
  { key: "strength", label: "力量" },
  { key: "agility", label: "敏捷" },
  { key: "vitality", label: "体力" },
  { key: "intelligence", label: "智力" },
  { key: "perception", label: "感知" },
];

export default function StatsPanel({
  save,
  equipment,
  busy,
  notice,
  onSpend,
}: {
  save: Save;
  equipment: Equipment | null;
  busy: boolean;
  notice: string | null;
  onSpend: (stat: StatKey) => void;
}) {
  const points = save.free_points ?? 0;
  const inCombat = Boolean(save.combat);
  const top = Math.max(...STATS.map((s) => save.stats[s.key] || 0), 1);
  const need = save.xp_to_next ?? 0;
  const capped = need <= 0;
  const xpPct = capped ? 100 : Math.min(100, (save.xp / need) * 100);
  const remain = Math.max(0, need - save.xp);

  return (
    <div className="stat-panel" aria-busy={busy}>
      <div className="stat-points">
        <span className="stat-points-label">剩余属性点</span>
        <span className={`stat-points-num${points > 0 ? " on" : ""}`}>{points}</span>
        <span className="stat-points-hint" aria-live="polite">
          {busy
            ? "分配中…"
            : inCombat
              ? "交战中无法分配属性点"
              : points > 0
                ? "点击 +1 分配"
                : "升级可获得属性点"}
        </span>
      </div>

      {notice && <p className="stat-notice">{notice}</p>}

      <div className="stat-table">
        {STATS.map(({ key, label }) => (
          <div className="stat-line" key={key}>
            <span className="stat-line-label">{label}</span>
            <div className="stat-line-track">
              <div
                className="stat-line-fill"
                style={{ width: `${((save.stats[key] || 0) / top) * 100}%` }}
              />
            </div>
            <span className="stat-line-num">{save.stats[key] || 0}</span>
            <button
              className="stat-add"
              disabled={busy || points <= 0 || inCombat}
              aria-disabled={busy || points <= 0 || inCombat}
              aria-label={`${label}加 1 点`}
              title={inCombat ? "交战中无法分配属性点" : undefined}
              onClick={() => onSpend(key)}
            >
              +1
            </button>
          </div>
        ))}
      </div>

      {/* 战斗数值：攻击 = floor(1.6×力量)+装备 atk，防御 = floor(0.8×体力)+装备 def。
          折算系数与 server/engine/stats.js 保持一致，改动需两边同步。 */}
      <section className="combat-nums" aria-label="战斗数值">
        <div className="combat-nums-head">战斗数值</div>
        <div className="combat-nums-cols" aria-hidden="true">
          <span />
          <span>基础</span>
          <span>装备</span>
          <span>合计</span>
        </div>
        {[
          { label: "攻击", base: baseAttack(save.stats), eq: equipment?.atk ?? 0 },
          { label: "防御", base: baseDefense(save.stats), eq: equipment?.def ?? 0 },
        ].map(({ label, base, eq }) => {
          const noGear = !equipment || (!equipment.weapon && !equipment.armor);
          return (
            <div
              className="combat-nums-row"
              key={label}
              aria-label={`${label} 合计 ${base + eq}，基础 ${base}，装备加成 ${eq}`}
            >
              <span className="cn-label">{label}</span>
              <span className="cn-num">{base}</span>
              {noGear ? (
                <span className="cn-eq cn-none">未装备</span>
              ) : (
                <span className="cn-num cn-eq">{eq > 0 ? `+${eq}` : "0"}</span>
              )}
              <span className="cn-num cn-total">{base + eq}</span>
            </div>
          );
        })}
      </section>

      <div className="stat-xp">
        <div className="stat-line">
          <span className="stat-line-label">经验值</span>
          <div className="stat-line-track">
            <div className="stat-line-fill" style={{ width: `${xpPct}%` }} />
          </div>
          <span className="stat-line-num">{capped ? "MAX" : `${Math.floor(xpPct)}%`}</span>
        </div>
        <div className="stat-xp-meta">
          <span className="stat-xp-nums">
            {save.xp}
            <i>/</i>
            {capped ? "—" : need}
          </span>
          <span className="stat-xp-hint">
            {capped ? "已达等级上限" : `距离 Lv.${save.level + 1} 还需 ${remain} 经验`}
          </span>
        </div>
      </div>
    </div>
  );
}
