import { Save, StatKey } from "../api";

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
  busy,
  notice,
  onSpend,
}: {
  save: Save;
  busy: boolean;
  notice: string | null;
  onSpend: (stat: StatKey) => void;
}) {
  const points = save.free_points ?? 0;
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
          {busy ? "分配中…" : points > 0 ? "点击 +1 分配" : "升级可获得属性点"}
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
              disabled={busy || points <= 0}
              aria-label={`${label}加 1 点`}
              onClick={() => onSpend(key)}
            >
              +1
            </button>
          </div>
        ))}
      </div>

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
