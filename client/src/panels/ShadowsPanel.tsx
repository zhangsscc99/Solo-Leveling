import { Shadow, ShadowFormation } from "../api";

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };

export default function ShadowsPanel({
  data,
  error,
  busy,
  notice,
  onToggle,
}: {
  data: ShadowFormation | null;
  error: boolean;
  busy: boolean;
  notice: string | null;
  onToggle: (shadow: Shadow) => void;
}) {
  if (error) {
    return <p className="side-empty">影子栏位读取失败。与系统的连接中断，请稍后重试。</p>;
  }
  if (!data) {
    return <p className="side-empty">正在唤醒影子栏位……</p>;
  }
  if (data.shadows.length === 0) {
    return (
      <p className="side-empty">
        影子栏位空空如也。击败强敌后，将其提取为影子再来编队。
      </p>
    );
  }

  const ordered = [...data.shadows].sort(
    (a, b) =>
      Number(b.deployed) - Number(a.deployed) ||
      (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9) ||
      b.level - a.level
  );
  const full = data.count >= data.max;

  return (
    <div className="shadow">
      <div className="skill-meters">
        <div className="skill-meter">
          <span className="skill-meter-label">出战</span>
          <span className="skill-meter-name">影子编队</span>
          <span className="skill-meter-num">
            {data.count}/{data.max}
          </span>
        </div>
        <div className="skill-meter">
          <span className="skill-meter-label">战力</span>
          <span className="skill-meter-name">出战合计</span>
          <span className="skill-meter-num">{data.power}</span>
        </div>
      </div>
      {full && (
        <p className="shadow-full" role="status">
          队伍已满（{data.count}/{data.max}），先撤回一名影子。
        </p>
      )}
      {notice && (
        <p className="shadow-full" role="alert">
          {notice}
        </p>
      )}

      <ul className="skill-rows">
        {ordered.map((s) => {
          const canDeploy = s.deployed || !full;
          const disabled = busy || !canDeploy;
          const label = s.deployed ? "撤回" : "出战";
          const aria = s.deployed
            ? `撤回 ${s.name}`
            : full
              ? `${s.name}，队伍已满（${data.count}/${data.max}）`
              : `出战 ${s.name}`;
          return (
            <li key={s.id} className={`skill-row shadow-row${s.deployed ? " shadow-on" : ""}`}>
              <div className="skill-head">
                <span className="skill-name">
                  {s.deployed && <span className="shadow-badge">出战</span>}
                  {s.name}
                </span>
                <span className="skill-rarity shadow-rank">{s.rank}级</span>
              </div>
              <div className="skill-meta">
                <span className="skill-cost">Lv.{s.level}</span>
                <span className="skill-cd">
                  攻{s.stats.atk} 防{s.stats.def} 血{s.stats.hp}
                </span>
                <span className="skill-power">战力 {s.power}</span>
              </div>
              <div className="skill-acts">
                <button
                  className="skill-btn"
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={aria}
                  onClick={() => onToggle(s)}
                >
                  {label}
                </button>
                {!s.deployed && full && (
                  <span className="skill-state" aria-live="polite">
                    队伍已满（{data.count}/{data.max}）
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
