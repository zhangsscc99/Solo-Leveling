import { useEffect, useMemo, useState } from "react";
import {
  Equipment,
  InventoryRow,
  Item,
  ItemCategory,
  ItemOp,
  ItemRarity,
  Save,
} from "../api";

// F148「关键」是前端归档页签，不是物品 category——后端契约不变，
// 关键道具（任务/过门要用的东西）从材料堆里提出来单独成签。
type InvTab = ItemCategory | "key";

const TABS: { key: InvTab; label: string }[] = [
  { key: "key", label: "关键" },
  { key: "weapon", label: "武器" },
  { key: "armor", label: "防具" },
  { key: "consumable", label: "消耗品" },
  { key: "material", label: "材料" },
];

// 关键道具白名单：丢失/看不见会直接卡死主线的物品（传送门碎片是过门与
// 任务结算的硬通货）。其余物品按自身 category 归档。
const KEY_ITEM_IDS = new Set(["gate_shard"]);

// 与 server/index.js LOOT_NAMES 同源：掉落物/任务物只有 item_id、不进
// /items 目录，服务端播报靠这张表兜底中文名，背包同口径——查不到才退回
// 原始 id，绝不让任何物品栈静默消失（F148）。
const LOOT_FALLBACK: Record<string, string> = {
  rune_shard: "符文碎片",
  stone_core: "石核",
  guardian_plate: "守卫铠片",
  smiling_idol_eye: "笑脸神像之眼",
  wolf_pelt: "狼皮",
  cracked_fang: "裂齿",
  beast_core: "兽核",
  moonlit_hide: "月光兽皮",
  venom_sac: "毒囊",
  serpent_scale: "蛇鳞",
  antidote_herb: "解毒草",
  toxic_gland: "毒腺",
  basilisk_venom: "蛇王毒液",
  frost_dust: "霜尘",
  ice_shard: "冰晶碎块",
  ice_crystal: "冰晶",
  eternal_frost_core: "永冻之核",
  winter_queen_tear: "冬之女王之泪",
  demon_iron: "恶魔铁",
  knight_crest: "骑士徽记",
  castle_key: "城堡钥匙",
  demon_blade: "恶魔之刃",
  baran_sigil: "巴兰印记",
  beru_carapace: "蚁王甲壳",
  ant_queen_essence: "蚁后精华",
  shadow_essence: "暗影精粹",
  monarch_fragment: "君主碎片",
  kings_jaw: "王者之颚",
  torn_scrap: "破损布片",
  dim_crystal: "微光晶石",
};

function tabOf(item: Item): InvTab {
  return KEY_ITEM_IDS.has(item.id) ? "key" : item.category;
}

const RARITY_LABEL: Record<ItemRarity, string> = {
  common: "常见",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};

const RARITY_ORDER: Record<ItemRarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  common: 3,
};

const EMPTY_TEXT: Record<InvTab, string> = {
  key: "没有关键道具。传送门碎片这类过门硬通货会单独归在这里。",
  weapon: "武器格是空的。地下城里总有一把剑在等人捡。",
  armor: "防具格是空的。下一次突袭前，最好先把自己包起来。",
  consumable: "没有补给。药水会在最需要的时候见底。",
  material: "没有素材。核心、血、晶石——都是能换钱的东西。",
};

function statLine(item: Item) {
  if (item.category === "weapon") return `攻击 +${item.atk ?? 0}`;
  if (item.category === "armor") return `防御 +${item.def ?? 0}`;
  if (item.category === "consumable") {
    const parts: string[] = [];
    if (item.heal) parts.push(`HP +${item.heal}`);
    if (item.mp) parts.push(`MP +${item.mp}`);
    return parts.join("  ");
  }
  return "";
}

function opsFor(item: Item): ItemOp[] {
  if (item.category === "consumable") return ["use", "discard"];
  if (item.category === "weapon" || item.category === "armor") return ["equip", "discard"];
  return ["discard"];
}

const OP_LABEL: Record<ItemOp, string> = { use: "使用", equip: "装备", discard: "丢弃" };

export default function InventoryPanel({
  save,
  inventory,
  items,
  equipment,
  busy,
  notice,
  onOp,
}: {
  save: Save;
  inventory: InventoryRow[];
  items: Item[];
  equipment: Equipment | null;
  busy: boolean;
  notice: string | null;
  onOp: (itemId: string, op: ItemOp) => void;
}) {
  const [cat, setCat] = useState<InvTab>("key");
  const catalog = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  // F148 不吞栈：/items 目录查不到的 item_id（掉落物/任务物）合成兜底
  // 条目归入「材料」，名字走 LOOT_FALLBACK，最后才退回原始 id。
  const rows = useMemo(
    () =>
      inventory
        .filter((row) => row.qty > 0)
        .map((row) => ({
          row,
          item:
            catalog.get(row.item_id) ??
            ({
              id: row.item_id,
              name: LOOT_FALLBACK[row.item_id] ?? row.item_id,
              category: "material",
              rarity: "common",
              desc: "战利品——系统目录未收录，按材料归档。",
            } satisfies Item),
        })),
    [inventory, catalog]
  );

  const counts = useMemo(() => {
    const c: Record<InvTab, number> = { key: 0, weapon: 0, armor: 0, consumable: 0, material: 0 };
    for (const { item } of rows) c[tabOf(item)] += 1;
    return c;
  }, [rows]);

  // 首次拿到背包时，若当前分类是空的就跳到第一个有货的分类，
  // 免得玩家一进面板先看到空槽。
  useEffect(() => {
    if (counts[cat] > 0) return;
    const next = TABS.find((c) => counts[c.key] > 0);
    if (next) setCat(next.key);
  }, [rows.length]);

  const shown = rows
    .filter(({ item }) => tabOf(item) === cat)
    .sort(
      (a, b) =>
        RARITY_ORDER[a.item.rarity] - RARITY_ORDER[b.item.rarity] ||
        a.item.name.localeCompare(b.item.name, "zh-Hans-CN")
    );

  // F148 计数口径与列表一致：「N 件」= 可见物品栈数（不是 qty 加总），
  // 与 GET /saves/:id 返回的栈数一一对应。
  const total = rows.length;

  return (
    <div className="inv">
      <div className="inv-slots">
        {(["weapon", "armor"] as const).map((slot) => {
          const eq = equipment ? equipment[slot] : null;
          return (
            <div className="inv-slot" key={slot}>
              <span className="inv-slot-label">{slot === "weapon" ? "武器" : "防具"}</span>
              <span className={`inv-slot-name${eq ? ` r-${eq.rarity}` : " empty"}`}>
                {eq ? eq.name : "空置"}
              </span>
              <span className="inv-slot-num">{eq ? `+${slot === "weapon" ? eq.atk : eq.def}` : "—"}</span>
            </div>
          );
        })}
        <div className="inv-slot inv-slot-total">
          <span className="inv-slot-label">合计</span>
          <span className="inv-slot-name">
            攻 {equipment ? equipment.atk : 0} · 防 {equipment ? equipment.def : 0}
          </span>
          <span className="inv-slot-num">{total} 件</span>
        </div>
      </div>

      <div className="inv-tabs" role="tablist" aria-label="背包分类">
        {TABS.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={cat === c.key}
            className={`inv-tab${cat === c.key ? " on" : ""}`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
            {counts[c.key] > 0 && <i className="inv-tab-badge">{counts[c.key]}</i>}
          </button>
        ))}
      </div>

      {notice && <p className="inv-notice">{notice}</p>}
      {/* F094 交战门禁（与服务端 /item 同口径）：交战中使用/装备被冻结，
          补给要走战斗「道具」指令占回合结算；丢弃仍允许（无免费收益）。 */}
      {save.combat && (
        <p className="inv-row-hint" role="status">
          交战中无法使用或更换装备——补给请走战斗「道具」指令（占一回合）。
        </p>
      )}

      {shown.length === 0 ? (
        <p className="side-empty inv-empty">{EMPTY_TEXT[cat]}</p>
      ) : (
        <ul className="inv-rows">
          {shown.map(({ row, item }) => {
            const stat = statLine(item);
            const equipped =
              (item.category === "weapon" && equipment?.weapon?.item_id === item.id) ||
              (item.category === "armor" && equipment?.armor?.item_id === item.id);
            return (
              <li key={item.id} className={`inv-row r-${item.rarity}`}>
                <div className="inv-row-head">
                  <span className="inv-row-name">{item.name}</span>
                  <span className="inv-rarity">{RARITY_LABEL[item.rarity]}</span>
                  <span className="inv-qty">×{row.qty}</span>
                </div>
                <div className="inv-row-meta">
                  {stat && <span className="inv-row-stat">{stat}</span>}
                  {equipped && <span className="inv-row-flag">已装备</span>}
                  {KEY_ITEM_IDS.has(item.id) && <span className="inv-row-flag">关键道具</span>}
                </div>
                <p className="inv-row-desc">{item.desc}</p>
                <div className="inv-row-acts">
                  {opsFor(item).map((op) => {
                    const combatBlocked =
                      Boolean(save.combat) && (op === "use" || op === "equip");
                    const disabled = busy || (op === "equip" && equipped) || combatBlocked;
                    return (
                      <button
                        key={op}
                        className={`inv-btn inv-btn-${op}`}
                        disabled={disabled}
                        aria-disabled={disabled}
                        title={
                          combatBlocked
                            ? op === "equip"
                              ? "交战中无法更换装备"
                              : "交战中请用战斗「道具」指令"
                            : undefined
                        }
                        onClick={() => onOp(item.id, op)}
                      >
                        {op === "equip" && equipped ? "已装备" : OP_LABEL[op]}
                      </button>
                    );
                  })}
                  {item.category === "consumable" && save.hp >= save.max_hp && !item.mp && (
                    <span className="inv-row-hint">HP 已满</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
