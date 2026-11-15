import { useEffect, useRef, useState } from "react";
import { DailyQuest, MainQuest, QuestReward, QuestsView } from "../api";

/* ────────────────────────────────────────────────
   任务面板：主线（按章节推导的状态徽记 + 场景进度）
   + 每日任务（实时重置倒数、完成进度、惩罚倒计时）。
   倒计时只读服务端下发的 reset_at/penalty.seconds_left，
   本地 1s 起表跟随，卸载即清理。
──────────────────────────────────────────────── */

const MAIN_BADGE: Record<MainQuest["status"], string> = {
  active: "进行中",
  done: "已达成",
  locked: "未解锁",
};

const DAILY_BADGE: Record<DailyQuest["status"], string> = {
  active: "进行中",
  done: "已完成",
};

// 距重置不足 1h 且尚有未完成 → 高危警示（blood-dim，不刺眼）。
const URGENT_SEC = 3600;

function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(x)}`;
}

function RewardLine({ reward }: { reward: QuestReward }) {
  const items = reward.items ?? [];
  return (
    <div className="q-rw">
      <span className="q-rw-label">奖励</span>
      <span className="q-rw-vals">
        <span className="q-rw-val">
          XP<b>{reward.xp}</b>
        </span>
        <span className="q-rw-val">
          金币<b>{reward.gold}</b>
        </span>
        {items.map((it) => (
          <span className="q-rw-val" key={it.id}>
            {it.name}
            <b>×{it.qty}</b>
          </span>
        ))}
      </span>
    </div>
  );
}

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  return (
    <div className="q-prog">
      <div
        className="q-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={current}
      >
        <div className="q-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="q-num">
        {current}
        <i>/</i>
        {target}
      </span>
    </div>
  );
}

export default function QuestPanel({ data, error }: { data: QuestsView | null; error: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const fetchedAt = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchedAt.current = Date.now();
  }, [data]);

  if (error) {
    return <p className="side-empty">任务信息不可用。与系统的连接中断，请稍后重试。</p>;
  }
  if (!data) {
    return <p className="side-empty">正在读取任务列表……</p>;
  }

  const resetMs = Date.parse(data.daily_reset_at);
  const resetLeft = Number.isFinite(resetMs) ? Math.max(0, Math.floor((resetMs - now) / 1000)) : 0;
  const elapsed = Math.max(0, Math.floor((now - fetchedAt.current) / 1000));
  const penaltyLeft = Math.max(0, data.penalty.seconds_left - elapsed);
  const penaltyOn = data.penalty.active && penaltyLeft > 0;
  const undone = data.daily.filter((q) => q.status !== "done").length;
  const urgent = !penaltyOn && undone > 0 && resetLeft > 0 && resetLeft <= URGENT_SEC;
  const currentChapter = data.main.find((q) => q.status === "active");

  return (
    <div className="quest">
      <section className="q-block" aria-label="每日任务">
        <div className="q-head">
          <span className="q-head-label">每日任务</span>
          <span className="q-head-meta">
            距重置 <b>{fmtClock(resetLeft)}</b>
          </span>
        </div>

        {penaltyOn && (
          <div className="q-penalty" role="alert">
            <span className="q-penalty-tag">惩罚</span>
            <span className="q-penalty-num">{fmtClock(penaltyLeft)}</span>
            <p className="q-penalty-desc">{data.penalty.desc}</p>
          </div>
        )}
        {urgent && (
          <p className="q-warn" role="status">
            {undone} 项每日任务未完成，倒计时归零将强制传送至惩罚副本。
          </p>
        )}

        {data.daily.length === 0 ? (
          <p className="q-empty">今日未下发每日任务。</p>
        ) : (
          <ol className="q-list">
            {data.daily.map((q) => (
              <li key={q.id} className={`q-row q-${q.status}`}>
                <div className="q-row-head">
                  <span className="q-title">{q.title}</span>
                  <span className={`q-badge b-${q.status}`}>{DAILY_BADGE[q.status]}</span>
                </div>
                <p className="q-desc">{q.desc}</p>
                <ProgressBar current={q.progress.current} target={q.progress.target} />
                <RewardLine reward={q.reward} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="q-block" aria-label="主线任务">
        <div className="q-head">
          <span className="q-head-label">主线任务</span>
          <span className="q-head-meta">
            {currentChapter ? `当前 ${currentChapter.title}` : "已推进至终章"}
          </span>
        </div>
        <ol className="q-list">
          {data.main.map((q) => (
            <li key={q.id} className={`q-row q-${q.status}`}>
              <div className="q-row-head">
                <span className="q-title">{q.title}</span>
                <span className={`q-badge b-${q.status}`}>{MAIN_BADGE[q.status]}</span>
              </div>
              {q.status !== "locked" && (
                <>
                  <p className="q-desc">{q.desc}</p>
                  <ProgressBar current={q.progress.current} target={q.progress.target} />
                  <RewardLine reward={q.reward} />
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
