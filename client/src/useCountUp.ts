import { useEffect, useRef, useState } from "react";

// F259 数字滚动（纯渲染层）：value 变化后由 requestAnimationFrame 在
// ~400ms 内从当前显示值过渡到新值，ease-out 收在终值上；滚动中
// counting=true，宿主用来挂 data-counting 断言标记。
//   · 动画中途再来新值：从当前已显示的数字续滚，不跳回起点；
//   · prefers-reduced-motion 下直接落终值、无中间帧——与全局 * 静止
//     规则同一口径（CSS 侧动效也全关）；
//   · 纯渲染层：不改任何下发数值，只改「多少毫秒铺完这个数字」。
const COUNT_UP_MS = 400;

export function useCountUp(value: number, duration = COUNT_UP_MS) {
  const [display, setDisplay] = useState(value);
  const [counting, setCounting] = useState(false);
  // 当前屏幕上真实显示的数字——续滚起点，避免 effect 闭包读到旧 state。
  const shownRef = useRef(value);
  useEffect(() => {
    shownRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) {
      // 值弹回当前显示值：若残存动画被 cleanup 撤掉，counting 一并收旗。
      setCounting(false);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || duration <= 0) {
      setDisplay(value);
      setCounting(false);
      return;
    }
    setCounting(true);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (value - from) * eased);
      if (v !== shownRef.current) setDisplay(v);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setDisplay(value);
        setCounting(false);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return { display, counting };
}
