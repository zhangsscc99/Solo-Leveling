import { useEffect, useMemo, useState } from "react";
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
  // 冷却只存在于本地：点击瞬间起表，MP 扣减等结算交给服务端回灌。
  const [cooling, setCooling] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      setCooling((prev) => {
        const next: Record<string, number> = {};
        for (const [id, left] of Object.entries(prev)) {
          if (left > 1) next[id] = left - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 已学在前（learn_level 升序），未解锁殿后（同为 learn_level 升序）。
  const ordered = useMemo(
    () =>
      [...skills].sort((a, b) => {
        const la = a.learn_level <= save.level ? 0 : 1;
        const lb = b.learn_level <= save.level ? 0 : 1;
        return (
          la - lb ||
          a.learn_level - b.learn_level ||
          RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
        );
      }),
    [skills, save.level]
  );

  const learnedCount = useMemo(
    () => skills.filter((s) => s.learn_level <= save.level).length,
    [skills, save.level]
  );

  if (catalogError) {
    return <p className="side-empty">技能目录不可用。与系统的连接中断，请稍后重试。</p>;
  }

  if (skills.length === 0) {
    return <p className="side-empty">尚未习得技能。系统的馈赠尚未到来。</p>;
  }

  const release = (skill: Skill) => {
    if (skill.cooldown > 0) {
      setCooling((prev) => ({ ...prev, [skill.id]: skill.cooldown }));
    }
    onRelease(skill);
  };

  const lockedCount = skills.length - learnedCount;

  return (
    <div className="skill">
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
        {ordered.map((skill) => {
          const unlocked = skill.learn_level <= save.level;
          const remain = cooling[skill.id] ?? 0;
          const coolingNow = remain > 0;
          const enoughMp = save.mp >= skill.mp_cost;
          const canCast = unlocked && enoughMp && !coolingNow && !busy;
          const stateText = !unlocked
            ? `Lv.${skill.learn_level} 解锁`
            : !coolingNow && !enoughMp
              ? "MP 不足"
              : null;
          const ariaLabel = !unlocked
            ? `${skill.name}，Lv.${skill.learn_level} 解锁`
            : coolingNow
              ? `${skill.name}，冷却中，剩余 ${remain} 秒`
              : !enoughMp
                ? `${skill.name}，MP 不足`
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
                <span className="skill-cd">冷却 {skill.cooldown}s</span>
                <span className="skill-power">威力 {skill.power}</span>
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
                        ? `冷却中：剩余 ${remain} 秒`
                        : !enoughMp
                          ? "MP 不足"
                          : undefined
                  }
                  onClick={() => release(skill)}
                >
                  {coolingNow ? `冷却 ${remain}s` : "释放"}
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
                    style={{ width: `${(remain / skill.cooldown) * 100}%` }}
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
