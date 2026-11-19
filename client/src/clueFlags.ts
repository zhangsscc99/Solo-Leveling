// F273：线索旗标的内部 id 泄漏进玩家可见正文（P0 文本质量/调试腔）。
//
// 服务端 choiceEffects() 用「【线索·<flag>】已记下。」把 effects.flag 落日志，
// 这条原串同时是旗标账本（flagSeen 扫日志行、requires.flag 门禁都读它），
// 因此不能在服务端改口径。修法只在渲染层做展示映射：日志原文、条目数、
// data-* 属性一律不动，玩家看到的是中文可读线索名而非 snake_case 变量名。

export const CLUE_LABELS: Record<string, string> = {
  // 第 1 章：石门之下 / 命令之律
  gripped_old_knife: "生锈猎刀的握法",
  read_the_law: "命令之律的第三条",
  reported_hollow_wall: "壁画后的空鼓砖缝",
  rookies_secured: "新人的落脚处",
  saw_statue_eyes: "石像睁眼的规律",
  scouted_fang: "獠牙的伏击位",
  snuck_to_altar: "祭坛侧的空档",
  system_bound: "系统与石殿的绑定",
};

const CLUE_FLAG_RE = /【线索·([^】]*)】/g;

// 把「【线索·read_the_law】」渲染成「【线索·命令之律的第三条】」；
// 未收录的 id 退化为「【线索】」——只去掉内部 id，绝不回退成原串，
// 也绝不丢掉「这里记下了一条线索」这层语义。没有 id 的「【线索】」原样通过。
export function displayClueFlags(text: string): string {
  if (!text || text.indexOf("【线索·") === -1) return text;
  return text.replace(CLUE_FLAG_RE, (_m, id: string) => {
    const label = CLUE_LABELS[id.trim()];
    return label ? `【线索·${label}】` : "【线索】";
  });
}
