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

const CATEGORIES: { key: ItemCategory; label: string }[] = [
  { key: "weapon", label: "武器" },
  { key: "armor", label: "防具" },
  { key: "consumable", label: "消耗品" },
  { key: "material", label: "材料" },
];

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

const EMPTY_TEXT: Record<ItemCategory, string> = {
  weapon: "武器格是空的。地下城里总有一把剑在等人捡。",
  armor: "防具格是空的。下一次突袭前，最好先把自己包起来。",
  consumable: "没有补给。药水会在最需要的时候见底。",
  material: "没有素材。传送门碎片、核心、血——都是能换钱的东西。",
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
  const [cat, setCat] = useState<ItemCategory>("weapon");
  const catalog = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const rows = useMemo(
    () =>
      inventory
        .map((row) => ({ row, item: catalog.get(row.item_id) }))
        .filter((r): r is { row: InventoryRow; item: Item } => Boolean(r.item) && r.row.qty > 0),
    [inventory, catalog]
  );

  const counts = useMemo(() => {
    const c: Record<ItemCategory, number> = { weapon: 0, armor: 0, consumable: 0, material: 0 };
    for (const { row, item } of rows) c[item.category] += row.qty;
    return c;
  }, [rows]);

  // 首次拿到背包时，若当前分类是空的就跳到第一个有货的分类，
  // 免得玩家一进面板先看到空槽。
  useEffect(() => {
    if (counts[cat] > 0) return;
    const next = CATEGORIES.find((c) => counts[c.key] > 0);
    if (next) setCat(next.key);
  }, [rows.length]);

  const shown = rows
    .filter(({ item }) => item.category === cat)
    .sort(
      (a, b) =>
        RARITY_ORDER[a.item.rarity] - RARITY_ORDER[b.item.rarity] ||
        a.item.name.localeCompare(b.item.name, "zh-Hans-CN")
    );

  const total = rows.reduce((n, { row }) => n + row.qty, 0);

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
        {CATEGORIES.map((c) => (
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
