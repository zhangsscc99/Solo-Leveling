// F162 自由行动「动作 + 对象」解析：纯函数，不依赖 store/engine，可单测。
// CommonJS，永不抛异常——任何畸形输入都落安全返回。
//
// 旧版 unknownSceneLine 只在静态场景实体词表里找共指：玩家点名但不在
// 词表里的物被整段丢弃，「捡起碎片」也被归到 inspect 族答成「检查」。
// 本模块提供三件东西：
//   extractEntities(input)               从中文原文抽名词短语候选（启发式，
//                                        最长匹配优先，无分词器）
//   resolveTarget(input, entities, blob) 共指消解：点名且在表 → 点名的具体
//                                        物（哪怕不在表）→ 场景默认 → 四周
//   verbFamily(input)                    动作族：pickup（拾取）/inspect（查看）
//   pickupOutcome(input, target, exists) 拾取族的后果叙述：能带走 / 嵌死 /
//                                        根本不存在三种口径，绝不假装入包
//   denyLine(target, anchor, variant)    查看族点名非场景物的明确否认句
//   sceneAnchor(entities, blob)          场景里真实在场的实体串（否认句用）

// ── 词表 ──────────────────────────────────────────────────────────────

// 句首可剥的动词/副词/代词/介词。只用于「往右啃前缀」，不做子串匹配。
// 多字词靠前排列（stripWordList 内部也按长度倒序再兜底）。
const PREFIX_WORDS = [
  "蹲下身", "蹲下", "蹲低", "俯身", "弯腰", "趴下", "跪下", "起身", "站起",
  "站直", "凑近", "凑过去", "走近", "靠近", "绕到", "翻过", "爬上", "低头",
  "抬头", "伸手", "抬手", "抬脚", "随手", "顺手", "试着", "尝试", "试图",
  "打算", "想要", "准备", "继续", "开始", "重新", "再次", "仔细", "认真",
  "小心", "慢慢", "缓缓", "轻轻", "悄悄", "偷偷", "用力", "使劲", "赶紧",
  "赶忙", "急忙", "连忙", "忽然", "突然", "顿时", "于是", "然后", "接着",
  "跟着", "索性", "干脆", "直接", "立刻", "马上", "再次",
  "仔细检查", "检查", "端详", "打量", "观察", "察看", "查看", "看一看",
  "看看", "看", "瞧", "瞅", "望", "盯", "瞪", "瞟",
  "听一听", "倾听", "聆听", "听", "闻一闻", "闻", "嗅一嗅", "嗅",
  "摸一摸", "摸索", "触摸", "触碰", "摸", "碰", "敲一敲", "敲", "叩",
  "拍一拍", "拍", "按一按", "按", "推一推", "推", "拉", "拽", "扳", "掰",
  "掀", "翻找", "翻动", "翻",
  "捡起来", "捡起", "拾起", "拾", "拿起来", "拿起", "拿", "抓起来",
  "抓起", "抓", "握", "拎", "提", "拔出来", "拔出", "拔", "摘", "采",
  "取", "收起来", "收进", "收起", "收", "揣进", "揣", "塞进", "塞",
  "装进", "装", "搬", "抱", "扛", "掏出来", "掏出", "拿出", "取出",
  "寻找", "找一找", "找找", "找", "搜寻", "搜索", "数一数", "数",
  "试探", "试一试", "试", "掂一掂", "掂", "把玩", "端量", "摩挲", "挥",
  "看见", "瞥见", "瞧见", "发现", "感到", "感觉", "听见", "听到",
  "闻到", "嗅到", "摸到", "见",
  "我", "你", "他", "她", "它", "咱", "俺", "大家", "自己",
  "一下", "两下", "一口", "一阵", "一番", "一下下",
  "把", "将", "向", "朝", "对着", "对", "从", "在", "往", "到", "跟",
  "和", "与", "同", "给", "为", "沿着", "沿", "顺着", "顺", "隔着",
  "透过", "凭着", "用", "又", "再", "也", "都", "还", "就", "才", "先",
  "便", "忽", "已", "已经",
];

// 方位/处所开头词：「地上一枚碎片」先啃掉「地上」。
const LOC_PREFIXES = [
  "石阶上", "台阶上", "祭坛上", "石板上", "沙地上", "桌子上", "桌上",
  "墙上", "墙边", "墙角", "地上", "地面", "地下", "脚边", "脚前", "脚下",
  "手边", "手里", "身上", "身边", "四周", "周围", "附近", "眼前", "面前",
  "前方", "身后", "背后", "头顶", "殿里", "殿内", "房间里", "屋里",
  "门外", "门口", "通道里", "角落里", "阴影里", "黑暗中", "空气里",
  "空气中", "风中", "水中", "火里", "光里", "缝隙里", "怀里", "背包里",
  "口袋里",
];

// 环境词/抽象词：抽到也不算「玩家点名的物」。
const JUNK_NOUNS = new Set([
  "动静", "声音", "响动", "气息", "气味", "味道", "空气", "呼吸", "心跳",
  "目光", "眼神", "身影", "影子", "脚步", "脚步声", "风声", "光线",
  "亮光", "四周", "周围", "附近", "地上", "地面", "脚下", "脚边", "身边",
  "手边", "眼前", "面前", "头顶", "身前", "身后", "东西", "地方", "一切",
  "什么", "全身", "怀里", "力气", "勇气", "信仰", "命令", "委托", "报酬",
  "房租", "药费", "寂静", "安静", "沉默", "压抑", "微光", "寒意", "凉意",
  "热意", "暖意", "困意", "睡意", "醉意", "时间", "时候", "机会", "办法",
  "方向", "位置", "姿势", "站姿", "表情", "神色", "语气", "声调", "念头",
  "想法", "意思", "心情", "感觉", "印象", "记忆", "回忆", "经验", "教训",
]);

// 单字候选白名单：只有这些字允许以 1 字候选身份进入共指消解
// （防止「蹲下身」剥出「身」这类假名词）。
const OBJECT_CHARS = new Set(
  "刀剑枪弓矛盾甲杖锤斧匕矢石骨血珠环戒币符卷书信瓶罐灯火灰土沙木铁" +
    "金银玉钉链锁钥牌图棋坠冠盔靴袍贝果核肉饼酒药粉油膏盐米布纸笔钟" +
    "鼓镜扇伞箱柜床桌椅碑柱门窗墙瓦梁瓮缸盆碗盘碟勺筷铲镐锄镰鞭绳" +
    "网笼旗印珠宝刃柄芯鞘壳渣屑片块串盏堆"
);

// 拾取动词族——不得走 inspect 的「检查」话术。
const PICKUP_RE =
  /捡|拾|拿起|拿来|抓起|抓走|拎|拔下|拔出|拔掉|摘下|摘|采|收进|收起|收好|收|塞进|塞|揣|装进|装|带走|拿走|取走|取出|取|搬|抱走|揣兜|揣进/;

// 查看动词族（与 UNKNOWN_SCENE_LINES 的 inspect 同口径，用于区分话术）。
const INSPECT_RE =
  /检查|端详|打量|观察|察看|查看|翻看|摸|碰|敲|叩|拍|按|翻|试探|蹲|看|瞧|瞅|望|舔|尝|数/;

// 嵌死在场、揣不走的实体（词表内外的判断分开：表内查此集，表外默认可拾）。
const FIXTURE_ENTITIES = new Set([
  "石像", "石碑", "石阶", "台阶", "祭坛", "石柱", "石门", "长明灯",
  "壁画", "石座", "光幕", "沙地", "冰面", "火盆", "画像", "刻痕",
  "血迹", "门", "墙", "地面", "地", "四周",
]);

// 前缀剥离用的正则
const LEAD_PARTICLE_RE = /^[的了着过在把将呢啊吧嘛]/;
const DEMON_RE = /^[这那该其某另](?:[把个件块片颗张条只枚盏座些堆串层段截滴滩抹下种样])?/;
const NUM_RE =
  /^[一俩二两三四五六七八九十百千万半几]+[把个件块片颗张条只枚盏座些堆串层段截滴滩抹下种样回趟阵顿]?/;

// 句中动词字（把/将字句与「动宾倒置」的断点）：候选残串里再出现这些字，
// 说明宾语在动词左边，切出左段重新剥。
const INTERIOR_VERB_CHARS = /[揣塞拿捡收放装抓握扔丢拔掰砸摸敲看推拉按掀藏带拎提抱扛摘取吃喝闻听踢踩踏撞砸劈砍刺割刮涂抹挥洒丢掷投]/;

// 句中连词断点：「碎片然后站起来」这类并列谓语，切出左段才算名词。
const BOUNDARY_RE =
  /然后|接着|跟着|随后|于是|顺便|趁机|之后|以后|同时|一边|再去|再将|又把|再把|还要|并且|而且|或是|或者|准备|打算|想要|希望能|就可以/;

// ── 内部：前缀剥离 ────────────────────────────────────────────────────

const PREFIX_SORTED = [...PREFIX_WORDS, ...LOC_PREFIXES].sort(
  (a, b) => b.length - a.length
);
const PREFIX_SET = new Set(PREFIX_SORTED);

function stripWordList(s) {
  for (const w of PREFIX_SORTED) {
    if (s.startsWith(w) && s.length > w.length) return s.slice(w.length);
  }
  return s;
}

// 剥一层句首成分；返回 { text, head } ——head 是「X的」里 X 若带方位
// 后缀时剥出的潜藏名词（「石碑上的刻痕」→ head=石碑）。
function stripOnce(s) {
  let m;
  if (LEAD_PARTICLE_RE.test(s)) return { text: s.slice(1) };
  if ((m = s.match(DEMON_RE)) && m[0].length < s.length) {
    return { text: s.slice(m[0].length) };
  }
  if ((m = s.match(NUM_RE)) && m[0].length < s.length) {
    return { text: s.slice(m[0].length) };
  }
  const wl = stripWordList(s);
  if (wl !== s) return { text: wl };
  if ((m = s.match(/^[^的了]{1,5}的/)) && m[0].length < s.length) {
    const headPart = m[0].slice(0, -1);
    const head = /[上下里中边旁前后内外]$/.test(headPart)
      ? headPart.slice(0, -1)
      : null;
    return { text: s.slice(m[0].length), head };
  }
  return null;
}

// 剥尾部方位/体标记：「碎片上」「摸了个遍」这类尾巴不属名词本体。
const TAIL_RE =
  /(一下|一眼|一遍|两下|几声|一会儿|片刻|半晌|半天|起来|过来|过去|进去|出来|下来|上去|开来|之中|之间|之上|附近|周围|四周|[到进入中里上下边面处方前后内外旁侧了着的]+)$/;

function trimTail(s) {
  let cur = s;
  for (let i = 0; i < 6; i++) {
    const next = cur.replace(TAIL_RE, "");
    if (next === cur || next.length === 0) break;
    cur = next;
  }
  return cur;
}

// 一个名词短语的候选链：段首层层剥皮，每个中间态都是候选；
// 「X的」剥出的方位词头（石碑上→石碑）、句中动词左段（把字句宾语）
// 一并入链。链尾是最短的头名词。
function chainOf(seg) {
  const chain = [seg];
  let cur = seg;
  for (let i = 0; i < 20; i++) {
    const r = stripOnce(cur);
    if (!r) break;
    cur = r.text;
    // 「X的」剥出的方位头（石碑上→石碑）排在剥后本体后面——
    // 头名词按最短取，等长时链尾（的-宾语）优先于方位词头。
    chain.push(cur);
    if (r.head && r.head.length >= 1) chain.push(r.head);
  }
  const tail = trimTail(cur);
  if (tail && tail !== cur) chain.push(tail);
  // 句中断点：连词（然后/接着…）或动词字（把/将字句宾语在动词左），
  // 取最早出现者，把左段当新名词短语递归剥一遍。
  const bm = cur.match(BOUNDARY_RE);
  const vm = cur.search(INTERIOR_VERB_CHARS);
  let cut = -1;
  if (bm && bm.index > 0) cut = bm.index;
  if (vm > 0 && (cut < 0 || vm < cut)) cut = vm;
  if (cut > 0) {
    const left = trimTail(cur.slice(0, cut));
    if (left) chain.push(...chainOf(left));
  }
  return chain.filter(Boolean);
}

// 把整句按非中文字符切段，逐段产候选链（只保留长度 ≤24 的段——
// 超长段多是整段叙述，剥不出名词）。
function extractChains(input) {
  const text = typeof input === "string" ? input : "";
  const segs = text.split(/[^一-鿿]+/).filter((s) => s && s.length <= 24);
  return segs.map(chainOf);
}

// 链上的「头名词」：最短、非废词、像具体物的那一节。没有则 null。
function headOf(chain) {
  let best = null;
  for (const c of chain) {
    const ok = c.length >= 2 ? !JUNK_NOUNS.has(c) : OBJECT_CHARS.has(c);
    if (!ok) continue;
    // 仍含「的/了/着/过」或动词字的长串不是名词本体（「周围的动静」
    // 「碎片然后站」），头名词只要剥干净的那一节。
    if (c.length >= 2 && /[的了着过]/.test(c)) continue;
    if (c.length > 4 && INTERIOR_VERB_CHARS.test(c)) continue;
    // 仍以动词/代词/方位词开头——或干脆就是个动词/方位词——的串是
    // 谓语残段不是宾语（「蹲下身」「摸一摸」）。
    if (PREFIX_SET.has(c)) continue;
    if (PREFIX_SORTED.some((w) => c.startsWith(w) && c.length > w.length)) {
      continue;
    }
    // 仍以数量/指示成分开头的串没剥完（「一摸」「那把刀」残段）。
    if (NUM_RE.test(c) || DEMON_RE.test(c)) continue;
    if (best === null || c.length < best.length) best = c;
  }
  return best;
}

// ── 导出 ──────────────────────────────────────────────────────────────

// 玩家原文里的名词短语候选，最长匹配优先、去重。
function extractEntities(input) {
  try {
    const seen = new Set();
    const out = [];
    for (const chain of extractChains(input)) {
      for (const c of chain) {
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    }
    return out.sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

// 共指消解。sceneEntities=静态场景实体词表，sceneBlob=场景正文拼接。
// 返回 { target, named_by_player, exists_in_scene }。
function resolveTarget(input, sceneEntities, sceneBlob) {
  try {
    const entities = Array.isArray(sceneEntities) ? sceneEntities : [];
    const blob = typeof sceneBlob === "string" ? sceneBlob : "";
    const chains = extractChains(input);
    // ① 玩家点名且在实体表里：优先看头名词（「石阶上的刻痕」指刻痕，
    //    不指石阶），再看其余候选。
    for (const chain of chains) {
      const head = headOf(chain);
      const order = head ? [head, ...chain] : chain;
      for (const c of order) {
        const hit = entities.find(
          (e) => c.includes(e) || (c.length >= 2 && e.includes(c))
        );
        if (hit) {
          return {
            target: hit,
            named_by_player: true,
            exists_in_scene: blob ? blob.includes(hit) : true,
          };
        }
      }
    }
    // ② 玩家点名的具体物：形态像名词就算玩家所指，哪怕场景表没有。
    for (const chain of chains) {
      const head = headOf(chain);
      if (!head) continue;
      const exists = blob ? chain.some((c) => blob.includes(c)) : false;
      return {
        target: head,
        named_by_player: true,
        exists_in_scene: exists,
      };
    }
    // ③ 场景默认实体（场景正文真实在场的第一个词表物）→ ④ 四周。
    const def = entities.find((e) => blob.includes(e));
    if (def) {
      return { target: def, named_by_player: false, exists_in_scene: true };
    }
    return { target: "四周", named_by_player: false, exists_in_scene: false };
  } catch {
    return { target: "四周", named_by_player: false, exists_in_scene: false };
  }
}

// 动作族：拾取优先于查看（「捡起碎片再检查」仍按拾取应答）。
function verbFamily(input) {
  const text = typeof input === "string" ? input : "";
  if (PICKUP_RE.test(text)) return "pickup";
  if (INSPECT_RE.test(text)) return "inspect";
  return null;
}

// 场景正文里真实在场的实体，拼成「石像和石门」式锚点；没有在場物
// 时给一句场景中性说法。
function sceneAnchor(sceneEntities, sceneBlob) {
  const entities = Array.isArray(sceneEntities) ? sceneEntities : [];
  const blob = typeof sceneBlob === "string" ? sceneBlob : "";
  const present = entities.filter((e) => blob.includes(e)).slice(0, 2);
  return present.length ? present.join("和") : "四壁的陈设";
}

// 拾取族的后果叙述。exists=false → 明确否认（否认词 + 拾取动词都保留）；
// exists=true 且 takeable=false → 嵌死带不走；takeable=true → 拿起来看了
// 又放下——场景数据没有 pickups/掉落表可入包，绝不假装入包。
function pickupOutcome(input, target, exists, opts) {
  const t = typeof target === "string" && target ? target : "那个东西";
  const o = opts && typeof opts === "object" ? opts : {};
  const anchor = o.anchor || "四壁的陈设";
  const n = Number.isInteger(o.variant) ? Math.abs(o.variant) : 0;
  if (!exists) {
    if (t === "四周" || t === "那个东西") {
      return "你四下摸了摸，没找到什么能顺手带走的东西。";
    }
    const lines = [
      `你蹲低去捡——可这里没有你说的${t}，只有${anchor}。`,
      `你伸手去拾，摸到的却只有${anchor}——这里没有你所说的${t}。`,
      `你四下找了找，没有什么${t}可拿——眼前只有${anchor}。`,
    ];
    return lines[n % lines.length];
  }
  if (o.takeable !== true) {
    const lines = [
      `你伸手去掰${t}——它像是从墙体里长出来的，纹丝不动，带不走。`,
      `你两只手搭上${t}使劲试了试，它死死嵌在原处，纹丝不动。`,
      `${t}纹丝不动。你抠了抠它的边缘，又推了一把——拿不走，只好作罢。`,
    ];
    return lines[n % lines.length];
  }
  const lines = [
    `你把${t}捡起来掂了掂——入手冰凉，棱角早被磨圆。看来看去派不上用场，你又把它放回了原处。（这次没带走什么值钱的）`,
    `你拾起${t}收进掌心——比看上去沉，表面蒙着一层细灰。掂量半晌，你还是搁了回去。（这次没带走什么值钱的）`,
    `你捡起${t}凑近看了看——纹路粗糙，像是从更大的东西上崩下来的。没什么用，你松手任它落回地面。（这次没带走什么值钱的）`,
  ];
  return lines[n % lines.length];
}

// 查看族点名了非场景物时的明确否认——不得换个场景物作答。
function denyLine(target, anchor, variant) {
  const t = typeof target === "string" && target ? target : "那个东西";
  const a = anchor || "四壁的陈设";
  const n = Number.isInteger(variant) ? Math.abs(variant) : 0;
  const lines = [
    `你凑近想看个仔细——可这里没有你说的${t}，只有${a}。`,
    `你四下寻了一圈也没找到${t}，眼前只有${a}。`,
    `这里没有你说的${t}。你的目光扫过${a}，确认不是自己看漏了。`,
  ];
  return lines[n % lines.length];
}

module.exports = {
  extractEntities,
  resolveTarget,
  verbFamily,
  pickupOutcome,
  denyLine,
  sceneAnchor,
  FIXTURE_ENTITIES,
  PICKUP_RE,
  INSPECT_RE,
};
