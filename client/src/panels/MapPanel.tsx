import { useState } from "react";
import { ChapterView, ChapterGateState, Save } from "../api";

/* ────────────────────────────────────────────────
   地图面板（F090）：8 个章节节点都是 <button>，
   键盘可达、focus ring 走全局 :focus-visible。
   点击展开/收起该章详情（标题/副标题/简介/景数），
   只读回看——不写存档、不允许跳章。
   三态与进度全部由 GET /chapters 服务端结算：
   cleared（已通关）/ current（当前）/ locked（未到章）。
   F116：未到章的「门态」也由服务端 unlockView 下发——
   locked（真锁）写「锁定」、soft（软门放行）写「可强行进入」、
   open（门槛已满足）写「已解锁」；前置条件一律渲染服务端
   unlock.hint，本文件不再自拼「需 Lv.X / 需完成第X章主线」。
──────────────────────────────────────────────── */

const STATE_LABEL: Record<ChapterView["state"], string> = {
  cleared: "已通关",
  current: "当前",
  locked: "锁定",
};

// 状态 → 修饰类：map-now / map-cleared 沿用既有样式与 E2E 断言口径。
const STATE_CLASS: Record<ChapterView["state"], string> = {
  cleared: "map-cleared",
  current: "map-now",
  locked: "map-locked",
};

// F116 门态 → 展示：软门必须诚实写「可强行进入」，不得再挂「锁定」；
// open 写「已解锁」。门态缺失（接口未带 save）时按旧口径回退「锁定」。
const GATE_LABEL: Record<ChapterGateState, string> = {
  locked: "锁定",
  soft: "可强行进入",
  open: "已解锁",
};

const GATE_CLASS: Record<ChapterGateState, string> = {
  locked: "map-locked",
  soft: "map-soft",
  open: "map-openable",
};

function gateState(ch: ChapterView): ChapterGateState {
  return ch.unlock && ch.unlock.state ? ch.unlock.state : "locked";
}

// 未到章的门禁文案：hint 是服务端写好的整句（locked = 未达前置串，
// soft = 「推荐 X · 可强行进入（受压制）」）；hint 缺失时退回
// blocked_reasons 串——都是服务端字段，前端不拼数值。门槛已满足
// （open）时两者皆空，返回 null 不再画前置行。
function gateHint(ch: ChapterView): string | null {
  if (ch.unlock.hint) return ch.unlock.hint;
  const reasons = ch.unlock.blocked_reasons;
  if (Array.isArray(reasons) && reasons.length) return reasons.join(" · ");
  return null;
}

function metaLine(ch: ChapterView, save: Save): string {
  if (ch.state === "cleared") {
    return `已通关 · 主线 ${ch.main_total} 景 · 全章共 ${ch.scene_count} 景`;
  }
  if (ch.state === "current") {
    const at = save.scene_title ? ` · 「${save.scene_title}」` : "";
    return `进行中 · 主线 ${ch.progress.current}/${ch.progress.target}${at}`;
  }
  return gateHint(ch) ?? GATE_LABEL[gateState(ch)];
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
        const gated = ch.state === "locked";
        const gate = gateState(ch);
        const hint = gated ? gateHint(ch) : null;
        const nodeClass = gated ? GATE_CLASS[gate] : STATE_CLASS[ch.state];
        const stateText = gated ? GATE_LABEL[gate] : STATE_LABEL[ch.state];
        return (
          <li key={ch.id} className={`map-node ${nodeClass}${open ? " map-open" : ""}`}>
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
                {hint && <i className="map-req">{hint}</i>}
              </span>
              <span className="map-state">{stateText}</span>
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
