import { useMemo } from "react";
import { ItemRarity, Save, Skill } from "../api";

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

export default function SkillsPanel({
  save,
  skills,
  catalogError,
  busy,
  onRelease,
}: {
  save: Save;
  skills: Skill[];
  catalogError: boolean;
  busy: boolean;
  onRelease: (skill: Skill) => void;
}) {
  // F081：可释放性（unlocked/cooldown_remaining/mp_enough/engaged/can_cast/
  // reason）由服务端随 save.skills 下发，本面板只渲染不再本地推导；
  // 无服务端字段时（纯目录回包）退回 learn_level/MP 静态口径做兜底排序。
  const rows = useMemo(
    () =>
      [...skills].sort((a, b) => {
        const ua = a.unlocked ?? a.learn_level <= save.level;
        const ub = b.unlocked ?? b.learn_level <= save.level;
        return (
          Number(ua) - Number(ub) === 0
            ? a.learn_level - b.learn_level || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
            : Number(ub) - Number(ua)
        );
      }),
    [skills, save.level]
  );

  const learnedCount = useMemo(
    () => skills.filter((s) => s.unlocked ?? s.learn_level <= save.level).length,
    [skills, save.level]
  );

  // 目录接口失败不整页硬退：调用方已把 save.skills 合并进 skills，
  // 有可渲染行就降级展示存档视图 + 非阻塞提示；什么都没有时才兜底文案。
  if (skills.length === 0) {
    return catalogError ? (
      <p className="side-empty">技能目录不可用。与系统的连接中断，请稍后重试。</p>
    ) : (
      <p className="side-empty">尚未习得技能。系统的馈赠尚未到来。</p>
    );
  }

  const lockedCount = skills.length - learnedCount;

  return (
    <div className="skill">
      {catalogError && (
        <p className="skill-notice" role="status">
          技能目录连接中断——当前展示的是随存档下发的技能视图。
        </p>
      )}
      <div className="skill-meters">
        <div className="skill-meter">
          <span className="skill-meter-label">MP</span>
          <span className="skill-meter-name">当前魔力</span>
          <span className="skill-meter-num">
            {save.mp}/{save.max_mp}
          </span>
        </div>
        <div className="skill-meter">
          <span className="skill-meter-label">技能</span>
          <span className="skill-meter-name">
            已习得 {learnedCount} 项{lockedCount > 0 ? ` · ${lockedCount} 项未解锁` : ""}
          </span>
          <span className="skill-meter-num">
            {learnedCount}/{skills.length}
          </span>
        </div>
      </div>

      <ul className="skill-rows">
        {rows.map((skill) => {
          const unlocked = skill.unlocked ?? skill.learn_level <= save.level;
          const remain = skill.cooldown_remaining ?? 0;
          const coolingNow = remain > 0;
          const enoughMp = skill.mp_enough ?? save.mp >= skill.mp_cost;
          const canCast = (skill.can_cast ?? (unlocked && enoughMp && !coolingNow)) && !busy;
          const reason =
            skill.reason ??
            (!unlocked ? "等级不足" : coolingNow ? "冷却中" : !enoughMp ? "MP 不足" : null);
          const stateText = !unlocked
            ? `Lv.${skill.learn_level} 解锁`
            : coolingNow
              ? `冷却中 · 剩 ${remain} 回合`
              : !enoughMp
                ? "MP 不足"
                : reason === "无交锋目标"
                  ? "需交战目标"
                  : null;
          const ariaLabel = !unlocked
            ? `${skill.name}，Lv.${skill.learn_level} 解锁`
            : coolingNow
              ? `${skill.name}，冷却中，还需 ${remain} 回合`
              : !enoughMp
                ? `${skill.name}，MP 不足`
                : reason === "无交锋目标"
                  ? `${skill.name}，当前没有交锋目标`
                  : `释放 ${skill.name}`;
          const classes = [
            "skill-row",
            `r-${skill.rarity}`,
            !unlocked ? "skill-locked" : "",
            coolingNow ? "skill-cooling" : "",
            unlocked && !coolingNow && !enoughMp ? "skill-nomp" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={skill.id} className={classes}>
              <div className="skill-head">
                <span className="skill-name">{skill.name}</span>
                <span className="skill-rarity">{RARITY_LABEL[skill.rarity]}</span>
              </div>
              <div className="skill-meta">
                <span className="skill-cost">MP {skill.mp_cost}</span>
                <span className="skill-cd">冷却 {skill.cooldown} 回合</span>
                {skill.damage_preview && (
                  <span className="skill-dmg">
                    预计伤害 {skill.damage_preview.min}–{skill.damage_preview.max}
                  </span>
                )}
              </div>
              <p className="skill-desc">{skill.desc}</p>
              <div className="skill-acts">
                <button
                  className="skill-btn"
                  disabled={!canCast}
                  aria-disabled={!canCast}
                  aria-label={ariaLabel}
                  aria-live="off"
                  title={
                    !unlocked
                      ? `等级不足：需 Lv.${skill.learn_level}`
                      : coolingNow
                        ? `冷却中：还需 ${remain} 回合`
                        : !enoughMp
                          ? `MP 不足：需 ${skill.mp_cost}（当前 ${save.mp}）`
                          : reason === "无交锋目标"
                            ? "当前没有交锋目标"
                            : undefined
                  }
                  onClick={() => onRelease(skill)}
                >
                  {coolingNow ? `冷却 ${remain} 回合` : "释放"}
                </button>
                {stateText && (
                  <span className="skill-state" aria-live="polite">
                    {stateText}
                  </span>
                )}
              </div>
              {coolingNow && (
                <div className="skill-cd-track" aria-hidden="true">
                  <div
                    className="skill-cd-fill"
                    style={{ width: `${(remain / Math.max(1, skill.cooldown)) * 100}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
