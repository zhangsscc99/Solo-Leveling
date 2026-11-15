import { useState } from "react";
import { ChapterView, Save } from "../api";

/* ────────────────────────────────────────────────
   地图面板（F090）：8 个章节节点都是 <button>，
   键盘可达、focus ring 走全局 :focus-visible。
   点击展开/收起该章详情（标题/副标题/简介/景数），
   只读回看——不写存档、不允许跳章。
   三态与进度全部由 GET /chapters 服务端结算：
   cleared（已通关）/ current（当前）/ locked（锁定）。
   锁定节点行内与详情都写出前置条件，不留「未解锁」孤文。
──────────────────────────────────────────────── */

const STATE_LABEL: Record<ChapterView["state"], string> = {
  cleared: "已通关",
  current: "当前",
  locked: "锁定",
};

// 状态 → 修饰类：map-now / map-locked 沿用既有样式与 E2E 断言口径。
const STATE_CLASS: Record<ChapterView["state"], string> = {
  cleared: "map-cleared",
  current: "map-now",
  locked: "map-locked",
};

// 锁定前置条件：unlock.chapter（需完成的前置章主线）+ unlock.level（等级门）。
function lockReason(ch: ChapterView): string {
  const parts: string[] = [];
  if (ch.unlock.chapter !== null) parts.push(`需完成第${ch.unlock.chapter}章主线`);
  if (ch.unlock.level !== null) parts.push(`需 Lv.${ch.unlock.level}`);
  return parts.length ? parts.join(" · ") : "需先推进前置章节";
}

function metaLine(ch: ChapterView, save: Save): string {
  if (ch.state === "cleared") {
    return `已通关 · 主线 ${ch.main_total} 景 · 全章共 ${ch.scene_count} 景`;
  }
  if (ch.state === "current") {
    const at = save.scene_title ? ` · 「${save.scene_title}」` : "";
    return `进行中 · 主线 ${ch.progress.current}/${ch.progress.target}${at}`;
  }
  return lockReason(ch);
}

export default function MapPanel({
  data,
  error,
  save,
}: {
  data: ChapterView[] | null;
  error: boolean;
  save: Save;
}) {
  // sel：null = 跟随当前章（默认展开）；-1 = 全部收起；其余 = 指定章。
  const [sel, setSel] = useState<number | null>(null);

  if (error) {
    return <p className="side-empty">地图信息不可用。与系统的连接中断，请稍后重试。</p>;
  }
  if (!data) {
    return <p className="side-empty">正在读取章节地图……</p>;
  }

  const followIndex = data.find((c) => c.state === "current")?.index ?? -1;
  const openIndex = sel === null ? followIndex : sel;
  const toggle = (index: number) => setSel(openIndex === index ? -1 : index);

  return (
    <ol className="map-list">
      {data.map((ch) => {
        const open = openIndex === ch.index;
        return (
          <li key={ch.id} className={`map-node ${STATE_CLASS[ch.state]}${open ? " map-open" : ""}`}>
            <button
              type="button"
              className="map-btn"
              aria-expanded={open}
              aria-controls={`map-detail-${ch.index}`}
              onClick={() => toggle(ch.index)}
            >
              <span className="map-ch">Ch.{ch.index}</span>
              <span className="map-name">
                {ch.title}
                {ch.state === "locked" && <i className="map-req">{lockReason(ch)}</i>}
              </span>
              <span className="map-state">{STATE_LABEL[ch.state]}</span>
              <span className="map-caret" aria-hidden="true" />
            </button>
            {open && (
              <div className="map-detail" id={`map-detail-${ch.index}`}>
                <p className="map-sub">{ch.subtitle}</p>
                <p className="map-summary">{ch.summary}</p>
                <p className="map-meta">{metaLine(ch, save)}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
