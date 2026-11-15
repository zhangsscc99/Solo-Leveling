import { useEffect, useState } from "react";
import { Ending, fetchEnding } from "../api";

/* ────────────────────────────────────────────────
   结算面板：通关数据四格 + 战绩文本 + epilogue 摘要。
   全部数值由服务端按存档实时结算（/saves/:id/ending），
   本地只管拉取状态与降级提示，不算任何数字。
──────────────────────────────────────────────── */

const CELLS: { key: "level" | "kills" | "shadows" | "clear_time"; label: string }[] = [
  { key: "level", label: "等级" },
  { key: "kills", label: "总击杀" },
  { key: "shadows", label: "影子数量" },
  { key: "clear_time", label: "通关耗时" },
];

// epilogue 很长，面板只给摘要（首段），全文仍在日志/章节文本里。
function excerpt(text: string) {
  const first = text.split(/\n+/).find((p) => p.trim().length > 0) || "";
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

export default function EndingPanel({ saveId }: { saveId: number }) {
  const [ending, setEnding] = useState<Ending | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setEnding(null);
    setError(false);
    fetchEnding(saveId)
      .then((e) => alive && setEnding(e))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [saveId]);

  if (error) {
    return <p className="side-empty">结算数据暂时不可用。与系统的连接中断，请稍后重试。</p>;
  }
  if (!ending) {
    return <p className="side-empty">正在结算战绩……</p>;
  }

  // 击杀统计车道未接入：kills 缺失/为 0 是「未统计」而非「零击杀」，
  // 显示 — 并注明，不把 0 当真实战绩摆出来。
  const killsTracked = ending.stats.kills > 0;

  return (
    <div className="ending">
      <div className="end-head">
        <span className="end-title">{ending.title || "通关统计"}</span>
        <span className="end-head-meta">已通章节 {ending.stats.chapters_cleared}</span>
      </div>

      <div className="end-grid">
        {CELLS.map(({ key, label }) => (
          <div className="end-cell" key={key}>
            <span className="end-cell-num">
              {key === "kills" && !killsTracked ? "—" : ending.stats[key]}
            </span>
            <span className="end-cell-label">{label}</span>
          </div>
        ))}
      </div>

      {!killsTracked && <p className="end-note">注：战斗统计未接入，总击杀暂记「—」。</p>}

      {ending.lines.length > 0 && (
        <ol className="end-lines">
          {ending.lines.map((line, i) => (
            <li className="end-line" key={i}>
              {line}
            </li>
          ))}
        </ol>
      )}

      {ending.epilogue && <p className="end-epilogue">{excerpt(ending.epilogue)}</p>}
    </div>
  );
}
