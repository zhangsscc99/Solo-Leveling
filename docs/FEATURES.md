# FEATURES — 增量开发清单

规则：每跳只做**一个**未勾选项；勾选时在行尾追加 `✅ (<日期> <lane>)`。
`lane` 取值：`devin`（SWE-2 免费模型）或 `opencode`（deepseek-v4.1-flash）。

## M1.0 UI 视觉重做（优先级最高，先于功能条目）

- [x] F000 设计计划：按 frontend-design skill 产出色板/字体/布局/原则，写入 `docs/DESIGN.md` ✅ (2026-11-15 opencode)
- [x] F000b 落地设计令牌与全局样式（色板变量、字号阶梯、间距节奏、焦点态），替换现有默认样式 ✅ (2026-11-15 opencode)
- [x] F000c 主界面布局重构：状态栏 + 主舞台 + 侧栏 + 操作区，桌面三栏 / 移动端纵向 ✅ (2026-11-15 opencode)
- [x] F000d 系统播报窗口视觉（全息蓝窗、扫描线、出现/消失动效，遵循 reduced-motion） ✅ (2026-11-15 opencode)
- [x] F000e 字体与排版落地（中文可用字体，display 与 body 分工，行宽 <80 字符） ✅ (2026-11-15 opencode)

## M1 界面补全（按钮与面板优先）

- [x] F001 状态栏组件：姓名/等级/猎人等级/章节 + HP/MP 进度条 + 五项属性 + 金币，数据取自 `/game/api/saves/:id` ✅ (2026-11-15 opencode)
- [x] F002 操作按钮组骨架：行动组（探索前进/环顾四周/潜行/休息）、系统组（背包/技能/属性/地图/任务/存档），点击调用 `/game/api/action` ✅ (2026-11-15 opencode)
- [x] F003 `POST /game/api/action` 通用动作端点（白名单校验 + 写 log + 返回叙述与状态增量） ✅ (2026-11-15 opencode)
- [x] F004 背包面板：分类标签（武器/防具/消耗品/材料）、稀有度配色、使用/装备/丢弃按钮 ✅ (2026-11-15 opencode)
- [x] F005 技能面板：已学技能列表、MP 消耗、冷却态灰显、点击释放 ✅ (2026-11-15 devin)
- [x] F006 属性面板：五项属性、剩余自由属性点、加点按钮、经验条显示到下一级 ✅ (2026-11-15 devin)
- [x] F007 地图/章节面板：8 章列表、场景节点、当前位置高亮、未解锁灰显 ✅ (2026-11-15 opencode)
- [x] F008 任务面板：主线 + 每日任务、进度条、奖励预览、每日任务惩罚倒计时 ✅ (2026-11-15 devin)
- [x] F009 战斗面板：双方血条、回合数、伤害飘字、行动按钮（攻击/技能/防御/道具/逃跑） ✅ (2026-11-15 devin)
- [x] F010 日志分栏样式：系统播报（蓝框）、旁白、玩家动作、AI 叙述四类视觉区分 ✅ (2026-11-15 opencode)
- [x] F011 移动端适配：底部固定操作栏、侧栏改抽屉、按钮触控尺寸 ≥44px ✅ (2026-11-15 opencode)
- [x] F012 键盘快捷键：数字键 1-9 映射按钮、Enter 发送、Esc 关面板 ✅ (2026-11-15 opencode)

## M2 AI 接入

- [x] F020 服务端 AI 网关模块：调用 OpenCode Go `deepseek-v4.1-flash`，key 读 `OPENCODE_GO_API_KEY`，带 `x-opencode-session` ✅ (2026-11-15 opencode)
- [x] F021 `/game/api/ai-action` 端点：自由输入 → AI JSON → 白名单校验 → 引擎执行 → 叙述返回 ✅ (2026-11-15 cron)
  verify: node scripts/assert/ai-action.mjs
  risk: med
- [x] F022 防幻觉校验层：intent 白名单、数值按引擎为准、HP/MP 夹紧、超时 20s 降级 ✅ (2026-11-15 opencode)
- [x] F023 上下文压缩：只发状态摘要 + 最近 6 条日志，控制 token ✅ (2026-11-15 opencode)
- [x] F024 AI 失败兜底：规则解析器（关键词匹配）保证不卡死 ✅ (2026-11-15 cron)
  verify: node scripts/assert/ai-fallback.mjs
  risk: med

## M3 战斗引擎

- [x] F030 `engine/combat.js`：纯函数 resolveTurn(state, action, seed)，确定性可复现（项目无 TS 构建，落地为 CommonJS） ✅ (2026-11-15 devin)
- [x] F031 属性影响公式：力量/敏捷/体力/智力/感知各自作用，命中/暴击/闪避 ✅ (2026-11-15 opencode)
- [x] F032 掉落表 JSON + 稀有度权重 + 金币掉落 ✅ (2026-11-15 opencode)
- [x] F033 经验曲线与升级（含属性点发放） ✅ (2026-11-15 devin)
- [x] F034 猎人等级压制系数（E..S 跨级惩罚）：`rankFactor(attackerRank, defenderRank)`，同级 1、攻方每高 1 级 +5%（上限 1.15）、每低 1 级 -10%（下限 0.55）、未知 rank 回退 1
- [x] F035 战斗模拟脚本 `npm run sim`：跑 N 次输出胜率/平均回合 ✅ (2026-11-15 devin)
- [x] F036 单测：战斗边界（0 HP、满血、闪避、暴击） ✅ (2026-11-15 devin)

## M4 剧情 Ch1–Ch3

- [x] F040 章节/场景数据模型与加载器（JSON 驱动） ✅ (2026-11-15 opencode)
- [x] F041 Ch1 双地下城：石像、命令之律、濒死觉醒 ✅ (2026-11-15 devin)
- [x] F042 Ch2 每日任务 + 惩罚副本 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 2 "每日任务|惩罚"
  risk: low
- [x] F043 Ch3 猎人协会评级 + 车海印初遇 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 3 "评级|车海印"
  risk: low

## M5 影子系统

- [x] F050 影子提取（Arise）：击败敌人后可提取，按等级决定成功率 ✅ (2026-11-15 opencode)
- [x] F051 影子编队与出战（最多 N 个） ✅ (2026-11-15 devin)
  verify: node scripts/assert/shadow-formation.mjs
  risk: med
- [x] F052 影子成长（等级、技能继承） ✅ (2026-11-15 cron)
  verify: node scripts/assert/shadow-growth.mjs
  risk: med

## M6 剧情 Ch4–Ch7

- [x] F060 Ch4 地下城突袭 + 蓝色毒蛇王 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 4 "毒蛇"
  risk: low
- [x] F061 Ch5 转职任务 + 暗影君主 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 5 "转职|暗影君主"
  risk: low
- [x] F062 Ch6 红门 + 冰精灵女王 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 6 "红门|冰精灵"
  risk: low
- [x] F063 Ch7 恶魔城 + 恶魔城城主 ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 7 "恶魔城"
  risk: low

## M7 终章

- [x] F070 Ch8 济州岛 + 蚁王 Beru 多阶段 Boss ✅ (2026-11-15 cron)
  verify: node scripts/assert/chapter.mjs 8 "蚁王|Beru"
  risk: low
- [x] F071 结局文本与通关统计 ✅ (2026-11-15 cron)
  verify: node scripts/assert/ending.mjs
  risk: low

## 运维

- [x] F080 `scripts/ci-deploy.sh` 部署闸门（build → smoke → restart → 复检） ✅ (2026-11-15 devin)
- [x] F081 `scripts/rollback.sh` 失败回滚 ✅ (2026-11-15 devin)
- [x] F082 部署锁 `.deploy.lock` 防并发部署 ✅ (2026-11-15 devin)

## 后续（本轮审查产出，待实现）

- [x] F072 影子成长接入五项属性：growth 的 perLevel 现用 atk/def/hp，而引擎 STAT_KEYS 是 strength/agility/vitality/intelligence/perception，sanitizeStats 会全部丢弃；改为五项属性并给出 stats→combat 映射，附 `npm run sim` 对比数据 ✅ (2026-11-15 devin)
  verify: node scripts/assert/shadow-attr.mjs
  risk: med
- [x] F073 真实通关结算：ch8 的 stats 目前是 sample 占位，改为结算时由存档填充（等级/击杀/影子数/耗时）+ 前端结算面板渲染，并让 ending.mjs 断言 sample 标记被移除 ✅ (2026-11-15 devin)
  verify: node scripts/assert/ending-stats.mjs
  risk: med
- [x] F025 `/ai-action` 加固：剥离 AI 返回的 ```json 围栏、AI 返回后重读存档避免陈旧快照覆盖 HP/MP、补 `server/ai/fallback.test.js` 与端点单测 ✅ (2026-11-15 cron)
  verify: node --test server/ai/fallback.test.js
  risk: low
- [x] F074 场景节点运行时：把 `server/data/chapters.json` 的 `scenes[]`/`choices{next}` 接进 action 端点，`advance` 推进并落盘 `sceneIndex`，删掉 `server/index.js` 里写死的「踩着碎石向那扇石门挪去」模板 ✅ (2026-11-15 cron; 沿 next_scene 主线链推进真实场景文本，模板已删；审查两轮 REJECT→修复后复核 APPROVE：链序不倒流、双源一致、观察只读)
  verify: node scripts/assert/scene-advance.mjs
  risk: high
- [x] F075 章节门按主线链结算：主线进度由 `next_scene` 链上的实际到达场景驱动（ch1 主线 7 景），走到链尾即结算章节门；面板展示「需完成第N章主线 x/y」与 `chapter_unlock` 解锁条件（等级软门 `level_ok` 必须显性播报，禁止静默放行）✅ (2026-11-15 cron; 章节门按链长结算，`chapter_unlock.level_ok/hint` 已暴露并在播报里写明「等级未达 Lv.N」；TODO(F093) 待 F082 升级闭环后改硬门。面板交互见 F090/F091)
  verify: node scripts/assert/chapter-gate.mjs
  risk: high
- [x] F076 战斗面板按战斗态挂载：非战斗不渲染 `section.combat`，攻击/技能/防御/道具/逃跑 在无敌人时 disabled + 明确提示，消除「未知的敌人 Lv.?? HP ??/??」占位 ✅ (2026-11-15 cron; 交战判定改为「遭遇X / 第N回合」单源，END 边沿收束，空态「当前没有交战目标」；审查两轮 REJECT→修复后独立复核通过)
  verify: node scripts/assert/combat-gate.mjs
  risk: med
- [x] F077 死亡与复活闭环：去掉 `clamp(save.hp - 3, 1, max_hp)` 的 1 下限，HP≤0 进入死亡/复活（或第1章濒死觉醒）分支并写日志，HP 已到底时不再输出「HP 1→1」这类虚构消耗文案 ✅ (2026-11-15 cron; HP 降到 0 走死亡→回溯（回本章起点、半血半蓝、deaths+1），不再输出「HP 1→1」；第 1 章首死触发濒死觉醒剧情 +1 级补偿；实测 Lv1 纯攻击仍会战死，但正常打法 21 动作通第 1 章零死亡）
  verify: node scripts/assert/death.mjs
  risk: high
- [ ] F078 AI 降级显性化与意图修正：`degraded:true` 时改走完整规则分支（攻击→combat、观察→observe、前进→advance）而非占位句，前端常驻「叙事引擎降级」横幅，禁止把含「走/进入」的攻击描述判成 advance
  verify: curl -sf -X POST https://openfolio.uk/game/api/ai-action -H 'content-type: application/json' -d '{"save_id":1,"input":"我挥刀砍向石像"}' | jq -e '.intent == "attack"'
  risk: high
- [x] F079 面板收尾细节：锁定技能的「释放」按钮 disabled + `aria-disabled` 并提示「需 Lv.N」，`.side-scroll` 滚到底时最后一张卡片与容器底边留白 ≥12px，移动端抽屉 ≥95% 宽且底部提示不再是「ESC 关闭」 ✅ (2026-11-15 cron; 390px 实测 96vw + 「点 × 关闭」；审查指出 641–880px 仍是 320px 抽屉且写 ESC，作为后续小项)
  verify: node scripts/assert/panel-affordance.mjs
  risk: low

## 本轮（2026-11-15 15:4x）实测新增：假进度与死资源
- [x] F080 任务进度与输入正则解耦：`settleDailyQuests` 不得从玩家输入文本 `detectEvents` 里推 kill/skill 事件，击杀/技能事件只能由真实结算产出；无敌人时空挥「攻击」不推进「今日狩猎」，未接线的技能不得推进「力量校准」 ✅ (2026-11-15 devin; settleDailyQuests 只消费 applyOutcome 的真实结算 events，detectEvents 不再被路由调用；实测空挥 3 次 kills=0/进度 0，真实击杀恰好 +1 不重复计数，「释放技能 不存在技能」被拒且不推进)
  verify: node scripts/assert/quest-settlement.mjs
  risk: med
- [x] F081 技能释放真实结算：`释放技能 X` 接 `engine/combat.js` 的 `SKILLS`（mp_cost/cooldown/power），扣 MP、进冷却、产生伤害与日志；MP 不足或未解锁时按钮 disabled + 提示「MP 不足 / 等级不足」 ✅ (2026-11-15 devin)
  verify: node scripts/assert/skill-release.mjs
  risk: med
- [x] F082 XP 达标即升级：任务/战斗奖励后统一调用 `progression.applyXp` 并落库 `level/free_points/max_hp/max_mp` 且播报升级；首日存在 ≥70 XP 的可玩来源（当前首日上限 60 < 70，Lv.2 永不可达） ✅ (2026-11-15 cron; 每日/战斗/主线奖励统一走 grantRewards→progression.applyXp，跨级循环、60 级封顶，主线奖励按章节去重入账；实测新档 21 动作 Lv.1→Lv.3、首日可升 Lv.2)
  verify: node scripts/assert/level-up.mjs
  risk: high
- [x] F083 属性面板/状态栏显示含装备加成的「攻击 / 防御」，与背包合计一致 ✅ (2026-11-15 cron; 顶栏+属性面板「战斗数值」基础/装备/合计三列，360–414px 数字不换行 header 133px；审查两轮 REJECT(390px 换行)→修复后通过)
  verify: node scripts/assert/atk-def-visible.mjs
  risk: low
- [x] F084 日志可回溯：前端不再固定只取最近 50 条，提供「加载更早」分页（服务端 limit 已支持 200） ✅ (2026-11-17 cron devin swe-2-high; 日志窗口 50→100→150→200 逐级翻页（`getLog(limit+1)` 探测更早），`.log-earlier-btn` 在 `.stage-col` 外不污染行数口径，到底「已到最初」disabled 不再请求、保留滚动位置)
  verify: node scripts/assert/log-paging.mjs
  risk: low
- [x] F085 移动端系统按钮 2 行网格：390px 下「战斗 / 存档」不得默认落在视口外，或保留横滚但给可见渐隐/箭头提示 ✅ (2026-11-15 cron; ≤880px 系统按钮改 2 行网格，390/360px 下「战斗/存档」等全在视口内可点；E2E mobile-actions 断言视口内或可滚动)
  verify: node scripts/assert/mobile-actions.mjs
  risk: low
- [x] F086 休息的代价与文案真实性：满 HP/MP 时「休息」禁用或提示，日志不得写「恢复 HP 100→100」；休息需有时间推进/遇敌判定或每日次数限制 ✅ (2026-11-15 devin; 每章 3 次配额 rest_used 跨章归零 + 休息推进时间按场景遭遇表掷遇敌，满状态/次数耗尽诚实拒绝且 saveView 暴露 rest.{available,remaining,reason}，前端按钮 disabled+剩余次数角标)
  verify: node scripts/assert/rest-cost.mjs
  risk: med
- [x] F087 E2E 稳定性加固：`panels.mjs` 在部署后首次运行时偶发 `locator.innerText` 20s 超时（截图显示页面其实已渲染完成，疑为 restart 后首帧/负载竞态）——加显式「抽屉可见 + 目标元素 settle」等待与一次重试，避免单次 flake 阻断部署闸门 ✅ (2026-11-15 cron 复验：`verify.sh F087` 三连跑 run-all 全绿)
  verify: node scripts/e2e/run-all.mjs && node scripts/e2e/run-all.mjs && node scripts/e2e/run-all.mjs
  risk: low

## 本轮（2026-11-15 18:0x）实测新增：成长/战斗链未接线（第 3 轮线上试玩）
- [x] F088 遭遇与战斗结算接线：`/action` 目前从不产出「遭遇X / 第N回合」，`engine/combat.js` 未接入 action 端点，玩家 44 次动作零遇敌；需按场景/随机表触发遭遇 → 回合结算 → 击杀记 kills/掉落/XP，并让战斗面板有真实敌人 HP ✅ (2026-11-15 cron; 新增 engine/encounter.js 遭遇表 + combat 表持久化交战，/action 接 engine/combat.js 回合结算「第N回合」、击杀计 kills/掉落/XP，任务进度只认真实结算事件；审查抓到的同场景无限刷怪、战斗中休息免回合、道具药效错配已修)
  verify: node scripts/assert/encounter-combat.mjs
  risk: high
- [x] F089 终章收束：抵达 `ch8_epilogue` 后再点「前进」仍扣 3 HP 并连续写 6 条逐字相同的「此处已是故事的终章，再无前路」，且不引导结算；改为拒绝推进 + 一次性结算入口，体力不再扣 ✅ (2026-11-15; /action 与 /ai-action 入口短路：终章态「前进」不写日志不扣 HP/MP，回包带 save.at_epilogue/ending_ready 与一次性结算指引；前端「探索前进」改写为「查看结算」+ 主视图一次性终章横幅；assert/ending-closure.mjs 覆盖 3 连点零消耗零日志、结算幂等、未通关 409)
  verify: node scripts/assert/ending-closure.mjs
  risk: low
- [x] F090 地图面板可交互：8 个章节节点仍是静态 `<li>`（无按钮、无 onClick），锁定节点只写「未解锁」不写前置条件（等级/主线进度）；补回看已踏破章节 + 锁定原因 + 可达性 ✅ (2026-11-15 cron; 新增 GET /api/chapters（不含逐景全文）+ MapPanel，8 章节点为 button、可回看已踏破章节、锁定写明等级与主线前置；E2E map-interactive 连跑稳定)
  verify: node scripts/assert/map-interactive.mjs
  risk: med
- [x] F091 顶栏章内进度与主线状态：顶栏只有章名没有 `N/N`，玩到第 8 章无法判断还差几景；任务面板终章 `5/5` 仍标「进行中」永不翻「已达成」；补 `chapter_progress` 展示 + `cleared` 时主线状态收束（沿用 F074 已暴露的 `chapter_steps/chapter_total`） ✅ (2026-11-15 cron; 顶栏「第N章 · 章名 · x/y」取 chapter_steps/chapter_total，360–414px 不裁切；主线到达终局场景时任务状态翻「已达成」)
  verify: node scripts/assert/chapter-progress-ui.mjs
  risk: low
- [x] F092 动作文案与章节匹配：第 8 章济州岛「潜行」仍返回「石像的目光」等第 1 章文案；「观察」是整段场景复读。按章节/场景给动作叙述分层，观察改为场景内的短句观察而非全文重播 ✅ (2026-11-15 cron devin; 新增 `server/engine/prose.js` 8 章文本池，缺章回落无石殿意象的 GENERIC 池；观察改为 `scene_title + 本章短句`（<120 字、按本档观察行数轮转、同场景连点必不同文），潜行/休息/非战斗攻击·防御·道具·逃跑按章取池；`chapter-gate.mjs` 的 `observeFree()` 改成 F101 口径并补「整幕复读」变异断言；新断言 `action-prose-by-chapter.mjs` 覆盖 ch1≠ch8 潜行、ch8 无石殿词、观察免费短句；实测线上观察 58/57 字两条互异)
  verify: node scripts/assert/action-prose-by-chapter.mjs
  risk: med
- [ ] F093（人工确认）章节等级门改回硬门：本轮把 `unlock.level` 实现为软门（`level_ok:false` 仍放行，播报提示「等级未达」），因为 `applyXp` 无调用点（F082）时硬门会让 Lv1 永久卡在第 1 章；F082 升级闭环落地后应改回 AND 并在 `unlockedFor` 去掉 `TODO(F088/F093)`
  verify: node scripts/assert/chapter-level-gate.mjs
  risk: high


## 第 4 轮试玩新增（2026-11-15 18:5x）
- [x] F094 战斗操作入口：行动栏（含移动端）直接给出「攻击 / 释放技能 / 防御 / 逃跑」，无敌人时按钮 disabled + 「当前没有可攻击的目标」；交战时「休息 / 潜行 / 存档 / 状态」必须明确拒绝或占回合，禁止「交战中免费回血」；技能按钮显示 `MP 消耗 / 冷却` 并按所选技能真实扣除 ✅ (2026-11-15 cron; verify combat-actions-ui.mjs 绿，行为早前已落地)
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: med
- [x] F095 （阻断）第 1 章守关者死路：Lv.1 玩家 atk≈10、HP100，而 ch1 boss「石像守卫」按 Lv.5 生成（HP130、每回合打出 18–28），必败 → 回溯 → 再战无限死亡循环（线上实测连死 4 次仍 Lv.1）；须按章节期望等级重做遭遇缩放，让 Lv.1–2 + 新手装备在 ≤12 动作内打得过 ch1 守关者，ch1 首死触发濒死觉醒补偿，逃跑能真正脱离 boss 房 ✅ (2026-11-15 cron; 遭遇按章节期望等级重做缩放：ch1 守关者 HP130→75、单回合 18→13，Lv1–2 带药可打赢；首死濒死觉醒 +1 级，逃跑可真正撤回上一场景且 boss 房冷却 2 步；实测 21 动作通第 1 章 Lv.3 零死亡)
  verify: node scripts/assert/ch1-boss-beatable.mjs
  risk: high

## 第 5 轮试玩新增（2026-11-15 21:0x，A/B 双档实测）
- [x] F096 （阻断）章节门必须校验守关者击杀：当前 8 章守关者全部可被「前进」逃跑绕过——交战中「前进」=撤离骰，逃跑成功同一次点击即推进主线（实测 Lv.1/0 击杀/8 次死亡/63 次前进直达终章 `cleared:true`）。要求：`chapter` 推进 join 结算事件（`boss_cleared[chapter]` 为真才通章），交战中「前进」改文案为「撤离」且禁止同响应推进场景/主线，未击杀守关者时「前进」最多退回本景 ✅ (2026-11-15 devin; 章节门在 `unlockedFor` 之后追加 `bossRequirementMet` 硬门槛，未击杀时正文点名守关者（「必须击败「石像守卫」才能通过（当前进度 7/7）」）；交战「前进」改为 `retreatOnFlee` 撤离结算、**不再调用 advanceOutcome**，成功只脱离交战（守关战撤回上一主线场景 + F095 冷却），前端交战态按钮改标「撤离」并写「撤离不会推进主线」；收尾补丁：两条门拒绝分支零消耗零日志（`refused` 短路），否则章尾连点会原地耗死（实测 HP 100→33→死亡回溯）；新断言 `chapter-boss-gate.mjs` 覆盖纯前进不通章/交战不推进/击杀后放行 + 变异敏感，`chapter-gate.mjs` 终章段改为 DB 落点（真打需 ~1.2 万动作，已在文件头写明预算约束）；`encounter-combat.mjs` 道具段 setup 去竞态，连跑 6 次稳定；二次收尾（2026-11-15 devin）：线上死路——撤离后负冷却内连点「前进」可穿过 boss 房到章尾，守关者未击杀而章尾只拒绝、回不了守关房 → 永久卡死（线上 save 550 复现）。补丁：守关者未击杀时玩家位置不得越过 boss 场景（房内「前进」被出口封回上一景；越线落点/链尾「前进」改折返回守关房、`encounter_clock=0` + `forceBoss` 落地真打，`saveView.advance_mode` 下发前端换标「折返守关者」）；`chapter-boss-gate.mjs` 重写并补 (f)(g) 变异敏感，(f)/(d) 用 DB 落点复刻旧档状态（新口径下真实路径已不可达，文件头注明）；`encounter-combat` B 段同因改 DB 落点，连跑 3 次稳定)
  verify: node scripts/assert/chapter-boss-gate.mjs
  risk: high
- [ ] F097 （阻断）遭遇/守关者等级按玩家等级带宽缩放：ch2 守关者 200HP / 18 伤害、ch7「地狱之犬 Lv.19 HP185」对 Lv.3 玩家每回合打 4 点挨 44 点 → 必死循环。要求：遭遇与守关者等级钳制到 `player.level ± 2`（或与章节 `expected_level` 取小），`expected_level` 写入 `chapters.json` 并做 CI 断言；ch2 守关者应让 Lv.1–2 在 ≤12 回合内可赢
  verify: node scripts/assert/encounter-level-band.mjs
  risk: high
- [x] F098 死亡回溯不清空章节主线进度：死亡后 `chapter_progress` 从 3/3 打回 1/3 且无确认，叠加等级墙形成零收益循环。要求回溯保留已到达的最远 scene（或给保底 XP），并在播报里说明保留了哪些里程碑 ✅ (2026-11-15 cron devin; 新增持久列 `main_steps` 作「本章主线高水位」，`sceneView`/`/chapters` 取 `max(当前位置, 高水位)`，回溯落点仍回入口但水位不清；首死一次性 +30 XP（与 ch1 濒死觉醒叠加属预期，重复死亡不补），播报写明保留的里程碑；老存档水位从下次推进开始记录、不回填；新断言 `death-progress-keep.mjs` 覆盖计数不退/保底一次性/文案不矛盾/`deaths`+1)
  verify: node scripts/assert/death-progress-keep.mjs
  risk: med
- [x] F099 技能面板显示引擎算出的预计伤害区间：面板写「威力 24」而实战仅 1 点伤害（差 24 倍），玩家按面板决策必然误判。改为服务端下发 damage_preview（min–max），面板与战斗日志同源 ✅ (2026-11-16 cron devin; combat.js 抽出 `computeDamage`/`damageRange`，`strike`/`resolveTurn` 与 preview 同源；index.js 技能视图下发 `damage_preview{min,max}`；SkillsPanel/CombatPanel/App.tsx 全部改「预计伤害 min–max」，无裸「威力」；实测 tiger_fury power24 → 26–49，30 次实放全落区间)
  verify: node scripts/assert/skill-damage-preview.mjs
  risk: med
- [x] F100 quest-settlement 断言补强：「无敌人时释放技能 猛虎猛击」不得推进每日「力量校准」（现有 (c) 只覆盖不存在的技能名，变异测试可通过 → 假绿）
  verify: node scripts/assert/quest-settlement.mjs
  risk: low

## 第 6 轮试玩新增（2026-11-15 22:1x，独立审查；F096 已修）
- [x] F101 断言口径反向锁定缺陷：`chapter-gate.mjs` 的 `observeFree()` 断言「观察回复必须包含场景正文前 12 字」——等于把 F092 的「整幕复读」写成绿线；同理原「第 8 推过门进第 2 章」把软门+可绕过写成期望值（本轮已随 F096 改口径）。要求：观察断言改为「两次观察文本互不相同且 < 120 字、标题取 scene_title 而非敌人名」，并补一条负向断言（复读整幕时 FAIL） ✅ (2026-11-17 cron devin swe-2-high; `observeFree()` 补两条观察互不相同、各 <120 字、标题念 scene_title 且不得念敌人名、负向三连（含正文前 12 字 / 是正文逐字前缀 / ≥正文 50%）；新建 observe-short.mjs（3 次观察两两不同 + 非正文前缀，期望值从 chapters.json 独立推导），pre-F092 旧码红证成立，连跑 3 次全绿)
  verify: node scripts/assert/observe-short.mjs
  risk: med
- [ ] F102 章节解锁口径三处不一致：地图 Ch.8 写死「需 Lv.70」、`chapter_unlock.level` 回包是 40、`chapters.json` 的 `unlock.level` 又是第三个值；玩家看到「锁定 · 需 Lv.70」却能直接走进去（F093 软门）。要求：地图/回包/数据单一事实源（`/api/chapters` 下发 `unlock.level` 与 `unlocked/blocked_reason`），前端不再写死数字；软门期间锁定态与「已开启」播报不得并存
  verify: node scripts/assert/chapter-unlock-single-source.mjs
  risk: med
- [x] F103 死亡回包自相矛盾：`你倒下了，战斗结束。` 紧跟 `【战斗】撤离失败，X 仍堵在面前——你寸步未移。`（交战中「前进」致死分支仍拼撤离失败文案）。要求：死亡即收束，不得再拼回合/撤离失败句；五条死亡日志统一形态 ✅ (2026-11-16 cron devin; `advanceWithEncounter` 对 `hp<=0` 直接返回死亡结算、`combatTurn` 致死回合清空战报，settleDeath 播报成唯一收尾；`death.mjs` 驱动改「交战中前进→撤离掷逃反击致死」并加负向词表（撤离失败/仍堵在面前/寸步未移），隔离实例 3 连跑全绿、stash 服务端修复后红证指向「撤离失败」)
  verify: node scripts/assert/death.mjs
  risk: low
- [x] F104 通关页残留开发备注：结算面板写「注：战斗统计未接入，总击杀暂记「—」。」，而 `stats.kills` 有真实值。要求：删除该备注，`总击杀` 与存档 kills 同源渲染
  verify: node scripts/assert/ending-stats.mjs
  risk: low
- [x] F105 验收脚本自身的可复现性：`ending-closure.mjs` 把默认端点写死 `127.0.0.1:3089`（隔离实例），导致 `scripts/report.sh` 里 F089 永远 FAIL（其它断言默认 3020）；`map-interactive.mjs` 在 report 顺序跑时偶发 20s+ 超时（本轮 report 记 FAIL，单独连跑 3 次全绿）。要求：统一默认端点为 `_http.mjs` 的 3020（仍允许 API_BASE 覆盖），并给 Playwright 断言加 settle 等待 + 一次重试
  verify: node scripts/assert/map-interactive.mjs && node scripts/assert/ending-closure.mjs
  risk: low

## 第 7 轮试玩新增（2026-11-15 23:1x，cron；F092/F098 同轮已合并）
- [x] F106 （阻断）门拒绝分支仍在扣资源：ch1 守关者未击杀时点「前进」回包 `【主线】「石像守卫」的威压仍封着出口——你无法越过守关者，只能退回「敬拜」。（体力消耗 HP 78→75 · MP 1→0）`——无位移、无推进却照扣 3 HP / 2 MP 并写消耗日志，连点可原地耗死（与 F096 声称的 refused 零消耗矛盾）。要求：所有「门未开 / 体力不足 / MP 不足」拒绝一律 `refused:true` 短路（零 HP/MP/scene/log 变更），并下发 `advance_mode` 把主按钮改写成「折返守关者」；新增 `gate-refusal-free.mjs` 覆盖守关者门、章节等级门、终章门三处 ✅ (2026-11-16 cron; 所有门拒绝 refused 零消耗 + advance_mode 换标；审查发现房内软锁另立 F121)
  verify: node scripts/assert/gate-refusal-free.mjs
  risk: med
- [x] F107 交战期装备/加点免费：**行为已由 F094 修**（实测线上交战中背包「装备」disabled + `title="交战中无法更换装备"`、面板下方提示「交战中无法使用或更换装备——补给请走战斗「道具」指令（占一回合）」），**仍缺断言**：`combat-actions-ui.mjs` 未覆盖 equip/spend。要求补 `combat-equip-gate.mjs`：交战中 `POST /item op=equip` 与 `/spend` 必须被拒且零回合零属性变化，非交战放行 ✅ (2026-11-15 cron; 新增断言 combat-equip-gate.mjs，变异验证敏感)
  verify: node scripts/assert/combat-equip-gate.mjs
  risk: low
- [x] F108 页脚固定文案写成「面板 5–0」（应为 5–9，0 无快捷键）：改成 `面板 5–9` 或按视口只显示「5–9 / ESC」 ✅ (2026-11-16 cron; 断言 `panel-affordance.mjs` 绿)
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [x] F109 行动栏「休息」角标与快捷键并排读作「休息 3 4」（`rest-count` + `<kbd>4</kbd>`），与旁边「潜行 3」混淆：角标带单位（`剩 3`）或改 `3/3` 徽标并与 kbd 视觉分离
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [x] F110 「防御」回合无防御叙述：日志只有 `第3回合 · 地下城狼的反击偏离了目标，没有命中你。`，玩家看不到自己做了什么；补「横刀格挡」类叙述并从引擎取减伤数值 ✅ (2026-11-17 cron devin swe-2-medium; `resolveTurn` 在事件流里先占位 `type:"damage", side:"player"` 事件、敌方结算后回填文案：命中 `横刀格挡/矮身卸力/以臂甲架住来势` 三选一 + `（你只受 N 点，减免 M）`，N/M 取自真实 `computeDamage`（减免 = mult=1 同 crit 重算 − 实承）；未命中也有玩家侧叙述（三变体）；措辞的 `rng.int` 抽在 `strike` 之后 → 既有固定 seed 断言零改动；`DEFEND_MULT` 与其它动作事件流未动，200/200 单测全绿)
  verify: node scripts/assert/defend-narration.mjs
  risk: low
- [x] F111 技能面板伤害与引擎同源（替代/合并 F099）：面板 `威力 24` 而实战命中 `造成 31 点伤害`，玩家按面板估伤害必然误判。服务端下发 `damage_preview {min,max}`（含暴击与力量系数），面板与战斗日志同一函数 ✅ (2026-11-16 cron devin; 与 F099 同一实现，见 F099 备注)
  verify: node scripts/assert/skill-damage-preview.mjs
  risk: med
- [x] F112 断言可复现性（F105 追加）：`chapter-progress-ui.mjs`（F091 的 verify）连续 3 次 FAIL——「did not reach epilogue within the landing budget」，23:08 报告起就是红的，属断言驱动方式问题（靠 N 次 UI 动作走到终章，现在有守关者门后不可达）。要求改 DB 落点构造终章前存档再走 1-2 步 UI，或直接断言顶栏 `x/y` 与 panel 数据一致（仍保留一次真实 UI 断言） ✅ (2026-11-16 cron devin; 改 DB 落点构造终章前存档 + 1 步 UI，保留顶栏/API 一致性硬断言；5 连跑全绿，变异测试改坏 chapter_progress 立即红)
  verify: node scripts/assert/chapter-progress-ui.mjs && node scripts/assert/chapter-progress-ui.mjs
  risk: low
- [x] F113 移动端底部操作区被战斗组撑高：F094 落地后非交战态也渲染 4 个 disabled 战斗键，390×844 下 footer 由 285px → **361px（占屏 43%）**，行动组挤成「探索前进/环顾四周/潜行/休息/攻击」5 键一行（每键 ≈62px 宽，小于四字标签的舒适宽度），叙事区只剩 ~360px。要求：非交战态把战斗组折叠成单行矮提示（或只在「战斗」二级入口里给出），交战时再展开四键；390px 下行动组最多 4 键一行。注意 F094 的断言 `combat-actions-ui.mjs` 第 (a) 段要求非交战四键 disabled 可见，改布局时同步改断言（改为「入口存在且 disabled」而不是「四个按钮常驻」）✅ (2026-11-16 cron devin; 非交战态折叠为单行 `.combat-entry`（disabled + 「当前没有可攻击的目标」），交战时展开四键；390×844 实测 footer 361→**181px(21.4%)**、正文 **528px(62.6%)**、行动组 4 键/行、每键 86px；系统组与战斗入口共享 meta 行横向滚动，1280 三栏不退化；(e) 段补 footer ≤30%/正文 ≥60%/按钮 ≥72px 预算)
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: low

## 第 8 轮试玩新增（2026-11-15 23:5x，cron；独立审查，47 次真实点击）
- [x] F114 （阻断）死亡回溯把 `save.scene` 退回第 2 幕（ch1_law, scene_index=1），`chapter_steps` 仍保留 4/7 → 之后每次「前进」整幕复读、进度不动却照扣 HP/MP（实测 HP 84→81→152→149），地图「当前」与正在上演的守关战不一致。要求：进度由 `scene` 单点推导（`chapter_steps = pathIndex+1`）或回溯时场景与步数同步回退且不重复计费；播报的落点必须与 `save.scene` 一致 ✅ (2026-11-16 cron; chapter_steps 由 scene 单点推导、回溯退两幕且播报取真实落点、无位移零消耗)
  verify: node scripts/assert/death-respawn-consistency.mjs
  risk: med
- [x] F115 「回到地面/医院」场景 `ch1_surface` 仍刷地下城遭遇（石像残兵 Lv.2 HP 52/52 强制交战），叙事穿帮。要求：遭遇表按 `scene.kind` 分区或给场景 `no_encounter` 标记 ✅ (2026-11-16 cron devin; chapters.json 场景加 `encounters:"none"`（10 个现实场景），encounter.js 在 `roll()` 唯一漏斗短路，chapters.js 加载期白名单校验（含 boss 场景禁止标 none）；断言改成 none 集合快照 + 逐场景 roll 矩阵，删掉自指分支（变异测试：删任一标记 → FAIL）)
  verify: node scripts/assert/encounter-scene-kind.mjs
  risk: med
- [x] F116 （= F093 复测未过）地图 Ch.2 写「锁定 · 需 Lv.5」，Lv.4 玩家点前进即进第 2 章（OR 软门 `level_ok || chapter_ok`）。要求：`unlockedFor` 改回 AND 硬门，或地图文案改「推荐 Lv.5 · 可强行进入（受压制）」，锁定态与放行不得并存 ✅ (2026-11-16 cron devin; 取文案方案，门禁语义未动：`unlockView` 成为唯一出口，`/api/chapters` 与 `saveView.chapter_unlock` 下发 `state(open/soft/locked)` + `blocked_reasons`（只含未满足前置）+ hint；MapPanel 不再写死「需 Lv.X/需完成第X章主线」，软门显示「推荐 · 可强行进入（受压制）」；chapter-gate.mjs 原「软门放行即绿」口径改成状态一致性断言)
  verify: node scripts/assert/map-lock-consistency.mjs
  risk: med
- [x] F117 章末 7/7 无「进入下一章」入口，切章藏在又一次扣费的「前进」里。要求：7/7 时 `advance_mode` 改主按钮为「进入第2章 · 每日任务」且该次不再扣体力 ✅ (2026-11-16 cron devin; `advance_mode=next_chapter` 只在 idx===链尾 且非 retreat/challenge_boss 时下发，过门 `scripted` 不扣 HP/MP、不掷遭遇、不结算每日任务，回包附「本次没有消耗体力」；390px 下按钮两行不裁不撑高，footer 高度与 main 一致 361px)
  verify: node scripts/assert/chapter-end-cta.mjs
  risk: low
- [x] F118 AI 降级零提示：`/ai-action` 回 `degraded:true` 时前端无任何提示，正文是与「环顾四周」首句逐字相同的模板句。要求：降级时气泡尾加「（系统叙事降级：按规则解析）」，观察模板句按场景轮换 ≥3 句
  verify: node scripts/assert/degraded-banner.mjs
  risk: low
- [x] F119 （并入 F113）移动端 390×844 `footer.actions` 实测 y=483 h=361 = 视口 42.8%，17 个按钮三行堆叠，正文区仅 483px。要求同 F113：战斗组非交战态折叠为单行入口、系统组收进抽屉，正文区 ≥60% 视口 ✅ (2026-11-16 cron，随 F113 落地；实测 footer 181px(21.4%)、正文 528px(62.6%)，断言并入 `combat-actions-ui.mjs` (e) 段)
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: med
- [x] F120 「休息」连续两次正文拼接重复：「体力一点点回到四肢。体力与魔力一点点回流，…」。要求：休息叙述按回合轮换且不重复上一句 ✅ (2026-11-17 cron devin swe-2-high; 删除「体力与魔力一点点回流」拼接句，改为 `REST_TRAIL_LINES` 三条「只讲代价不讲恢复」的尾注，按 `rest_used` 轮换并**置于池句之前**（单条池句的章节两次休息前 12 字也必不同）；恢复量 `ceil(35% max_hp)`/`ceil(40% max_mp)`、配额、遇敌判定未动，`rest-cost` 回归绿)
  verify: node scripts/assert/rest-narration.mjs
  risk: low

## 第 8 轮验收后审查（2026-11-16 01:xx，cron）
- [x] F121 （阻断，F106 回归）守关房内「前进」改为零位移 refused 后玩家没有可点的下一步：`advanceMode` 已换标「折返守关者」但人就在房内，行动栏四键在无交战时全 `disabled`（`title="当前没有可攻击的目标"`），唯一出路是在自由输入框手打「攻击」（`peacefulCombatIntent` 的 bossChallenge）——等于软锁。可达路径：守关战「逃跑」成功（F095 逃生阀）+「前进」落回房内。要求：`advanceMode` 增 `challenge_boss` 语义，主按钮改「叫阵守关者」并真 dispatch「攻击」，或该态下解禁行动栏「攻击」；房内文案指向可点按钮；`gate-refusal-free.mjs` 删掉以 `next_choices.length>0` 充当「有出路」的假绿断言，新增 UI 级断言 `boss-room-escape-ui.mjs`（真点开战）；顺带修 `saveView` 不再下发遗留 `main_steps`、F107 断言在全新 scratch DB 上因 equipment.json 残留 id 误红 ✅ (2026-11-16 devin; `advanceMode` 在 idx===idxBoss 且无交战时下发 `challenge_boss`，主按钮换标「叫阵守关者」点击真 dispatch「攻击」、行动栏与战斗面板「攻击」同步解禁（`title="守关者就在面前 — 叫阵开战"`）、快捷键 1 同义；房内 refused 文案改指「叫阵守关者」；`saveView` 停发 `main_steps`；`gate-refusal-free.mjs` 正向改断 `challenge_boss`+逐次文案点名+真开打，`chapter-boss-gate.mjs` (g) 连点 4 次，`combat-equip-gate.mjs` setup 清 stale 装备位+精确增量口径；新断言 `boss-room-escape-ui.mjs` DB 落点 sealed 态→真点主按钮→断言敌名/回合)
  verify: node scripts/assert/boss-room-escape-ui.mjs && node scripts/assert/gate-refusal-free.mjs
  risk: med
- [x] F123 `ch1-boss-beatable.mjs`（F095 的 verify）有固有 RNG 抖动：本轮 9 连跑中 1 次报 `boss fight exceeded 12 actions`（12 动作预算边缘）。要求：把「≤12 动作打赢」改成「≤12 动作打到 HP 0 或换最优回合序列」，或把预算放宽到 16 并在断言里记录实际动作数分布（20 次采样），避免定时任务出现随机红 ✅ (2026-11-16 cron; 3 连跑全绿，verify 已含 3 次重复调用)
  verify: node scripts/assert/ch1-boss-beatable.mjs && node scripts/assert/ch1-boss-beatable.mjs && node scripts/assert/ch1-boss-beatable.mjs
  risk: low

## 第 9 轮试玩新增（2026-11-16 01:xx，cron；真实玩家 150 次点击）
- [x] F124 新档第一次「探索前进」= 原地落地 + 扣体力 + 掷遭遇：建档后顶栏已显示 1/7 但 `save.scene` 实为 null，首点播开场白全文却 `HP 100→97 · MP 20→18` + `【遭遇】石像残兵 Lv.3` + 每日任务「推进战线」完成，`chapter_progress` 仍 1/7；3 个新档全部复现。要求建档即写 `scene=ch1_double_gate`，或首点零消耗、不掷遭遇、不结算每日任务 ✅ (2026-11-16 cron devin; 建档写首幕 + `advanceOutcome` 对 `idx<0` 保留 scripted 自愈（零消耗/不掷怪/不结算），存量 `scene=null` 档实测自愈；断言直读 DB 列 `scene` 避免被 sceneView 自愈派生骗绿)
  verify: node scripts/assert/new-save-first-advance.mjs
  risk: low
- [x] F125 逃跑后重入守关房文案自相矛盾：逃跑成功撤回 3/7 → 再点前进进 4/7，回包是整段守关战开场白「巨像的拳落下来。你听见自己腿骨断裂的声音…」（还扣 `HP 88→85`），但 `combat=null`、`advance_mode=challenge_boss`；再叫阵写「你主动逼近满地残骸」而 `boss_cleared=[]`（守关者从未被击杀）。要求：再入 boss 房时零消耗、不复读开场战叙述，未击杀时不得出现「残骸」字样 ✅ (2026-11-16 cron devin; 再入 boss 房（守关者未倒下、冷却压住落地遭遇）剥掉该步 HP/MP 代价并换 2 句轮转的中性「重新回到守关房」播报；逃跑/叫阵文案去掉「残骸」（改动前 red 证指向「守关者的残骸在身后缓缓凝聚」）；新断言 `boss-room-reentry-prose.mjs` 覆盖零消耗/无开场战句/无残骸/可继续叫阵，隔离实例 2 连跑全绿)
  verify: node scripts/assert/boss-room-reentry-prose.mjs
  risk: low
- [x] F126 部署/验收脚本继承泄漏的环境变量导致假红与**误回滚**：本轮 `ci-deploy.sh` 第 8 步 E2E 因 shell 里残留的 `E2E_BASE_URL=http://127.0.0.1:3082/game` / `API_BASE=…:3082` 打到不存在的端口，5/5 全红 → 触发 `rollback.sh` 把 `client/src` 检出回旧 ref（服务端仍是新代码），线上变成「新后端 + 旧前端」的混合态，且工作区出现 staged 反向改动。要求：`ci-deploy.sh` 与 `rollback.sh` 开头 `unset E2E_BASE_URL API_BASE E2E_NO_CLEANUP SL_VERIFY_API_BASE`（或用 `env -u` 包住 node 调用）；`rollback.sh` 只回滚构建产物/重启，不得改写 `client/src` 工作区（改 `git checkout $REF -- client/src` 为备份+构建，或回滚后 `git reset --hard` 前先拒绝在有未提交改动时执行）；`map-interactive` 类断言若连不上端口应报「环境错」而不是「业务回归」 ✅ (2026-11-17 cron devin swe-2-high; ci-deploy.sh 与 rollback.sh 开头 unset E2E_BASE_URL/API_BASE/E2E_NO_CLEANUP/SL_VERIFY_API_BASE/DB_PATH，node 调用统一 `env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE`；rollback.sh 删除 `git checkout -- client/src`（改为拒绝在有未提交改动时执行 + 只回滚 dist 产物 + pm2 restart）；E2E 端口不通输出 ENV_ERROR 退 2 不触发回滚；`node --test scripts/e2e/ci-deploy-env.test.mjs` 6/6)
  verify: node --test scripts/e2e/ci-deploy-env.test.mjs
  risk: med
  - 2026-11-16 03:35 追加（升级为生产事故）：线上 pm2 进程带着 `DB_PATH=/tmp/mut.db` 跑了 1h45m，真实玩家存档全部写进 /tmp（已合并回 `data/game.db`，旧库留档 `.bak-20261116-033300`）。除 `unset` 外还要求：`ci-deploy.sh` 显式固定 `DB_PATH=/www/Solo-Leveling/data/game.db`（不依赖缺省值）；`/api/health` 回包带上 `db_path`，部署第 6 步断言其等于预期；`rollback.sh` 重启时同样固定 DB_PATH。
- [x] F127 `scripts/report.sh` 全表汇总存在系统性假红：2026-11-16 02:35 / 02:42 两份报告都报 31 项 FAIL（PASS 38/39），但把同样的 FID 逐条单跑与按报告顺序串行复跑（F110→F117）**全部 PASS**（F112 24.06s、F113 26.37s、F116 10.74s、F117 16.40s）。现象集中在 UI/Playwright 类断言的超时型失败，怀疑 report.sh 的 `vout="$(./scripts/verify.sh "$fid" | tail -1)"; rc=$?` 取到的是 tail 的状态、或串行跑时未给每个断言独立 settle 预算（前一条断言的浏览器/DB 残留未清）。要求：`rc` 改为 `set -o pipefail` 下的显式 `if ! out=$(...)` 判定并保留完整输出到报告；每条断言跑前清 `e2e-*/verify-*` 存档；对超时型失败重跑一次再判；报告里 FAIL 行必须附断言原始错误行（现在只有 `[VERIFY] X FAIL`，无从定位） ✅ (2026-11-17 cron devin swe-2-high; report.sh 改 `set -o pipefail` + `if ! out=$(...)` 取真 rc，每条断言前清 e2e-%/verify-% 六表残留，Timeout/ECONNREFUSED/ERR_DLOPEN 重跑一次再判，FAIL 行附 ≤300 字原始错误行，新增 REPORT_VERIFY_BIN/REPORT_SKIP_E2E/REPORT_RUNS_DIR 注入点；report-gate.mjs 桩 verify 全表 PASS 且旧码静态红证成立)
  verify: node scripts/assert/report-gate.mjs
  risk: med
  - 2026-11-16 03:50 追加：本条原先的 verify 写成 `bash scripts/report.sh && …`，而 report.sh 会遍历执行每条 verify → **无限递归**（本轮实测 fork 出 6 层 report.sh，单条断言卡死整轮报告）。要求：verify 一律不得调用 `report.sh`（改为独立断言脚本）；`report.sh` 自身加递归护栏（`REPORT_DEPTH` 或 `exec 9>` 互斥锁，重入直接退出）；跑 report 时把自身 FID 排除。

## 第 10 轮试玩新增（2026-11-16 03:30，cron；真人 500+ 动作 / 五面板 / 桌面+移动）
- [ ] F128 （阻断）第 2 章惩罚副本死亡循环：ch2 任意战斗中死亡 → 回溯到 ch2_daily_quest →「前进」唯一出口是 ch2_penalty_gate → 强制遭遇「惩罚副本·毒牙蛇 Lv.5 HP200 攻24 boss:true」，Lv.4（攻 16、伤害恒 9）需 ~20 回合、蛇每回合反击 18，玩家 ~9 回合必死；自动化实测 50+ 次循环无一脱出（deaths 3→53），且界面没有任何「撤离」提示（真正的撤离键是自由输入「前进」，按钮「逃跑」反而可能失败）。要求：战斗面板在惩罚副本给出可见目标（「存活至副本结束 N/M 回合」）与撤离指引；或让 Lv.4 在该副本有可行打法（药水/技能/等级带宽钳制，与 F097 合并考虑）；断言：脚本从死亡回溯点连续 12 次「前进」必须能离开 ch2_penalty_gate（到达别的场景或完成副本），不得 12 次都停在惩罚副本→毒牙蛇
  - 2026-11-16 08:05 第 15 轮真机复测追加：12 步「前进/叫阵/逃跑」全困在「惩罚副本 2/3 ↔ 毒牙蛇守门房 3/3」，自由输入「撤离副本」「回到第1章」均「系统未识别」，场景文本承诺「存活至副本结束」但无 N/M 计数；唯一活路（2/3 休息刷可击杀的惩罚沙虫 Lv.4）零指引，且 3/3 休息召来 Boss 本体 → 见 F138
  verify: node scripts/assert/ch2-penalty-escape.mjs
  risk: high
- [x] F129 未识别指令直出开发占位句：自由输入「任务」→「指令已接收：「任务」。命运之线仍在编织中……（叙事引擎尚未接入，此处为占位回应。输入「帮助」查看当前可用指令。）」。要求：删掉「叙事引擎尚未接入/占位回应」字样，改为不出戏的系统措辞（如「系统未识别该指令，可用：探索前进/环顾四周/…」），并把面板名（背包/技能/属性/地图/任务/存档）直接路由到对应面板而不是当未识别指令。断言：任意未识别输入的回包不含「占位」「尚未接入」「命运之线仍在编织」 ✅ (2026-11-16 cron devin swe-2-high; 兜底句改为「系统未识别该指令。可用：探索前进 / 环顾四周 / 攻击 / 休息 / 存档…」；裸面板名（背包/技能/属性/地图/任务/影子）在关键词表之前路由成 `reply.panel`（整句锚定，`查看背包`/`打开地图看看` 不被吞），前端 `openTab` 直开抽屉，零副作用经断言逐字段核对 hp/mp/gold/chapter/scene/xp/level/rest_used/encounter_*；断言 `no-placeholder-prose.mjs` 覆盖 /action + /ai-action + Playwright 口述「地图」开面板，默认跑 UI（SL_SKIP_UI=1 跳过），隔离实例 3 连跑全绿、旧代码红证成立；审查 REJECT 一轮（API/UI 端口解耦、UI 步骤默认跳过）后已修并复验；**副作用回归**：删掉旧文案的输入回显把客户端的「遭遇X / 第N回合」交战信号一起删了，打红已验收的 F076（combat-gate 稳定 FAIL），随后以「系统未识别该指令：「X」」保留回显修复，F076/F129 均在生产复核 PASS)
  verify: node scripts/assert/no-placeholder-prose.mjs
  risk: low
- [x] F130 所有面板页脚写死「面板 5–0」（`client/src/App.tsx:774`），移动端同样出现，疑似开发期调试串。要求：删除或改为有语义的面板位置提示（如「第 3 / 6 面板」），断言：打开每个面板后页脚文本不得匹配 `/面板\s*\d+\s*[–-]\s*\d+/` ✅ (2026-11-16 cron devin swe-2-high; `.side-foot` 改「第 {tabs.findIndex(tab)+1} / {tabs.length} 面板」，随当前页签联动，桌面/移动同一 DOM；新断言 `panel-footer-strings.mjs` 遍历 6 个页签逐个开面板读 `.side-foot`，正则与旧代码变异双红证（旧构建命中「面板 5–0」FAIL）；F109 `panel-affordance` 的「点 × 关闭 / 无 ESC」断言不受影响、线上 PASS)
  verify: node scripts/assert/panel-footer-strings.mjs
  risk: low
- [x] F131 撤离文案把「守关者残骸」模板套在普通精英怪上：从毒牙蛇（非守关者、且从未被击杀）撤离时播报「你且战且退，撤回了「惩罚副本」——守关者的残骸在身后缓缓凝聚」。要求：撤离文案按敌型与 boss_cleared 分支（普通怪=「它没有追出来」、已击杀 boss=残骸、未击杀 boss=仍守在门后），断言：普通遭遇撤离回包不得含「守关者」「残骸」 ✅ (2026-11-17 cron devin swe-2-high; `combatTurn` 撤离收尾按 (enemy.boss, bossCleared) 三分支：普通怪「它没有追出来」/ 已清 boss「残骸」/ 未清 boss「仍守在门后」；断言普通遭遇回包不得含「守关者」「残骸」)
  verify: node scripts/assert/flee-prose-by-enemy-kind.mjs
  risk: low
- [x] F132 脱战后底部系统组「战斗」「存档」点击无任何可见反馈（无 tab 切换、无空态提示），而相邻战斗四键有「当前没有可攻击的目标」。要求：脱战时给出空态提示或禁用并说明原因；断言：非交战态点「战斗」后 300ms 内页面出现空态文案（含「没有交战」或「当前无战斗」）或按钮 aria-disabled ✅ (2026-11-16 cron devin swe-2-high; 根因是空战斗面板挂在 stage 列顶、长日志滚到底后不在视口内 ⇒ 看起来零反馈。新增 `.sys-toast` 就地提示条（底栏上缘、`pointer-events:none`、2.6s 自动消散）：脱战点「战斗」立即 `当前没有交战目标` 且面板照常开合（F076 `combat-gate` 依赖该键开面板，故不能隐藏/禁用）；点「存档」先 `正在写入存档…`，`dispatch` 改返回 `Promise<boolean>`，回包落地换 `存档已写入 · 存档 #N`；新断言 `idle-combat-tab-feedback.mjs`（300ms 内文案 + 存档完成态，旧构建 `waitForSelector` 3s 超时红证）；线上实测两条提示均出现)
  verify: node scripts/assert/idle-combat-tab-feedback.mjs
  risk: low
- [x] F133 场景可叙述名缺失导致模板念内部标题：`ch1_awaken` 的 `title` 字面为「玩家」，环顾四周读成「你放慢呼吸，重新审视「玩家」」；且观察文案池仅 2 条，三次连点必逐字重复。要求：`chapters.json` 场景补 `narr_name`（≠ title，缺省回退 title），观察/环顾/撤离模板一律读 `narr_name`；观察文案池 ≥4 条且按场景轮转；断言：连续 3 次观察文本互不相同，且不得出现「「玩家」」 ✅ (2026-11-16 cron devin swe-2-medium; `ch1_awaken` 补 `narr_name=「冰冷的石殿」`，`sceneNarrName()` 统一供观察/折返/撤离落点/死亡回溯/守关房再入/`scene_title` 使用，`chapters.js` 加载期拒收占位 narr_name（玩家/TODO/undefined/null/test/占位）；prose 每章 observe 池 2→4 条（GENERIC 同步），同场景 3 连观察互异；新断言 `observe-prose-pool.mjs`（3 连互异 + 禁念「玩家」 + <120 字不复读 + 删 narr_name/池缩回 2 条/注入占位三重变异敏感），旧代码上线端口跑该断言即时红证（第 3 条观察与第 1 条逐字相同）；线上实测 3 连观察四条文案互异)
  verify: node scripts/assert/observe-prose-pool.mjs
  risk: low

## 第 11 轮试玩新增（2026-11-16 04:55，cron；真人 120 动作 / 桌面+移动 / 第 2 章惩罚副本）
- [x] F134 （阻断）死亡回溯不返还休息次数 → 惩罚副本内经验来源耗尽即成永久死局：回溯只回 `HP/MP 一半 + 主线 1/3`，`rest_used` 原样保留（实测第 2 次回溯仍显示「本章剩余休息 2/3 次」）。惩罚副本 `ch2_penalty_gate` 内 环顾/潜行/前进 均无遭遇，唯一刷怪来源是「休息被遭遇打断」（沙地毒蛇 Lv.4）；3 次休息用完后 Lv.3–4 玩家打不赢毒牙蛇（HP200 / 18 伤/回合），Ch.1 已通关无重入、Ch.3 只能受压制强进 ⇒ 存档实质报废（`review-F129-1794805088255` 实测复现，与 F128 同根但这是更硬的机制：不是数值不够，而是**经验与回血资源全部断供**）。要求：死亡回溯重置 `rest_used`（与「跨章重置」同一时机语义：回溯等价重开本章）**或**惩罚副本内提供可重复的经验/撤离途径；两者取一即可，不要同时改战斗数值；断言：脚本制造一次死亡回溯 → 断言 `rest_used` 归零且 `GET /api/saves/:id` 的 `rest_left` 回满；再从回溯点按真实路径（休息→遭遇→战斗→前进）连跑 40 步，断言 XP 至少增长一次、且不得出现「全部出口均无 XP 来源」态 ✅ (2026-11-16 cron devin swe-2-medium; settleDeath 的 patch 增加 `rest_used: 0`（与跨章重置同一语义），回溯播报补「休息次数已重置（3/3 次可用）」；新断言 `death-rewind-rest-refill.mjs`：A `rest.remaining` 回满 3/3 + DB rest_used=0 + deaths+1，B 重复死亡幂等，C 回溯落点 40 步真实路径无「全出口断供」；该断言在旧代码上实测 FAIL（`remaining:0`）→ 非假绿；F121/F114 死亡类断言无回归)
  verify: node scripts/assert/death-rewind-rest-refill.mjs
  risk: high
- [x] F135 守关者门前残留「半个战斗栏」：3/3 场景行动栏渲染 `攻击(可点) / 释放技能(disabled) / 防御(disabled) / 逃跑(disabled)`，点那颗孤零零的「攻击」直接开战（等价叫阵），但按钮无任何「叫阵即开战」提示，玩家会当成安全空挥。要求：非交战态不渲染战斗四键（挑衅态由「叫阵守关者」主按钮承担），或给该键与主按钮相同的开战文案/确认；断言：`advance_mode=challenge_boss` 且 `combat=null` 时，战斗组不得出现「释放技能/防御/逃跑」disabled 残键；点「攻击」前页面须含「叫阵」字样提示 ✅ (2026-11-16 cron devin swe-2-high; `challenge_boss && !liveCombat` 时 COMBAT_BUTTONS 只渲染「叫阵 · 攻击」一键（primary，title「守关者就在面前 — 叫阵开战」，点击仍走同一 `攻击` 结算），其余三键 `return null`；`liveCombat` 四键逻辑零改动；新断言 `gate-no-stray-combat-bar.mjs`（残键计数=0 + 攻击键含「叫阵」，旧构建计数断言红证）；已勾选 F121 的 `boss-room-escape-ui.mjs` 原来断言残键「必须存在且 disabled」，已改为「不得渲染」并保留主按钮真开战那一段，F121 verify 线上仍 PASS)
  verify: node scripts/assert/gate-no-stray-combat-bar.mjs
  risk: low
- [x] F136 同名重新登记静默开新档、无存档找回入口：存档只存 `localStorage.solo_leveling_save_id`，换浏览器/清缓存后输入**相同猎人代号**直接开 Lv.1 新档（实测同名重登 = 全新开场），无「检测到已有存档，继续/新建？」提示；刷新页面可正常续玩。要求：建档时先查重名（`GET /api/saves?player_name=`），命中则让玩家二选一（继续该档 / 另起新档并提示会失去旧档），或至少明示「存档仅绑定本机浏览器」；断言：用同名 POST `/api/saves` 两次 → 回包带 `existing_save_id` 或前端出现「已有存档」文案，且不得静默返回两个互不相干的存档 ✅ (2026-11-16 cron devin swe-2-medium; `GET /api/saves?player_name=` 下发存档摘要数组（400 空名/空数组无命中），`POST /api/saves` 建前查重：同名（JS 侧 NFKC+trim+大小写折叠**精确**匹配，`db.js#saveNameKey` 单一事实源）默认 **409** + `existing_save_id` + `name_conflict:true` 且一条记录都不写，只有 `mode:"new"` 才并存（回包带 `superseded_save_id`/`replaced_note`）；前端建档先查重名，命中弹「检测到已有猎人「X」（Lv.N · 第 M 章）」二选一——「继续这个存档」写 localStorage 直入旧档、「另起新档」二次确认后走 `mode:"new"`，并常驻「存档绑定本机浏览器，换设备请用同一猎人代号找回」；新断言 `same-name-save-recovery.mjs` A–F（201 回归 / 409+existing_save_id / 冲突后仅 1 条 / 大小写空格变体 / mode:new 并存 2 条 / UI 对话框+续旧档 id），隔离实例 3 连跑全绿、旧代码红证（B 步拿到 201 新档），线上 `verify.sh F136` PASS 且全量 E2E 5/5、F129 `no-placeholder-prose` 因建档名超 maxLength 截断撞名一并修掉（改用短随机名）)
  verify: node scripts/assert/same-name-save-recovery.mjs
  risk: low

## 第 15 轮试玩新增（2026-11-16 08:05，cron；F136 上线后真机 180 动作 / 桌面+移动）
- [x] F137 自由输入意图覆盖过窄：交战中输「对着石像挥一拳」→ 回指令表不结算攻击；惩罚副本 2/3 输「离开这里」→ 被路由成「前进」，直接撞回毒牙蛇守门房（方向与语义相反）；「撤离副本」「回到第1章」一律「系统未识别该指令」。要求：攻击类同义表述（挥拳/砍/劈/打它/出手）在交战中按攻击结算；「离开/撤退/撤离/回去」等脱离语义在交战中解析为 `flee`、在非交战惩罚区解析为「撤离惩罚副本」，**不得**路由成 `advance`；未识别时回指令表之外再给一句「你是想攻击还是想离开？」的澄清问句。断言：交战中三种攻击同义句各造成一回合结算（敌人 HP 下降且回合数 +1）；惩罚区「离开这里」不得让 `scene` 从 `ch2_penalty_gate` 走向守门房/毒牙蛇遭遇；`flee`/`撤离` 指令不得出现在「未识别」回包 ✅ (2026-11-16 cron devin swe-2-high; `server/ai/keywords.js` 词表单一事实源改动——attack 补 `挥[^，。！？]{0,3}拳|挥刀|劈|打它|打你|揍|出手|砸`（不加裸「打」，避免吞「打开背包」），flee 补 `离开|撤离|回到|返回|脱战|溜走|走人` 并从 advance 正则删掉「离开」；`server/index.js` 非交战 flee 分两层——`chapters.json` 场景级 `escape_locked`（ch2_penalty_gate / ch2_poison_fang，数据驱动非写死 id）走 `refused` 零消耗短路并给真实出路「击败守关者或撑到副本终结」，普通场景回「此处没有交战，无需撤离」且绝不推进；未识别兜底追加「你是想攻击还是想离开？」；`/action` 与 `/ai-action` 回包统一新增 `intent`（新增字段，前端不读不受影响）；新断言 `free-input-intent.mjs` (a)–(g) 隔离实例 3 连跑全绿，旧码红证 (a) FAIL，另手工红证：旧码 `ch2_penalty_gate` 输「离开这里」→ `scene=ch2_poison_fang` + 毒牙蛇开战，新码原地 + `escape_locked:true`；回归 `node --test server/*.test.js` 203/203、F076/F096/F109/F129/F134 线上 PASS、`ci-deploy.sh` 内置 E2E 5/5、合并后全量 `run-all.mjs` 5/5)
  verify: node scripts/assert/free-input-intent.mjs
  risk: med
- [ ] F138 惩罚副本「回满血再挑战」反被打回死循环：2/3 休息召来可击杀的惩罚沙虫 Lv.4（+36XP，唯一活路），但 **3/3 休息召来的却是 Boss 本体**（「休憩被硬生生打断——惩罚副本·毒牙蛇摸到了你的藏身处」）——玩家最自然的「回满血再挑战」操作反而立刻回到必死遭遇，且位置规则不可预测。要求：惩罚副本内休息遭遇一律从「惩罚副本杂兵池」（沙虫/毒蛇 Lv.4，可击杀）取样，Boss 本体只在玩家主动叫阵/前进到守门房 3/3 时才出现；休息回包须带 `encounter_source:"rest"` 与可读提示。断言：同一存档在惩罚副本连做 3 次休息，遭遇名字不得出现「毒牙蛇」；三次休息的遭遇等级均 ≤ `player.level + 1`
  verify: node scripts/assert/penalty-rest-encounter-pool.mjs
  risk: high

## 第 16 轮试玩新增（2026-11-16 09:24，cron；F137 上线后真机复核，桌面 1280×800）
- [x] F139 （阻断）F137 的封门拒绝在「守关者已死」后当面说谎 + 承诺一条不存在的出路：杀完 ch2 毒牙蛇后 `advance_mode=next_chapter`、主按钮已换「进入第3章」，此时输「离开这里」仍 `refused+escape_locked`，回「退路已被封死——你无法撤离。只有击败守关者，或撑到副本终结，才能离开这里」。两处错：① `escape_locked` 是场景静态字段，不看 `boss_cleared`/`advance_mode`，Boss 已死仍拒；② 「或撑到副本终结」机制上不存在（场景文本「存活至副本结束」无 N/M 计数、无计时器、任务面板无惩罚倒计时，死亡回溯落点又指回 `ch2_penalty_gate`），同一条出路被杀蛇说成了两条，且拒绝句不点名可点动作词（守关门 refused 会点名「叫阵守关者」）。要求：`escape_locked` 分支先看 Boss 是否已清——已清则不再拒绝，回「守关者已倒下，按『前进』离开副本」（或直接放行推进），未清则文案改成单一路径并点名动作词（「说『前进』挑战守关者」），**删掉**「撑到副本终结」类 phantom 承诺。断言：Boss 已击杀存档在 `ch2_penalty_gate` 输「离开这里」不得 `refused`（或文案不含「无法撤离」且含「前进」）；Boss 未清时回包不得含「撑到」「存活至副本结束」，且必须含动作词「前进」或「叫阵」。 ✅ (2026-11-16 cron devin swe-2-high; `peacefulCombatIntent` 的 escape_locked 分支先过 `bossRequirementMet(save, chapter)`（读 `boss_cleared_json`，与章节门/主线奖励同一口径）：已清→`patch:null`、不挂 refused/escape_locked、不替玩家推进不掷遭遇，回「守关者已经倒下，退路重新打开——按「前进」离开副本」；未清→照旧 `refused+escape_locked` 零日志零消耗，文案删掉 phantom「撑到副本终结」，改「说「前进」挑战守关者，打倒他才能离开；说「叫阵」也行」；新断言 `escape-locked-boss-cleared.mjs`（(a) 未清两场景拒+点名动作词+无「撑到/存活至/毒牙蛇」、(b) 已清不拒+含「前进」、(c) 已清后「前进」两步正常进 ch3），隔离实例 3 连跑全绿，旧码红证 (a) FAIL + 手工红证（旧码 boss_cleared 后仍 refused 并谎称「只有击败守关者」）；回归 203/203 单测、F137/F076/F096/F109/F129/F134 线上 PASS、部署内置 E2E 5/5)
  verify: node scripts/assert/escape-locked-boss-cleared.mjs
  risk: med
- [x] F140 F137 同族漏网：「往回走」仍被 advance 抢走——实测 ch3 正常场景输「往回走」`scene` 从 `ch3_association` 真推进到 `ch3_retest`（方向与语义相反）。要求：flee 词表补 `往回|回头|退回去|原路返回`，并确认不把 advance 的裸「走」抢坏（「继续走」必须仍是 advance）。断言：非交战场景输「往回走」「原路返回」`scene` 不变且非 advance；「继续走」「向前走」仍是 advance。 ✅ (2026-11-16 cron devin swe-2-high; `server/ai/keywords.js` 的 flee 规则补 `往回|回头|退回去|原路返回`，advance 词表未动；`keywords.test.js` 补 6 条用例（4 后退→flee、继续走/向前走→advance）；新断言 `backtrack-intent.mjs`：ch3_association 非交战存档输「往回走/原路返回/回头」逐个 intent=flee 且 scene 不动，再验「继续走/向前走」intent=advance 且 scene 真变化（每步 front 铸回链首，不吃 RNG）；隔离实例 2 连跑全绿，旧码红证「往回走→intent=advance，scene 已到 ch3_retest」；F137/F139/F096/F076/F129/F135 线上回归 PASS、部署内置 E2E 5/5)
  verify: node scripts/assert/backtrack-intent.mjs
  risk: low
- [x] F141 帮助文本被当成敌人名导致「幽灵战斗面板」：打一场仗 → 输「帮助」→ 刷新页面 → 战斗面板自动顶开显示「交战 第5回合 / 战中： Lv.- HP -/-」，玩家以为卡在一场看不见敌人的战斗里（`CombatPanel` 的 `ENEMY_RE` 把指令表里的「遭遇战中：」抓成敌人名，`TURN_RE` 抓到旧回合数）。要求：`ENEMY_RE`/推断逻辑排除系统指令表行（或以服务端结构化的 `combat` 字段为准，不再从日志正则反推）；断言：Playwright 打一场仗 → 输「帮助」→ 刷新 → 战斗面板不得显示「交战」；同场景真交战时面板仍正常显示。 ✅ (2026-11-16 cron devin swe-2-high; `gateIndexes`/`detectCombatGate`/`inferContext` 改收 `{live, freshFrom}`：`save.combat` 非空直接判 engage（F088 单一事实源），脱战口径下只信本会话新写入且非指令表（`SYS_TABLE_RE`=可用指令|遭遇战中）的行，刷新回灌的旧战报与帮助指令表不再点亮面板；App 新增 `logBaseRef`（整页回灌 + enterSave 两处）并把基线透传给 `CombatPanel`；新断言 `ghost-combat-panel.mjs`（(a) 打仗→帮助→刷新不得出现「交战」面板，(b) 真交战刷新仍自动展开且敌名/回合正确）；隔离实例 3 连跑全绿，旧码红证显示「交战 第4回合 / 战中： Lv.2 HP —/—」；线上 3020 连跑 3 次 PASS、部署内置 E2E 5/5、F076/F132/F135/F109/F121 回归 PASS)
  verify: node scripts/assert/ghost-combat-panel.mjs
  risk: med
- [x] F142 拒绝往来不落库（minor）：refused 的输入与警告零日志，刷新后「离开这里」连同「你无法撤离」一并消失，玩家回查无据；F137 把更多日常输入变成 refused 后「被抹掉的对话」变多。要求：refused 输入仍写一条 user 日志 + 一条 system 拒绝文案（不产生任何数值结算/位移），或明确在回包标注 `logged:false` 并让前端保留本地气泡。断言：封门拒绝后 `GET /api/saves/:id` 的日志含该输入与拒绝文案，且 hp/mp/xp/scene 零变化。 ✅ (2026-11-17 cron devin swe-2-high; `/action` 与 `/ai-action` 的 refused 分支改写成两条日志（user 原文 + system 拒绝），结算 patch 仍为 null（零数值/位移）；终章入口保留 F089 零日志短路。契约同步：gate-refusal-free / escape-locked-boss-cleared / free-input-intent 的「零日志」口径改为「每次拒绝恰 2 行、数值零变化」（强度不降，另加内容断言）)
  verify: node scripts/assert/refused-log-visibility.mjs
  risk: low
- [x] F143 面板直开只认裸名（minor）：「背包」能开面板，但「打开背包」→ unknown 吃兜底、「看看背包」被裸「看」抢成 observe。要求：`打开/查看/看看/打开我的/给我看` + 面板名 一律路由到对应面板（F129 的整句锚定原则不变，长句叙述不得被吞）。断言：「打开背包」「看看背包」「打开我的属性」均回 `panel`；「我打开背包发现里面空了」不得回 panel。 ✅ (2026-11-16 cron devin swe-2-high; `server/index.js` 的 `PANEL_ROUTES` 抽出 `PANEL_VERB = "(?:打开我的|给我看|打开|查看|看看|瞧一瞧|看一下|调出|显示)?\\s*"` 并前置到六条路由（整句锚定不变，长句首尾对不上锚点照走意图解析）；新断言 `panel-open-verbs.mjs`（14 组动词+名/裸名 → 正确 panel 且 hp/mp/scene/xp 零副作用；「我打开背包发现里面空了」「他打开地图看了一眼就合上」回包无 panel；/ai-action 同口径）；隔离实例 2 连跑全绿，旧码红证「打开背包 → intent=unknown，panel=undefined」；**契约冲突已处理**：F129 的 `no-placeholder-prose.mjs` 原把「查看背包」当反面用例，现改成长句叙述「我查看背包，里面只剩一把断剑」（整句锚定强度不变，「打开地图看看」反例保留），F129 线上复跑 PASS)
  verify: node scripts/assert/panel-open-verbs.mjs
  risk: low

## 第 18 轮试玩新增（2026-11-16 10:43，cron；线上真机 58 步，Lv.1→Lv.2，桌面 1440×900）
- [x] F144 （major）战斗中「使用道具」不可指定物品且按背包顺序乱烧资源：交战中输「使用治疗药水」被拒（只认裸「使用道具」），再输「使用道具」时系统挑了「魔力药剂」（MP 16/20 时回蓝），第二次才轮到治疗药水。要求：`item` 意图支持「使用/喝 + 物品名」（复用既有供给解析，交战中也要生效），裸「使用道具」在多个可用补给中按**当前最缺**（HP 百分比低于 MP 时优先治疗）选取，并在播报里点名选了哪件。断言：交战态输「使用治疗药水」→ 消耗的是治疗药水（该栈 -1、mp 不变）、HP 上升；裸「使用道具」在 HP 60%/MP 100% 时不得消耗魔力药剂
  verify: node scripts/assert/item-target-in-combat.mjs
  risk: med
- [x] F145 （major）脱战完全不能用补给、恢复通道只剩「休息」配额：战斗后残血输「使用道具」→「殿里没有迫近的威胁——补给留到石像真正动起来时再用。」，输「喝治疗药水」→ 未识别。休息有 3/3 配额，配额耗尽 + 残血 = 只能残血硬闯，接近设计死路。要求：脱战允许「使用道具」/「喝 <药名>」回血（零战斗结算、占一条日志、不推进场景），或明确给出替代恢复路径（「休息 x/3」「回城/章节回溯」）并让「使用道具」指路。断言：脱战残血存档输「使用道具」→ HP 上升且消耗一件治疗类补给；若不改这一条，则回包必须同时含剩余休息次数与一条可达的恢复方式（不得只说「留到战斗再用」）
  verify: node scripts/assert/out-of-combat-supply.mjs
  risk: med
- [x] F146 （minor）未识别兜底固定追问「你是想攻击还是想离开？」与语境无关、且不指路面板专属操作：脱战输「喝治疗药水」「加点力量」「跳」都回同一句尾巴；而「加点力量」「装备猎刀」这类面板操作明明有可行路径（属性面板 +1、背包点装备）。要求：兜底问句按语境生成（脱战不再问「攻击还是离开」），并在命中「加点/属性点/装备/卸下」等词时给一句指路（「属性点请到属性面板分配」/「装备请到背包点『装备』」）。断言：脱战未识别输入的回包不得含「你是想攻击还是想离开」；「加点力量」「装备猎刀」回包须含对应面板名
  verify: node scripts/assert/unknown-followup-context.mjs
  risk: low
- [x] F147 （minor）开局配发装备不自动穿、属性面板写「无配发装备」与播报矛盾：建档播报「猎人协会向你配发基础装备」，但武器/防具位「空置 —」，生锈猎刀、旧皮甲躺在背包里要手动装备；属性面板装备栏还显示「无配发装备」。Lv.1 没发现要手动装备 = 裸身打 Lv.3 守关者。要求：建档即装上配发的基础武器/防具（或播报改成「配发了……请到背包装备」并让首个观察提示），属性面板装备栏与 save 的装备字段同源。断言：新档 `GET /api/saves/:id` 的 weapon/armor 非空且攻击力含武器加成；属性面板装备栏文案不含「无配发装备」 ✅ (2026-11-17 cron devin swe-2-high; `autoEquipStarterGear(saveId)` 在 `grantStarterKit` 发完背包后按 `STARTER_KIT` 的 weapon/armor 填槽（`slotView` 非空即跳过 → 幂等、不顶玩家换装；已被丢弃的物品不会凭空补回），并追加播报「已为你装备：生锈猎刀 / 破旧皮甲（攻击 +4 · 防御 +3）」（数值取自物品数据/`equipView`，原「配发基础装备」句保留做幂等标记）；`ensureStarterKit` 顶部同样调用 → 老存档开背包即补穿；`StatsPanel` 文案「无配发装备」→「未装备」。线上实测属性面板：攻击 16+4=20、防御 6+3=9。坑：`equipment.json` 是跨库持久的边车，新库 id 从 1 重号会让旧测试数据顶掉槽位 —— 断言已在建档前按 DB 的 `MAX(id)` 清残留键并打印 `stale equipment purged`)
  verify: node scripts/assert/starter-gear-equipped.mjs
  risk: med
- [x] F148 （minor）背包「N 件」计数与 API 物品栈不符、关键道具不可见：击杀后背包面板显示「7 件」，`GET /api/saves/:id` 返回 8 个物品栈（含 `gate_shard`×2）——传送门碎片既不计入「件」也不在任何分类页，玩家看不到自己持有的关键道具。要求：计数口径与列表一致（不可见就不计数、或给出「关键道具」页签并显示），分类页不得静默吞物品。断言：构造含 `gate_shard` 的存档，背包面板「N 件」数值 = API 可见物品栈数，且每个栈都能在某个页签里看到
  verify: node scripts/assert/bag-count-consistency.mjs
  risk: low
- [x] F149 （待验证；2026-11-17 第 21 轮实测评测进展）HP 归零死亡/回溯流程本轮未实测（Lv.1 却打赢了 Lv.3 守关者，没能送死；升级后 168 HP 更难死）：下一轮用连续作战/惩罚副本专项送死，验证 HP→0 是否有可读死亡播报 + 回溯落点 + rest 回满，而不是静默回血。断言脚本在演练后补，不要用现有 `death.mjs` 代替（它只覆盖 ch1 固定路径） ✅ (2026-11-17 cron devin swe-2-high; 新建 death-probe-live.mjs（DB 压 HP=1 + 撤离掷逃确定性送死，60 回合上限），断言死亡播报可读 / deaths 精确 +1 / 落点=本章链首 / 0<hp≤max_hp；实测 deaths 0→1、ch1_statues→ch1_double_gate、复活 hp=84/168（半血，**非满血**，口径待人工确认：本轮按「不得为 0、不得超上限」断言，不锁满血）)
  verify: node scripts/assert/death-probe-live.mjs
  risk: low

## 第 19 轮真机试玩新增（2026-11-16 11:40，cron；线上 50 步，Lv3 惩罚副本，桌面+移动双视口）
- [x] F150 （major）守关者威压拒绝逐字复读、只指按钮不指可输入动词，且文案教的「叫阵」解析器不认：ch1 石像守卫门口连输 15 次「前进」，回包**逐字相同**（「…唯有击败它才能前行（点「叫阵守关者」逼它现形再战）」），零消耗零推进；纯输入玩家被告知去「点」按钮，而参考的「叫阵」输入实测 `intent:unknown`（回「未识别…你是想攻击还是想离开？」）。要求：①「叫阵」「挑战」「叫阵守关者」纳入 attack 意图；②守关者门前拒绝文案点名**可输入**的动作词（「说『攻击』或『叫阵』」）而非只指按钮；③同一拒绝连续出现时文案轮换/带计数（≥3 种说法），不得逐字复读。断言：门前连输 4 次「前进」≥3 条文案互不相同且每句含「攻击」或「叫阵」；输「叫阵」→ intent=attack 且真的开战（`save.combat` 非空）
  verify: node scripts/assert/boss-refusal-affordance.mjs
  risk: low
- [x] F151 （minor）疑问句/引号内文本含「攻击」被判成攻击指令：交战中输系统自己的兜底句「你是想攻击还是想离开？」→ `intent:attack`，白吃一记 13 点反击。要求：问句形态（以「？」结尾、或含「还是」「吗」「要不要」）不命中战斗意图，落未识别提示；「攻击」仍需在正常陈述句（「我攻击它」「攻击」）中生效。断言：交战态输「你是想攻击还是想离开？」→ intent 不为 attack、回合数不变、HP 不变；输「攻击」→ 仍走 attack 正常结算
  verify: node scripts/assert/attack-question-guard.mjs
  risk: low
- [x] F152 （minor）软门文案与放行自相矛盾：Lv3 过 ch1→ch2 回「第2章开启（等级未达 Lv.5，系统压制了传送门——继续任务/战斗提升等级）」，读起来像「进不去」，但同一回包 `save.chapter` 已是 2、人已站在 ch2 场景；`/api/chapters` 的 `hint` 写的是「可强行进入（受压制）」，正文与数据两套说法，且「受压制」没有任何数值/面板解释。要求：正文改为「推荐 Lv.5 · 已强行进入（本章战斗难度高于你的等级）」或给出可见 debuff 说明，与 `/api/chapters` 的 state/hint 同一事实源。断言：Lv<门限时越过软门，回包正文不得含「压制了传送门」，且须含「强行进入」或「推荐 Lv.N」 ✅ (2026-11-17 cron devin swe-2-high; 新增 `chapterUnlockView` 单一事实源（门槛只读 chapters.json 的 unlockView），`sceneView.chapter_unlock` / `GET /chapters` / 过门播报同源；删「压制了传送门」，改「已强行进入 · 推荐 Lv.N——本章战斗难度高于你的当前等级…建议先刷级再来」；契约同步：chapter-gate（F096）与 gate-refusal-free（F093）改锁新口径 + 负向断言旧话术不得出现)
  verify: node scripts/assert/soft-gate-wording.mjs
  risk: low
- [x] F153 （minor）用掉最后一瓶补给播报「剩余 ×0」：`/saves/:id/item op=use` 与「使用道具」路径在 qty=1 时回「已使用「低级治疗药水」。HP 126→166。（HP +40，剩余 ×0）」，物品其实已从背包移除；与丢弃路径「背包中已无此物」口径不一致。要求：qty-1 === 0 时改写「这是最后一瓶，已用完」或不显示剩余数。断言：qty=1 的存档用掉后，回包不得含「剩余 ×0」，且须含「用完」或「最后一瓶」；inventory 中该栈消失
  verify: node scripts/assert/last-potion-wording.mjs
  risk: low
- [x] F154 （minor）item 意图过宽：`使用(?!技能)` 把「使用钥匙开门」「使用 力量加点」判成 item，回「背包里没有名为「钥匙开门」的可用补给」；`喝[…]{0,8}水` + 名称模糊匹配让「喝水」真的烧掉一瓶治疗药水（脱战扣库存、交战还占一回合）。要求：「使用 X」只在 X 命中补给词尾（药/剂/水/丸/圣水/药剂）时判 item，否则回落 unknown；「喝水」不命中补给（或只在背包有名字含「水」的补给且输入点名时命中）。断言：脱战输「喝水」「使用钥匙开门」「喝彩」→ intent 不为 item、库存零变化；输「使用治疗药水」「喝魔力药剂」→ 仍正常生效
  verify: node scripts/assert/item-intent-narrow.mjs
  risk: low

## 第 20 轮真机试玩新增（2026-11-16 12:10，cron；线上双视口 390×844 / 1440×900 实玩 40 步，Lv.1→Lv.2）
- [x] F155 （minor）点「释放技能」零反馈：行动栏点「释放技能2」只把技能抽屉展开，日志不写一行（`stage-col` 无新节点），玩家分不清「没反应」与「面板开了」；技能列表里的「猛虎猛击 MP12 冷却8 预计伤害 26–49」也没有任何日志提示。要求：展开技能抽屉时写一条系统日志（「已调出技能面板 · 可用：猛虎猛击（MP 12）/瞬步（需 Lv.3）」），与 F143 的面板动词口径一致。断言：点击「释放技能」后日志新增一行且含「技能」，抽屉可见
  verify: node scripts/assert/skill-panel-feedback.mjs
  risk: low
- [x] F156 （minor）首屏「觉醒」按钮无按钮感：输入框与「觉醒」按钮同款描边同款背景，移动端第一眼像第二个输入框，CTA 视觉重量弱于左侧输入框。要求：主 CTA 用实心/发光底色（复用现有 accent 变量），输入框加 focus 高亮，二者在暗底上层级分明。断言：`page.locator('button').style`（背景色 alpha > 0.5 或含 gradient/glow）与输入框样式不同；截图人工确认
  verify: node scripts/assert/awaken-cta-weight.mjs
  risk: low

## 第 21 轮真机试玩新增（2026-11-17 00:40，cron；线上双视口 390×844 / 1440×900 实玩 10 步 + API 逐回合探针）
- [x] F157 （P0 体验硬伤）自由叙述被硬拒绝：开局第一句自由输入「我蹲下检查石阶上的刻痕」只回「系统未识别该指令：「…」。眼下可以做：说「观察」环顾四周；说「前进」推进剧情。」——这是玩家对「AI 文字 RPG」的第一印象，直接归零。要求：未知指令在保留回显（F129 契约）与「系统未识别该指令」前缀（F076 契约）之外，必须 ① 给出与**输入关键词/当前场景**相关的一句具象回应（例：输入含「刻痕/石碑/检查」→「你蹲下去，指尖划过石阶的刻痕：太浅，看不出是字还是磨损。」；含「看/观察」走原 observe），② 明确列出 2 个可执行动作（脱战：观察/前进；交战：攻击/防御），③ 同一输入连发两次文案不得逐字相同（≥2 种轮换）。断言：脱战输「我蹲下检查石阶上的刻痕」→ 回包含回显 + 不含固定问句 + 含「观察」或「前进」+ 含至少一个与输入词（刻痕/石碑/检查）相关的具象片段；同句连发 3 次 → ≥2 条不同文本；旧码跑必红 ✅ (2026-11-17 cron devin swe-2-high; 新增 `UNKNOWN_SCENE_LINES` 8 词族（刻痕/石像/门/血/听/闻/行囊/检视）各 3 句 + 通用池 3 句，实体优先取玩家点名的物、其次取场景正文真实出现的物；进程内 `unknownAckSeq` 按 (save_id, 词族) 轮换；回显与前缀原样保留（F129/F076 回归全绿）。线上实测：「我蹲下检查石阶上的刻痕」→「…你蹲下去，指尖划过石阶上的刻痕：太浅，看不出是字还是磨损。」)
  verify: node scripts/assert/free-narration-ack.mjs
  risk: low
- [x] F158 （P0）守关者房前无状态预警，Lv.1 残血进门必死且死前无人告知：API 探针实测 Lv.1（HP 39/100）进 ch1 石像守卫房，我方每回合 11、对方 13–21，第 5 回合倒地（需要 7 回合才打完 75 HP）——玩家没有任何「你现在打不过」的信号，房间里只有一句「唯有击败它才能前行」。要求：进入守关者房（`challenge_boss`/boss 场景）时补一条系统行，含 ① 当前 HP 绝对值与百分比、② 守关者 HP 与估算的单回合伤害、③ ≥2 条**真实可达**的恢复/变强路径（「休息（本章还剩 N/3 次）」「使用道具/喝治疗药水」「说『前进』折返上一景休整」），且文案按 HP 分段（≥60% 只提示风险，<60% 明确建议先恢复）；不得与 F150 的「可输入动词」口径冲突（点名「攻击」「叫阵」「前进」）。断言：构造 HP<60% 存档进入 boss 房 → 回包含「HP」数值与「休息」或「补给/药水」字样，且含具体的下一步动作词；HP≥60% 时不出现「先恢复」 ✅ (2026-11-17 cron devin swe-2-high; `guardianWarning()` 用 combatEngine.computeDamage 真实算承伤区间（暴击上下限，含装备折算），三条接线：进房开战 / F150 门前拒绝 / 守关房重入；恢复路径按背包实况——没有回血补给就不指「喝药水」这条死路；≥2 变体按 `bossWarnSeq` 轮换。线上实测 HP 94% 进房：「状态提示——你的 HP 94/100 · 94%。「石像守卫」HP 75，估算每回合能对你造成约 10–16 点伤害。说「攻击」开打或「防御」先顶住；说「使用道具」或「喝低级治疗药水」当场回血；说「前进」尝试撤离…」)
  verify: node scripts/assert/boss-room-readiness.mjs
  risk: med
- [x] F159 （minor）主界面没有「重开新档 / 换猎人代号」入口：走查第 10 步「存档/重开」时只能找到「存档」与面板按钮，`重开|重新开始|新档` 在可见按钮里一处都没有——玩家想换个号玩只能靠清 localStorage 或重新登记同名（还要过 F136 的 409 冲突对话框）。要求：档案面板给一个「重新登记（换猎人代号）」入口，点击后回到觉醒页并保留原存档（不删档），或明确说明「同名登记会开新档」；文案点名后果。断言：新档进主界面后，档案面板存在「重新登记」或「换号」按钮，点击回到 `.gate-form`，且原存档 `GET /api/saves/:id` 仍可访问 ✅ (2026-11-17 cron devin swe-2-high; 档案面板 `.side-foot` 新增「重新登记（换猎人代号）」+「原存档仍在服务器，用原代号可找回」；点击只清本地绑定回 `.gate-form`，不发删除，`GET /api/saves/:id` 仍 200)
  verify: node scripts/assert/rebind-entry.mjs
  risk: low


## 第 22 轮真机试玩新增（2026-11-17 01:40，cron；线上双视口 390×844 / 1440×900 实玩 10 步）
- [x] F160 （P1 体验硬伤）交战中「存档」是静默死键：`disabled={busy || Boolean(save.combat)}` 只给了 `title="交战中无法存档"`——移动端没有 hover，玩家第 10 步「存档/重开」时按钮灰着、点不动、也不知道为什么，唯一提示是等 30 秒后 Playwright 超时。要求：交战态在「存档」按钮旁给一条**常驻可见**的就地提示（不是 title）：`交战中无法写入存档 · 先「逃跑」或打赢这一场`，390px 下不换行折成两行也不得横向溢出；按钮仍保持 disabled（`combat-actions-ui.mjs` 的断言不动）；脱战后提示消失。断言：交战态 footer 可见文本含「交战中无法写入存档」且含「逃跑」或「打赢」，`document.documentElement.scrollWidth == clientWidth`；脱战态该文本不存在；存档按钮仍 `disabled` ✅ (2026-11-17 cron devin swe-2-high; 交战态在行动栏给常驻小字「交战中无法写入存档 · 先「逃跑」或打赢这一场」（`.actions` 绝对定位，不占行高、390px 不溢出），按钮仍 disabled（combat-actions-ui 断言不动）；脱战不渲染。断言 save-blocked-hint 双视口 + 旧码红证)
  verify: node scripts/assert/save-blocked-hint.mjs
  risk: low
- [x] F161 （P1 选择感/行动经济学）「前进」在剧情幕零消耗且不解释：本轮 390×844 实测前进#1 回包末尾写「（本次没有消耗体力）」，而 #2/#3 各扣 HP 3 / MP 2 —— 同一个按钮同一屏内三种代价，玩家无法预期；且连续零消耗前进不提高遇敌率（`encounters:"none"` 幕直接跳过掷点），导致「一直按前进」在最需要紧张感的开场是免费的。要求：① 零消耗幕必须有**剧情内理由**（如「这一景只是观察，不耗体力」→ 换成「（这一幕只是凝视，未耗体力）」并说明下一幕会耗），② 连续「前进」计数 ≥3 时遇敌概率线性上升（复用 `encounter.js` 的 `PITY_LIMIT` 或新增 `STREAK_PER_ADVANCE`），③ 正文里「本次没有消耗体力」这类系统口吻不得单独出现而无解释。断言：连按「前进」10 次，`hp+mp` 净变化 > 0 且至少触发 1 次遭遇（或给出可见的遇敌率上升提示）；零消耗幕的回包必须含解释词（「只是／未耗／下一幕」） ✅ (2026-11-17 cron devin swe-2-high; ① 全部零消耗注脚改为「（这一幕只是凝视前路，未耗体力——下一幕开始要付代价：HP 3 · MP 2）」，数值语义不变；② `encounter.js` 新增 `advance_streak`（saves 表 ALTER 迁移，老档落 0）+ `STREAK_THRESHOLD=3` / `STREAK_PER_ADVANCE=0.08`，连按第 3 次起遇敌率线性叠加并封顶 `MAX_CHANCE`，同时解锁 `encounters:"none"` 幕的掷点（疾行会惊动本该安全的地方）；③ 观察/休息/攻击等已结算动作清零计数，被拒的前进不计。断言 advance-cost-transparency 在隔离实例 PASS（旧码红证）+ encounter.test.js 新增 109 行；主线定点回归 10 条已勾选断言全绿)
  verify: node scripts/assert/advance-cost-transparency.mjs
  risk: med
- [x] F162 （P0 体验硬伤/选择感）自由行动「动作 + 对象」被丢弃：本轮 390×844 实玩输入「我蹲下身，捡起地上一枚发烫的碎片」，回包却是「你仔细检查了石像——没有松动的机关，也没有藏东西的暗格」——玩家说的对象（碎片）被换成场景默认实体（石像），说的动作（捡/蹲）被归到 `inspect` 关键词族，且回包没有任何后果。`server/index.js` 的 `unknownSceneLine()` 只在 `UNKNOWN_SCENE_ENTITIES` 里找场景实体，玩家点名的物若不在该表就整段丢弃；`inspect` 族三句话也没有一句承认玩家的具体动作。要求：① 玩家输入里的**名词短语优先**（从原文提取「一枚发烫的碎片 / 碎片」这类候选，做子串匹配到实体则用它，取不到才退回场景实体）；② 输入里的动词族（捡/拾/蹲/摸）要体现在回包措辞里，不得把「捡起」答成「检查」；③ 玩家点名的物在本场景**不存在**时，必须**明确否认**（「这里没有你说的碎片」）而不是换个物答；④ 捡到/拾取类动作至少给一次可见后果（若场景数据里有 `pickups` 则入背包，否则给一条「你把它收进背包」的文案 + 背包条目或明确说明「这东西带不走」）。断言：`node scripts/assert/free-action-object.mjs` —— 发「我蹲下身，捡起地上一枚发烫的碎片」后，回包**不得含**「检查了石像」，且要么含「碎片」，要么含明确否认（「没有…碎片」）；发「我捡起那把不存在的钥匙」后回包必须含否认词且不得出现场景实体名替换（石像/石碑）；发「我捡起地上的石屑」后回包里动词必须是「捡/拾/收」族，不得是「检查/端详」 ✅ (2026-11-17 cron devin swe-2-high; 新增纯函数模块 `server/ai/free-action.js`（369 行：`extractEntities` 名词短语候选 / `resolveTarget` 玩家点名词优先三级回退 / `verbFamily` 拾取族与查看族分离 / `pickupOutcome` 三分支后果叙述 / `denyLine` 明确否认句 / `FIXTURE_ENTITIES` 场景固着物）；`unknownSceneLine()` 接线：拾取族覆盖 generic/inspect/carve/statue/door 五族并给「拿不走/带不走/入包」后果句，inspect 族点名非场景物改走否认句（不再换物作答）；listen/blood/smell/bag 四族行为与轮换原样保留。隔离实例实测：「我蹲下身，捡起地上一枚发烫的碎片」→「你蹲低去捡——可这里没有你说的碎片，只有石像和石门。」；断言 free-action-object PASS + `free-action.test.js` 184 行；主线回归 ai-fallback / free-narration-ack / observe-prose-pool / free-input-intent / no-placeholder-prose 全绿)
  verify: node scripts/assert/free-action-object.mjs
  risk: med
- [x] F163 （P1 体验/去 Demo 感）交战时两组重复战斗按钮：浮层 `CombatPanel` 渲染「攻击 / 技能 / 防御 / 道具 / 逃跑」，行动栏同时渲染「攻击 1 / 释放技能 2 / 防御 3 / 逃跑 4」——同一屏 9 个按钮做 4 件事，玩家要先猜「点哪一组」。要求：交战态只保留**一组**战斗控制（建议行动栏四键 + 新增「道具」，浮层 `CombatPanel` 退化为纯情报面板：敌人名/HP 条/回合数/单回合伤害预估/我的 HP-MP，不再渲染动作键），浮层仍可关闭且关闭后行动栏四键仍完整可用；`scripts/assert/combat-actions-ui.mjs` 的既有契约（四键可用、空手时「当前没有可攻击的目标」、脱战无「探索前进」）必须继续绿；**新增**断言：交战态下「攻击」可点按钮全局只出现 1 个（`page.getByRole("button", { name: /^攻击/ })` count === 1）。`scripts/e2e/run-all.mjs` 全绿 ✅ (2026-11-17 cron devin swe-2-medium×3; 浮层 `CombatPanel` 退化为情报层（敌名/HP 条/回合/每回合预估/我方 HP·MP + 关闭键，`.combat-acts` 五键全删、面板内 button 只剩 1 个关闭键）；行动栏交战态成为唯一控制组「攻击1/释放技能2/防御3/道具4/逃跑5」（新增道具键、逃跑改绑 5、系统背包键 kbd 让位），390px 下 **3+2 铺满**（117×3 | 179×2，无右侧空洞）、stage 512px/60.7%、`scrollWidth==clientWidth`；新增断言 combat-controls-single（全局「攻击」只 1 个 + 关面板后仍可结算）PASS，并把已勾选的 `combat-gate.mjs` 从 `.combat-acts` 选择器迁移到行动栏（保留四条 gate 驱动路径 + 新增「面板长出重复按钮」负向锁，强度不降）；combat-actions-ui / save-blocked-hint / ghost-combat-panel / gate-no-stray-combat-bar / run-all 6/6 全绿)
  verify: node scripts/assert/combat-controls-single.mjs
  risk: med

## 第 24 轮真机试玩新增（2026-11-17 04:30，cron；线上双视口 390×844 / 1440×900 实玩 10 步）
- [x] F164 （P0 成长可见性）未分配属性点在主界面零提示：打完守关者 Lv.1→Lv.3，档案面板里写着「剩余属性点 6」，但状态栏/行动栏/日志里一处提示都没有——玩家不主动点「属性」就永远不知道自己能加点（本轮走查原话：「成长按钮被藏起来了」）。要求：① 状态栏（`.status`）在 `free_points > 0` 时显示一个可点的「属性点 +N」徽标，点它直接打开属性面板（复用现有面板路由，不新增后端端点）；② 升级回包里那句「自由属性点 +3」之后补一句可执行指引（「打开『属性』面板分配」），不得只在面板里可见；③ 交战中徽标仍显示但点击后提示「交战中无法分配属性点」（与面板同一口径），不得静默无反应；④ 390px 下不横向溢出、不挤压 HP/MP 条。断言：`node scripts/assert/free-points-badge.mjs` —— 建档打到升级后，`.status` 可见文本匹配 `/属性点\s*\+?[1-9]/`，点击徽标后档案面板打开且含「剩余属性点」；`document.documentElement.scrollWidth === clientWidth`；未升级的新档不出现该徽标
  verify: node scripts/assert/free-points-badge.mjs
  risk: med ✅ (2026-11-17 cron devin swe-2-high; 状态栏 `.status-nums` 首位新增可点胶囊徽标「属性点 +N」（`.stat-points-badge`，system 青细描边 + 220ms 浮现），点击直开「属性」面板；交战中仍显示并可点，另浮 toast「交战中无法分配属性点」（与面板同口径）；free_points=0 不渲染；390/1440 双视口 scrollWidth==clientWidth、console error 0；断言 free-points-badge PASS（旧码红证）+ combat-controls-single/combat-actions-ui/save-blocked-hint/ghost-combat-panel/gate-no-stray-combat-bar 全绿)
- [x] F165 （P1 内容厚度/收束）章节打完没有结算：走到「【主线】本章主线 7/7 完成。」只有这一行，下一推直接又刷遭遇，再一推才过门——玩家不知道本章杀了几只、拿了多少 XP/金币/掉落、下一章叫什么。要求：① 到达主线链尾（`chapter_completed` 转真）的那一回包追加一段【章节结算】：本章击杀数、累计获得 XP 与金币、本章最强击杀目标、下一章标题；② 结算文本只引用真实账本字段（saves.kills/xp/gold + chapters.json 的下一章 title），不得编造数字；③ 结算句必须点名一个可执行的下一步（如「说『前进』进入第 2 章 · 每日任务」），且该动作真的可达；④ 同一章只播报一次（重复前进不得重复刷结算）。断言：`node scripts/assert/chapter-clear-summary.mjs` —— 新档打通第 1 章至 7/7，回包含「【章节结算】」且含击杀数与 XP 数字，含「第 2 章」或下一章标题，含一个「前进」类动作词；再发一次「前进」后回包不得再出现「【章节结算】」
  verify: node scripts/assert/chapter-clear-summary.mjs
  risk: med ✅ (2026-11-17 cron devin swe-2-high + 口径修正 pass; `chapterClearSummary()` 挂在 `claimMainReward` 唯一出口（rewards 去重 ⇒ 同章终生只播一次），正文【章节结算】第 N 章 · 章名 / 击杀 · 经验 X/Y（Lv.N）· 金币 · 本章进度 N/N / 下一章「标题」——说「前进」进入；经验分母复用 `progression.xpToNext`，不写「累计 XP」（saves.xp 是当前级进度，首版口径错误已由 fix/F165b 修正）；线上实拉：「击杀 2 · 经验 47/160（Lv.3） · 金币 62 · 本章进度 7/7 · 下一章：第 2 章「每日任务」」；断言 chapter-clear-summary PASS（旧码红证）+ chapter-gate/gate-refusal-free/ending-closure 各自独立库全绿)
- [x] F166 （P1 文本质量/选择感）自由输入长句仍以「系统未识别该指令」开场：本轮实测「我蹲下身，捡起地上一枚发烫的碎片」的回应是「【系统】系统未识别该指令：「…」。你蹲低去捡——可这里没有你说的碎片…」——后半句已经会说人话，前半句却把整句按解析报错打包退回，玩家主观上从「世界在回应我」掉回「关键词表没匹配上」。要求：① 明显是**自然语言长句**（≥8 字且不含指令关键词，如「攻击/前进/休息/技能/存档/遭遇/第N回合/帮助」）时，回包去掉「系统未识别该指令：「X」」前缀，改用世界口吻（沿用 `server/ai/free-action.js` 的叙述句）；② **指令形态输入**（短词、含「遭遇」「第 N 回合」等战斗信号、含数字键位）必须保留原文回显——F076/F129 的客户端依赖不得破坏；③ 结尾的「眼下可以做」指引保留；④ 交战中分支口径不变。断言：`node scripts/assert/free-input-voice.mjs` —— 发「我蹲下身，捡起地上一枚发烫的碎片」，回包不得含「未识别该指令」且必须含否认词（没有/不存在）与「碎片」；发「遭遇哥布林」回包必须仍含「遭遇哥布林」（回显保留）；发「第 3 回合」回包必须仍含回显；两条断言在同一实例各跑一次
  verify: node scripts/assert/free-input-voice.mjs
  risk: med ✅ (2026-11-17 cron devin swe-2-high + 断言迁移 pass; `server/ai/free-action.js` 新增 `echoRequired()`（去空白 <8 字 / 命中指令信号词 / 含数字 → 指令形态，保留回显；否则自然语言长句去前缀）+ `COMMAND_SIGNAL_RE`；`unknownFallbackContent` 与交战 unknown 分支接线：长句回「【系统】你蹲低去捡——可这里没有你说的碎片…」，指令形态仍回「系统未识别该指令：「遭遇哥布林」」（F076/F129 客户端依赖保留）；F157 断言同步迁移为「长句不得含未识别前缀 + 指令形态仍回显」双契约，强度不降；断言 free-input-voice / free-narration-ack PASS + free-action-object/free-input-intent/unknown-followup-context/out-of-combat-supply/escape-locked-boss-cleared/no-placeholder-prose/combat-gate 全绿)

## 第 25 轮真机走查新增（2026-11-17 05:40 UTC，cron；线上双视口 390×844 / 1440×900 实玩 10 步 + 3 个补充探针）
- [x] F167 （P0 体验硬伤/文本节奏）一次「前进」把四类文本塞进同一个气泡：390px 实测第 3 推同时包含 剧情（约 450 字）+「（体力消耗 HP 97→94 · MP 18→16）」+「【遭遇】石像守卫 Lv.3 拦住了去路——它的 HP 75/75」+「【系统】状态提示——你的 HP 94/100…说『攻击』开打…说『前进』尝试撤离」（教学段），要滑三屏，读起来像结算单不像小说。要求：① 触发遭遇的那一次动作，把「【遭遇】…」与随后的「【系统】状态提示…」教学段拆成**独立日志条目**（服务端追加日志行，或在客户端按段落渲染成独立气泡），剧情条目只保留剧情正文 + 代价行；② 拆出的遭遇条目不得含「（体力消耗」/「（没有消耗」这类代价括号；剧情条目不得含「【遭遇】」；③ 拆条不改变任何数值结算与 `combat` 写库路径，`next_choices`/`advance_mode` 口径不变；④ 390px 下剧情条目可见高度不再需要滑三屏看遭遇（遭遇条目在剧情之后、位于同屏或一步之内）。断言：`node scripts/assert/encounter-split-log.mjs` —— 新档推进到遭遇触发，`.stage-col` 该次点击新增 ≥2 个条目；含「【遭遇】」的条目不含「（体力消耗」，含「（体力消耗」的条目不含「【遭遇】」；遭遇条目长度 < 400 字符
  verify: node scripts/assert/encounter-split-log.mjs
  risk: med
- [x] F168 （P1 选择感/文案一致性）战斗中「撤离」只有文字没有按钮：遭遇提示写「说『前进』尝试撤离」，可交战态行动栏只有「攻击/释放技能/防御/道具/逃跑」——玩家得猜到「前进」是打字用的；而且逃跑失败（「第1回合 · 你试图逃跑，却被敌人拦了下来 · 石像守卫的反击造成 10 点伤害」）后既无成功率也无次数说明。要求：① 交战态提示文案点名**按钮名**（「点『逃跑』或说『前进』尝试撤离」），不得只写「前进」；② 文案明示逃跑可能失败（如「逃跑不一定成功，失败要再挨一击」）；③ 同一句提示按 `encounter_seq` 或回合数换 ≥2 种措辞（不逐字重复）；④ 数值与 `flee` 结算逻辑不动。断言：`node scripts/assert/flee-guidance-wording.mjs` —— 触发遭遇后回包含「逃跑」，且含「不一定/可能失败/不一定能脱身」之一；连续两次遭遇的两段提示不得逐字相同；自由输入「前进」在交战中仍走原有撤离分支（行为不变）
  verify: node scripts/assert/flee-guidance-wording.mjs
  risk: low
- [x] F169 （P1 内容厚度）战斗播报是纯算术、敌人零个性：「第2回合 · 你的攻击命中石像守卫，造成 14 点伤害 · 石像守卫的反击命中你，造成 10 点伤害」——五回合读下来像账单，敌人半血/濒死都没有一句自己的话。要求：① 敌人 HP 首次跨过 50% 与 25% 时，在回合条目里插入一句**敌人自身的阶段反应**（按敌人 kind 的模板池：石像=裂纹/碎石，狼=低吼/呲牙，蛇=嘶鸣，通用池兜底），每个阶段 ≥3 变体按 `turn` 或 `encounter_seq` 轮换，同一场战斗同一阶段不逐字重复；② 阶段句只做叙述，**不得改变伤害/命中/暴击数值与顺序**（结算前后 hp 数值必须与旧码一致）；③ 敌人被一击秒杀（未跨阈值）时不出现阶段句；④ 单测覆盖 50%/25% 阈值与「秒杀不触发」。断言：`node scripts/assert/combat-enemy-phases.mjs` —— 打一场石像守卫到结束，日志里出现 ≥2 条阶段句且互不相同；同一存档数值序列与无阶段句时一致；`node --test server/engine/combat.test.js` 全绿
  verify: node scripts/assert/combat-enemy-phases.mjs
  risk: med

## 第 25 轮上线后回归新增（2026-11-17，cron；线上实拉抓到）
- [x] F170 （P0 体验回归）叙事降级路径把自由输入的「具象否认」降级掉了：本轮把客户端自然语言长句分流到 `/ai-action` 后，线上实测输入「我蹲下身，捡起地上一枚发烫的碎片」回的是**通用观察模板**「你放慢呼吸，重新审视「D 级委托·石门之下」…墙边那圈石像一动不动」（外加降级尾注），而同一句话走 `/action` 会回 F162/F166 那句「你蹲低去捡——可这里没有你说的碎片，只有石像和石门」。根因：`/ai-action` 在 `degraded` 时走 `aiFallback.parse(input)` → `executeIntent(intent)`，把长句归成 observe，绕过了 `resolveAction()` 里的 `free-action` 否认分支。要求：① `/ai-action` 在 `degraded:true` 时统一改用 `resolveAction(fresh, input)`（与 `/action` 同一规则引擎），保证「降级 = 与 /action 完全同行为」；② `degraded` 标记、回包结构（reply/save/degraded）、日志落库条数不变；③ 非降级（AI 正常）路径完全不动。断言：`node scripts/assert/ai-degraded-parity.mjs` —— 两个全新存档（名字带随机串）分别 POST `/ai-action` 与 `/action` 同一句长句：两条回包都必须含「碎片」与否认词（没有/不存在），`/ai-action` 回包必须带 `degraded:true`，且**不得**含通用观察模板「重新审视」
  verify: node scripts/assert/ai-degraded-parity.mjs
  risk: med

### 第 25 轮验收记录（2026-11-17 06:45 UTC，cron；3 车道全 devin，无回退）
- F167 ✅ devin swe-2-high：渲染层 `splitStageEntry()` 把行首【遭遇】/【系统】教学段拆成独立条目（请求/响应、落库、数值零改动，刷新回灌同一规则）；断言 encounter-split-log PASS（旧码红证：遭遇条混入代价行）+ run-all 6/6。线上实拉：回复 3 条，遭遇条目 84 字且不含「（体力消耗」。
- F118 ✅ devin swe-2-medium（第二 pass）：`/ai-action` 降级回包首条气泡尾注「（系统叙事降级：按规则解析）」+ 会话内一次性可收起细条「叙事引擎：规则模式（AI 暂不可用）· 点 × 收起」；断言 degraded-banner PASS（首条有尾注、第二条无、× 收起不复发、新档干净）。
- F168 ✅ devin swe-2-medium：`FLEE_GUIDE_LINES`（2 变体按 `encounter_seq` 轮换）挂在 advance/叫阵/休息被打断三处开战播报，`guardianWarning()` 交战态改为「点「逃跑」或说「前进」尝试撤离（撤离可能失败）」；数值与 flee 结算零改动；断言 flee-guidance-wording PASS（旧码红证：开战只有遭遇行、无撤离指引）。
- F169 ✅ devin swe-2-high：`combat.js` 新增 `ENEMY_PHASE_TEMPLATES`（stone/beast/serpent/generic × half/low 各 3 句）+ 阈值判定（回合前 HP 快照，仅在敌人存活且非死亡回合触发，按 `turn+seq` 轮换不走 RNG）；断言 combat-enemy-phases PASS（旧码红证）+ combat.test.js 116 行新用例；数值逐回合与旧码一致。
- F170 ✅ devin swe-2-medium：`/ai-action` 在 `degraded` 时改走 `resolveAction(fresh, input)`（与 `/action` 同一规则入口），修掉「降级把自由输入的具象否认换成通用观察模板」的线上回归；断言 ai-degraded-parity PASS（两个新档分别打两端点，正文逐字一致）。
- 收尾：单元测试 228/228、run-all 6/6、`ci-deploy.sh` 两次 DEPLOY OK、线上双视口实拉全绿（console error 0 / overflowX 0）。

## 第 26 轮真实玩家走查新增（2026-11-17，cron；见 docs/PRODUCT-REVIEW.md 本轮小节）
- [x] F171 （P0 产品真实性）AI 叙事在线上从未启用：玩家每条自由输入的攻击/否认/叙述都由规则模板生成，回包尾注「（系统叙事降级：按规则解析）」、顶栏常驻「叙事引擎：规则模式（AI 暂不可用）」。根因不是模型不可用，而是 `server/ai/gateway.js` 只读 `OPENCODE_GO_API_KEY`，线上 pm2 进程里只有 `AI_ALIYUN_API_KEY / AI_ALIYUN_BASE_URL / AI_ALIYUN_MODEL`，日志稳定输出 `[ai] skipped request: no API key configured`。要求：① 启动时（`server/index.js` 或 gateway 模块内）无依赖地读取仓库根 `.env`（已被 gitignore）填充 `process.env`，`OPENCODE_GO_API_KEY` 因此可在部署后生效；② 供应商兜底：`OPENCODE_GO_API_KEY` 缺失而 `AI_ALIYUN_API_KEY` 存在时，改打 `AI_ALIYUN_BASE_URL` + `AI_ALIYUN_MODEL`（DashScope OpenAI 兼容端点，不发送 `x-opencode-session`），`isConfigured()` 为真；③ 两条路径的失败码（`no-key` / `http` / `timeout` / `parse` / `network`）语义不变，`generate()` 永不抛出；④ 不得把任何密钥写入日志、返回值或 git 跟踪文件；⑤ 现有 `server/ai/gateway.test.js` 全绿。断言：`node scripts/assert/ai-provider-config.mjs` —— (a) 清空 `OPENCODE_GO_API_KEY` 后注入临时 `.env`，`isConfigured()` 必须为 true；(b) 仅给 `AI_ALIYUN_*` 时用 fetch 桩断言 URL 命中 `AI_ALIYUN_BASE_URL`、body.model 等于 `AI_ALIYUN_MODEL`、且**不含** `x-opencode-session` 头；(c) 给 `OPENCODE_GO_API_KEY` 时仍打 `opencode.ai` 且带 `x-opencode-session`；(d) 两者都缺时返回 `code:"no-key"` 且不发请求
  verify: node scripts/assert/ai-provider-config.mjs
  risk: med
- [x] F172 （P1 视觉/桌面）1440 桌面视口版心塌向左侧、留出约 300px 空洞，快捷键小标签像调试角标：实测中央叙事卡片偏窄且不居中，右侧栏下方大片空白，「战斗」在行动栏与系统键各出现一次、「背包」在页签与系统键各出现一次，1–9 的快捷键数字悬在按钮上方。要求：① ≥1200px 时主内容列（叙事 + 行动栏）居中，版心宽度落在 760–1100px，左右留白差 ≤60px，不出现横向滚动；② 快捷键标签改为按钮内右下角的低对比角标（opacity ≤0.55、字号 ≤11px），不再悬浮在按钮上方像调试标记；③ 390px 布局与既有面板契约零回归（不得改动页签数量、按钮文案、`aside.sidebar.open` 行为）；④ 不改任何服务端逻辑与数据。断言：`node scripts/e2e/desktop-layout.mjs` —— 1440×900 下主列 boundingBox 中心与视口中心相差 ≤24px、宽度 ∈[760,1100]、`scrollWidth-clientWidth===0`、快捷键角标 `opacity<=0.55`；同脚本再切 390×844 断言 `scrollWidth-clientWidth===0` 且行动栏四键与系统键八键仍可点
  verify: node scripts/e2e/desktop-layout.mjs
  risk: med
- [x] F173 （P2 文本质量）降级尾注每条都挂 + 前进模板句逐字重复：自由输入每条回包尾巴都有「（系统叙事降级：按规则解析）」（玩家不需要看到内部术语），且第 1、2 次「前进」都以同一句「（这一幕只是凝视前路，未耗体力——下一幕开始要付代价：HP 3 · MP 2）」收尾 ✅ (2026-11-17 cron devin swe-2-medium；实测降级尾注已由 F118 做成一次性，本轮实修的是「章首注脚每章同一句 + 机制数字」→ `CHAPTER_ENTRY_NOTES` 4 变体按章号确定性轮换、不写 HP/MP 数字（保留可读代价事实）、等待态「系统处理中」→「正在书写……」；断言 `repetition-and-jargon.mjs` 三段：注脚非机制口径 / ch1-ch3 注脚互异且同章可复现 / route 延迟 2.5s 时 `.pending` 不含内部术语且响应后消失；红证：旧码报「章首注脚仍是机制口径」；回归 `advance-cost-transparency` / `degraded-banner` / `no-placeholder-prose` 全绿)
  verify: node scripts/assert/repetition-and-jargon.mjs
  risk: low
- [x] F174 （P0 体验回归，第26轮上线即现）AI 网关首次真正启用后，自由输入的自然语言长句全部改由 AI 判意图，导致：(a) 线上实测「我蹲下身，捡起石阶缝里一枚发烫的碎片」耗时 **12.1s** 才回包；(b) 回包内容错成补给播报「【系统】体力与魔力俱已满格，补给派不上用场。」——F162/F166 好不容易做的「具象否认」（「可这里没有你说的碎片」）在 AI 路径下丢失。根因：`/ai-action` 在 `degraded === false` 时直接 `executeIntent(fresh, intentId)`，而 qwen 把散文判成了 `item`；同时 AI 网关默认超时 20s，散文输入每句都要等一次慢模型。要求：① 散文输入（`server/ai/free-action.js` 的 `echoRequired(input) === false`）**不打 AI 网关**，直接走与 `/action` 同一规则入口 `resolveAction(fresh, input)`，且 `degraded` 保持 falsy（这不是降级，不弹「叙事引擎降级」横幅）；② 指令形态输入仍走 AI 判意图，但单次网关超时降到 ≤6000ms，超时/非法/报错才 `degraded:true` 并回落 `resolveAction`；③ 两条路径的数值结算、日志落库条数、回包字段（reply/intent/degraded/save）口径不变，`/ai-action` 与 `/action` 对同一句散文的正文必须逐字相同。断言：`node scripts/assert/ai-prose-fastpath.mjs` —— 起一个只 accept 不响应的 TCP 假上游，`OPENCODE_GO_API_KEY=k OPENCODE_GO_BASE_URL=http://127.0.0.1:<port>/v1` 启动隔离实例；POST `/ai-action` 发散文长句，必须在 **<2000ms** 内返回、`degraded` 为 falsy、正文含「碎片」与否认词（没有/不存在）、且**不含**「补给」「俱已满格」；再发指令形态「遭遇哥布林」，必须 5–9s 内返回且 `degraded === true`、正文含「遭遇哥布林」回显
  verify: node scripts/assert/ai-prose-fastpath.mjs
  risk: med
- [x] F175 （P0 验收契约对齐，第26轮 F171 启用 AI 后立刻暴露）三条已勾选断言写死了「线上必须降级」的前提，AI 网关真正可用后全部假红：① `scripts/assert/ai-degraded-parity.mjs`（F170）与 `scripts/e2e/degraded-banner.mjs`（F118）都要求 `/ai-action` 回包 `degraded:true`，而现在散文走 F174 快路径根本不降级；② `scripts/assert/flee-guidance-wording.mjs`（F168）把 `E2E_BASE_URL` 写死成 `http://127.0.0.1:3098/game`，该端口无实例时直接 `ERR_CONNECTION_REFUSED`。要求：① 降级类断言改为**显式制造降级环境**——要么用「无任何 AI key」的隔离实例（`env -i` 起 `PORT=…行 node server/index.js`，断言脚本自己起停），要么以「配置了 key 但上游不可达」的方式触发；不得再依赖线上恰好没有 key；② 降级断言同时覆盖「降级时 /ai-action 与 /action 正文逐字一致」与「非降级时同一句散文也必须否认具象化、不得出现通用观察模板『重新审视』」，两条都要在**当前线上（AI 可用）**这种环境下可执行；③ `flee-guidance-wording.mjs` 默认目标改成与其它断言一致的 `E2E_BASE_URL || "https://openfolio.uk/game"`，禁止写死端口；④ 断言强度不降：删掉的每一条「必须 degraded」都要有等价的正向断言替代（隔离无 key 实例上确实 degraded + 正文含否认词）。断言：`bash scripts/verify.sh F170 && bash scripts/verify.sh F118 && bash scripts/verify.sh F168` 在**线上已配置 AI** 的环境下三条全绿；并且在隔离无 key 实例上跑 F170/F118 的两条断言仍能看到 `degraded:true`
  verify: bash scripts/verify.sh F170 && bash scripts/verify.sh F118 && bash scripts/verify.sh F168
  risk: med
- [x] F176 （P1 文本质量/沉浸，第27轮走查）自由输入回包一律挂指令表尾巴 + 正文夹机制说明句：任何人写一句行动描写（「我把手按在石碑上，试着辨认第三条刻痕」），正文之后紧接「眼下可以做：说「观察」环顾四周；说「前进」推进剧情。输入「帮助」查看完整指令表。」——每句复读一遍操作说明（代码注释第 ④ 条自己写着「不复读『眼下可以做』」，实现却每条都拼）✅ (2026-11-17 cron devin swe-2-medium 两条 pass；`unknownTailShown` 按 save_id 进程内计数：首次给完整表、之后只给「仍可：观察 · 前进」短动词提示；`遇敌率随疾行上升` → 「你的脚步越快，惊动的东西就越多」（保留「被惊动」以兼容 advance-cost-transparency）；断言 `free-tail-jargon.mjs`（4 句长句表 ≤1 次 / 帮助正向锁 / 新档隔离性 / 无机制术语）+ F157/F166/F137/observe-short/no-placeholder-prose 全绿；红证：旧码「眼下可以做」2 次 >1)
  verify: node scripts/assert/free-tail-jargon.mjs
  risk: med
- [x] F178 （P1 文本质量，第27轮走查发现，本轮未做）观察类散文回包是通用模板且不给下一步：实测线上输入「我贴着墙根慢慢挪步，留意脚下的动静」「我抬头看了看头顶的裂缝」，都落到 `server/index.js:2312` 的 observe 构建器，回「你放慢呼吸，重新审视「命令之律」。长明灯的火苗笔直向上……」——这既是 F170 明令散文路径不得出现的通用观察模板，又完全没有可执行动作词（F157 只覆盖 unknown 兜底分支，observe 分支漏网）。要求：① 观察类散文改为按词族/场景实体给具象叙述（复用 `UNKNOWN_SCENE_LINES` 思路），不得以「你放慢呼吸，重新审视」开头；② 每条 observe 回包至少给一个可点动词（观察/前进/潜行）；③ 数值与 `observeCount` 轮换口径零改动。断言：`node scripts/assert/observe-prose-concrete.mjs` —— 新档连发 3 句观察类散文（含「裂缝」「墙根」），正文均不得匹配 `/重新审视/`、均须匹配 `/观察|前进|潜行/`、三条互不相同；旧码上必红 ✅ (2026-11-17 cron devin swe-2-medium 两条 pass；observe 构建器改为 `「场景名」——实体细节（仍可说「观察」再看一处，或说「前进」）`，删掉「你放慢呼吸，重新审视」模板；`observeCount` 计数口径改认共用常量 `OBSERVE_MARK`（避免改措辞把轮转清零）；同时落地 F181（`server/ai/entity-detail.js` 实体细节池 + (save_id,entity) 轮换）；顺带打红已勾选 F092 的 `action-prose-by-chapter.mjs`（它钉死旧前缀）→ 第二条 pass 只改该断言：标题改取 `^「(.+?)」` 并新增「不得含『重新审视』」负向锁，其余口径（免费、<120 字、不复读整幕、分章池）不动；三条新断言 + 回归面（free-narration-ack / free-tail-jargon / free-input-intent / no-placeholder-prose / observe-prose-pool / combat-gate / 233 单测）全绿；线上实测「我抬头看了看头顶的裂缝」→ 裂缝专属细节、同一实体第二次换文)
  verify: node scripts/assert/observe-prose-concrete.mjs
  risk: low
- [x] F179 （P1 验收稳定性，第27轮 report 全表暴露）F129 断言依赖模型判别 + F146 被短提示回归 ✅ (2026-11-17 cron devin swe-2-high；短提示改「仍可说「观察」或说「前进」。」（两个 `说「X」` 锚点）修回 F146；`no-placeholder-prose.mjs` 的 AI 侧改为钉确定性不变量——`intent` 不得 `unknown`、正文非空无占位、`observe/item/status` 三落点一律零副作用（`mayMutate` 显式白名单只给「我要休息一下」的 rest），意图确定性改钉 `/action` 规则路径；隔离实例 4 条断言连跑 3 轮全绿；线上部署后 F146/F129/F176/F157 连跑 3 轮全 PASS（F129 由修复前 3/4 FAIL 变为 3/3 PASS）)
  verify: node scripts/assert/unknown-followup-context.mjs && node scripts/assert/no-placeholder-prose.mjs
  risk: med
- [x] F177 （P2 可用性，第27轮走查）「休息」按钮灰置且无任何理由：第 1 章 1/7 与刚进入第 2 章时「休息」都是 disabled，点下去没有反馈，而同栏的「战斗」灰键至少写了「当前没有可攻击的目标」。要求：灰置的「休息」必须给出 `title` + 可见小字提示（交战中 / 本日次数已用完 / 本幕未付代价等按状态分句），不得用一个笼统句子兜住；数值与休息机制零改动。断言：`node scripts/assert/rest-disabled-hint.mjs` —— 新存档首屏 `footer.actions button:has-text("休息")` disabled 且 `title` 非空且与场景状态一致；交战中进入战斗断言提示文案变为交战口径 ✅ (2026-11-17 cron devin swe-2-medium；`.actions-main` 内新增 `.rest-hint`（role=note），文案原样透传 `save.rest.reason`（单一事实源），仅禁用态渲染、交战态随四键整组消失；styles.css 末尾追加一行弱对比小字 + ▪ 前缀，390 下无溢出；断言 `rest-disabled-hint.mjs` a/b/c/d 四段全绿（新档禁用含「俱满」、压低 HP 后可休息则提示消失、交战不残留、无横向溢出）；红证：stash client/src 后 `.rest-hint missing or hidden`；回归 mobile-actions/panels/mobile 全绿)
  verify: node scripts/assert/rest-disabled-hint.mjs
  risk: low
- [x] F180 （P1 文本质量，第28轮走查）自由输入具象回显把原句名词叠进已有名词模板：实测线上「我蹲下检查石阶上的刻痕」→「【系统】你蹲下去，指尖划过刻痕上的刻痕：太浅，看不出是字还是磨损。」——同一个词连出两遍，一看就是模板在拼玩家原话。要求：① 回显模板在插入玩家句子的名词短语前先做去重（同一 2–4 字名词在模板句里已出现时不得再插入，或改写模板措辞）；② 不得用「删掉整句回显」来绕过（F076/F129 依赖输入回显）；③ 数值与日志行数零改动。断言：`node scripts/assert/echo-no-duplicate.mjs` —— 新档连发 6 句含重复名词短语的输入（「刻痕」「石像」「裂缝」），每条回包正文不得匹配 `/([\u4e00-\u9fa5]{2,4})上的\1/`、不得出现任意 2 字词紧邻重复两次（「的刻痕上的」这种除外，按空白/标点切词判定）；旧码上必红 ✅ (2026-11-17 cron devin swe-2-medium；`server/index.js` 加 `dedupEcho()`：`([一-鿿]{2,4})上的\1` → `$1表面`，接在 pickup/deny/词族池三条回显出口之前，不删整句回显（F076/F129 依赖保留）；线上「我蹲下检查石阶上的刻痕」→「指尖划过刻痕表面：太浅……」；断言 `echo-no-duplicate.mjs` 6 句输入全绿，红证旧码出现「刻痕上的刻痕」)
  verify: node scripts/assert/echo-no-duplicate.mjs
  risk: low
- [x] F181 （P1 选择感，第28轮走查）自由输入命中的场景实体没有被落地：我写「我抬头看了看头顶的裂缝」，回包只给通用观察模板（既没有裂缝的细节，也不提裂缝）；同一实体换两种说法得到的是同一池轮转句，玩家的句子没有改变世界描述。要求：① 输入命中当前场景实体词（裂缝 / 石碑 / 石像 / 长明灯 / 石门 / 壁画，词表放 `server/ai/` 纯函数模块）时，回包必须引用该实体名并给出一条该实体专属细节；② 同一实体第二次被观察必须给出**不同**细节（按 (save_id, entity) 计数轮转，不得与第一次逐字相同）；③ 未命中实体时行为保持现状（不得为了通过断言把普通散文也强行塞实体）；④ 数值与 `observeCount` 口径零改动。断言：`node scripts/assert/entity-grounding.mjs` —— 新档对「裂缝」「石像」各发 2 句不同措辞，4 条回包均含对应实体名、同实体两次逐字不同、且均不含 `/重新审视/`；旧码上必红 ✅ (2026-11-17 cron devin swe-2-medium；新增 `server/ai/entity-detail.js`：裂缝/石像/石碑/长明灯/石门/壁画各 4 条具象细节，`extractEntity` 正则族（不依赖分词）+ `entitiesIn` 场景在场实体 + `detail(entity,n)` 确定性取句；observe 分支与 unknownSceneLine 共用 `observeEntitySeq`（save×entity 计数），未命中实体保持原路径；单测 `entity-detail.test.js` + 断言 `entity-grounding.mjs`（裂缝/石像各 2 种措辞、四条均落地实体名、同实体两次不同）全绿)
  verify: node scripts/assert/entity-grounding.mjs
  risk: low

- [x] F182 （P0 机制/行动经济学，第29轮走查）守关者血量跨撤离回满：连打守关者 75→61→38 后「逃跑」成功，再「前进」回房叫阵，播报仍是「石像守卫 HP 75/75」——之前的伤害全部白打，消耗战/嗑药/用防御拖回合这套玩法直接失效（唯一的正确打法变成「一次打到底」）。要求：① 守关者（boss 场景的守关怪）剩余 HP 必须随存档持久化，撤离后再叫阵仍是上次的剩余值，只有真正击杀才清零；② 若撤离后守关者 HP 真的恢复，必须在播报里明说「它已经站起来了 / 恢复如初」这类世界内解释，不许静默回满；③ 普通小怪遭遇（非守关者）保持现状（每次遭遇满血），不得顺手改成全局持久；④ 不改任何伤害/命中数值。断言：`node scripts/assert/boss-hp-persistence.mjs` —— 新档推进到 ch1 守关房，攻击 2 回合记下 `combat.enemy.hp`（应 < 满血），逃跑成功后再次叫阵，断言剩余 HP 与撤离前**逐点相同**（不得等于 max_hp）；再攻击至击杀，断言下一章/再入房间为满血新战斗；旧码上必红
  verify: node scripts/assert/boss-hp-persistence.mjs
  risk: med
- [x] F183 ✅ (2026-11-17 devin) （P1 文本质量，第29轮走查）被守关者逼退时每按一次「前进」都复读整块数字提示：第 1/2/3 次被逼退，正文尾都挂同一段约 150 字的「【系统】状态提示——你的 HP 94/100 · 94%。「石像守卫」HP 75，估算每回合能对你造成约 10–16 点伤害。说「休息」…（本章还可休息 3/3 次）」——三句话只换了字数（第 1/2/3 次），读第三遍就是噪音。要求：① 第一次被逼退给完整提示（含数字与三条下一步），第 2 次起只给一行 20–40 字的行动指引（含「攻击」/「叫阵」动作词 + 第 N 次计数），不得再重复 HP/伤害估算块；② 换场景或真正交战后计数重置，恢复完整提示；③ 不删任何可执行动作词（「攻击」「叫阵」「休息」「道具」）的首次出现，既有 gate/refusal 类断言不得放宽。断言：`node scripts/assert/gate-refusal-hint-spam.mjs` —— 新档进入守关房后连发 5 次「前进」，断言第 1 次含「估算」与「攻击」，第 2–5 次均**不含**「估算」、均含「叫阵」、且五次正文互不完全相同（含次数）；旧码上必红
  verify: node scripts/assert/gate-refusal-hint-spam.mjs
  risk: med
- [x] F184 ✅ (2026-11-17 devin) （P1 行动经济学，第29轮走查）「潜行」烧 MP 但世界毫无变化：新档连潜 4 次，MP 20→0，正文只有两句模板交替（「贴着石柱阴影滑步」/「沿墙根移动」），场景、遇敌率、任何可见状态都不变——玩家花光全部魔力换了两句同义描写。要求：① 潜行必须有可观测收益：降低「下一幕」遇敌率（并在回包里写明「下一步更难被发现」），或给出可见的潜行增益回合数（存档字段 + 行动栏/正文显示）；② 连续潜行时第二句起不得与上一条逐字相同（按 save 计数轮换）；③ MP 不足的拒绝文案与现有 `MP 不足——「潜行」需要 5 MP` 口径保持一致（不得改写成同义不同句）；④ 数值（5 MP/次）不动。断言：`node scripts/assert/sneak-has-payoff.mjs` —— 新档连潜 3 次，断言 MP 逐次 -5、三次正文两两不同、每次正文含增益承诺词（`更难被发现|不易被发现|潜行增益|未被察觉`）；随后「前进」3 次，断言至少一次回包里「未触发遭遇」的遇敌抑制可见（或遇敌概率字段下降）——旧码上必红
  verify: node scripts/assert/sneak-has-payoff.mjs
  risk: med
- [x] F185 （P2 可用性，第29轮走查）交战态行动栏整组换五键，却没有任何一行说明「为什么不能前进」：走查时开战后我下意识再找「前进」，按钮消失、页面也没有解释，只能自己猜主线被暂停了。要求：① 交战态在行动栏上方渲染一行说明（role=note）：交战中无法推进剧情——先打完这一场，或点「逃跑」脱身；② 非交战态不渲染该行；③ 与既有 `.rest-hint` 视觉语言一致（弱对比小字、▪ 前缀），390×844 下无横向溢出、四键/五键布局不受影响；④ 不改任何服务端逻辑。断言：`node scripts/assert/combat-lock-hint.mjs` —— 新档进守关房开战，断言 `footer.actions` 上方存在含「无法推进剧情」与「逃跑」的提示且可见；脱战后该提示消失；390 视口 `scrollWidth-clientWidth===0`；旧码上必红（该文案不存在）
  verify: node scripts/assert/combat-lock-hint.mjs
  risk: low
- [x] F186 ✅ (2026-11-17 devin) （P2 可用性，第29轮回归暴露）390×844 交战时行动栏上方同时挂着两条近义浮层：「交战中无法推进剧情 · 先打完或「逃跑」脱身」（F185b 新增）与既有的「交战中无法写入存档 · 先「逃跑」或打赢这一场」——两句都以「先打完/逃跑」收尾，视觉上像同一件事说了两遍，还把日志区下缘挤得更挤。要求：① 窄屏（≤880px）交战时只显示**一条**合并提示，语义同时覆盖「不能存档」与「不能推进剧情」，且两条信息都不能丢；② 桌面（>880px）保持「行动」标签行内后缀那条（零行高），并让存档提示仍按原条件显示；③ 不得打红 `save-blocked-hint.mjs` 与 `combat-actions-ui.mjs`（前者要求交战中 `.save-blocked-hint` 存在，合并时优先让该元素承载合并文案，或在同一容器内合并渲染，不要简单 display:none）；④ `.stage ≥ 60% 视口` 与 `footer.actions ≤205px` 两条硬契约不变。断言：`node scripts/assert/combat-hint-dedupe.mjs` —— 390×844 交战中 `.actions` 上缘浮动提示**只有 1 条**（按可见的 `[role=note]` 计数），其文本同时含 `存档` 与 `推进剧情`；1440 下行动标签行内后缀存在且 `.stage` 高度不变；`combat-lock-hint.mjs` / `save-blocked-hint.mjs` / `combat-actions-ui.mjs` 三条同时绿
  verify: node scripts/assert/combat-hint-dedupe.mjs
  risk: low

### 第 29 轮验收记录（2026-11-17 cron；走查 → F182 机制车道 + F185 可用性车道 → 上线）
- 走查（390×844 / 1440×900，干净上下文，新代号 R29mA*/R29dB*）：首屏 1.17–1.45s、觉醒 1.09–1.77s、自由输入 274–404ms、前进 225–503ms、战斗回合 108–135ms、刷新续档五项逐项一致；console error 0、pageerror 0、双视口 overflow 0；四维 4/2/4/3（选择感 2 分来自守关者回满 + 潜行零收益），详见 docs/PRODUCT-REVIEW.md「第 29 轮」。
- F182 ✅ devin swe-2-high + 第二条 pass（swe-2-medium，只改断言）：`saves` 新增 `boss_hp_json`（`{chapter_id: 剩余hp}`，走既有 `PRAGMA table_info` + `ALTER TABLE` 迁移，老存档自动 `{}`）；`tryEncounter` 掷出守关者时按残留续血、`combatTurn` 每回合回写、真杀才删 key；四处遭遇播报由 `${maxHp}/${maxHp}` 改为 `${hp}/${maxHp}`（小怪 hp==maxHp 输出不变）；`guardianWarning` 报剩余值避免同回包自相矛盾。
  - 第一条 pass 的断言在 `save_id=1` 上必红：逃跑掷点 `seed=combat:${save.id}:${seq}:${turn}` 是确定性 PRNG，这一串 turn 全落「被拦下」。第二条 pass 改为多策略脱战（逃跑插攻击换 turn / 低血喝药 / db-fixture / 阵亡都可），期望值取实时 `save.boss_hp`；同库连跑 3 次 + 全新空库 1 次全绿。
  - 产品实测（线上 3020）：攻击至 61→47 后逃跑 → `boss_hp={"ch1":47}` → 再叫阵「石像守卫 HP 47/75」，预警同口径 47；击杀后 `boss_hp={}`、`boss_cleared=["ch1"]`。
- F185 ✅ devin swe-2-medium：`client/src/App.tsx` 在 `.actions-main` 内按 `liveCombat` 渲染 `.combat-lock-hint`（role=note，▪ 前缀，文案含「无法推进剧情」「逃跑」），分析样式追加到 styles.css 末尾（同 `.rest-hint` 的 `--faint`/`--fs-xs`）；390 实测 `scrollWidth==clientWidth==366` 未截断、五键仍 3+2、overflow 0；脱战即消失。
- 回归面（线上 3020）：flee-prose-by-enemy-kind / boss-room-readiness / boss-room-reentry-prose / combat-gate / advance-cost-transparency / action-prose-by-chapter / free-narration-ack / free-tail-jargon / entity-grounding / observe-prose-concrete / rest-disabled-hint / repetition-and-jargon / ch1-boss-beatable 全绿；`node --test` 117/117；`ci-deploy.sh` DEPLOY OK（构建 → 重启 → health 200 → 公网 200 → E2E 7/7）；部署后 `verify.sh F182` / `F185` 线上 PASS。
- 本轮新增 4 条，取 2 条做完；顺延 **F183**（逼退提示每按一次复读 150 字数字块）、**F184**（潜行烧 5MP 零可观测收益）——两条都要改 `server/index.js` 同一函数族，按「一轮一个 index.js 车道」排队下一轮。
- **本轮上线即回归并当场修掉（F185b）**：F185 第一版把提示做成一整行，390×844 下 `footer.actions` 197→218.6px、`.stage` 512→490.4px，打红 **F094 / F113 / F119** 依赖的 `combat-actions-ui` 契约（`.stage ≥ 60% 视口`，report 全表三次红）。第二条 pass 改为「桌面=行动组标签行内后缀（零行高）/ ≤880px=锚在底栏上缘的浮层小字」，并给 `combat-lock-hint.mjs` 补 f/g 两条回归锁（`.stage ≥ innerHeight×0.6`、`footer.actions ≤205px`）。修复后实测 `.stage=512.0px`、`footer.actions=197.0px`，`combat-actions-ui` / `combat-lock-hint` / e2e mobile+panels+desktop-layout 全绿，二次 `ci-deploy.sh` DEPLOY OK。
  - 副作用登记 **F186**（P2）：窄屏交战时「无法推进剧情」与既有「无法写入存档」两条浮层并存，语义重复、字面都以「先打完/逃跑」收尾，下一轮合并成一条。
- 既有顺延不变：F078 / F093 / F097 / F102 / F128 / F138（risk high 或需人工确认）。

### 第 28 轮验收记录（2026-11-17 cron；走查 → F178/F180/F181 文本车道 + F177 可用性车道 → 解 F092 契约冲突 → 上线）
- 走查（390×844 / 1440×900，干净上下文，新代号走查B*）：首屏 1.57–2.19s、觉醒 1.79–2.52s、自由输入 10–11ms、前进 6–30ms、战斗回合 2–53ms、面板 820–883ms；连点前进第 3 次触发石像守卫、7 回合击杀 → Lv.2 / HP 168/168 / 属性点 +3 / XP +75 / 金币 +20 / 石核 ×1；刷新续档逐字一致；console error 0、pageerror 0、双视口 overflow 0；四维 4/3/5/3，详见 docs/PRODUCT-REVIEW.md「第 28 轮」。
- F178 ✅ devin swe-2-medium（两条 pass）：observe 正文改 `「场景名」——实体细节（仍可说「观察」再看一处，或说「前进」）`，删「你放慢呼吸，重新审视」；`observeCount` 改认共用常量 `OBSERVE_MARK`，避免改措辞把轮转清零。顺带打红已勾选 F092 的 `action-prose-by-chapter.mjs`（它钉死旧前缀），第二条 pass 只改该断言：标题改取 `^「(.+?)」` + 新增「不得含『重新审视』」负向锁，其它口径（免费 / <120 字 / 不复读整幕 / 分章池）一律不动。
- F180 ✅：`dedupEcho()` 在 pickup / deny / 词族池三条回显出口前做 `([一-鿿]{2,4})上的\1 → $1表面`，不删整句回显（F076/F129 依赖保留）。
- F181 ✅：`server/ai/entity-detail.js`（6 实体 × 4 条具象细节 + 正则抽实体），observe 与 unknownSceneLine 共用 `observeEntitySeq`（save×entity 轮换）。
- F177 ✅：`.actions-main` 内 `.rest-hint`（role=note）原样透传 `save.rest.reason`，仅禁用态渲染、交战态随四键整组消失；styles.css 末尾追加弱对比小字。
- 回归面（线上 3020）：action-prose-by-chapter / free-narration-ack / free-tail-jargon / free-input-intent / no-placeholder-prose / observe-prose-pool / ai-degraded-parity / ai-prose-fastpath 全 RC=0；221→233 单测 0 fail；`ci-deploy.sh` DEPLOY OK（构建 → 重启 → health 200 → 公网 200 → E2E 7/7）。
- 线上实拉复核：`我抬头看了看头顶的裂缝` → 「D 级委托·石门之下」——头顶的裂缝比远看时宽得多…（同实体第二次换文）；`我蹲下检查石阶上的刻痕` → 「指尖划过刻痕表面：太浅…」；休息灰置时四键下方出现「▪ 体力与魔力俱满，无需休息」。
- 本轮新增待办 2 条（F180 / F181），本轮全部做完；顺延：F078 / F093 / F097 / F102 / F128 / F138（risk high 或需人工确认）。

### 第 27 轮验收记录（2026-11-17 cron；走查 → F173/F176 双车道 → 解 F157 契约冲突 → 上线）
- 走查（390×844 / 1440×900，干净上下文，新代号）：首屏 1.1–1.5s 可开始、前进 6–76ms、自由输入 30–68ms、战斗回合 9–56ms、面板 554–763ms；一路打到 ch1 7/7 出现章节结算与「进入第2章」按钮（无死路）；刷新续档精确；console error 0、双视口 overflow 0；四维 4/3/5/3，详见 docs/PRODUCT-REVIEW.md「第 27 轮」。
- F173 ✅ devin swe-2-medium：`CHAPTER_ENTRY_NOTES` 4 变体按章号确定性轮换（同章可复现、ch1–ch3 互异）、去掉「未耗体力 / HP N · MP N」机制口径、等待态「系统处理中」→「正在书写……」；新增 `scripts/assert/repetition-and-jargon.mjs`（注脚非机制口径 / 变体互异 / route 延迟 2.5s 时 `.pending` 非内部术语且随后消失 / console 0 + 无溢出）。红证：旧码「章首注脚仍是机制口径」。
- F176 ✅ devin swe-2-medium 两轮：`unknownTailShown` 按 save_id 计数——首次给完整指令表，之后只给「仍可：观察 · 前进」；`遇敌率随疾行上升` → 「你的脚步越快，惊动的东西就越多」；新增 `scripts/assert/free-tail-jargon.mjs`。第二轮专治契约冲突：第一轮把后续尾巴置空后，已勾选 `free-narration-ack.mjs`（F157）立刻红（「(a) send#2 must still offer executable verbs」）——按「短动词提示」口径修复，F157/F166/F137 与 F176 自身断言同时绿。
- 回归面（main 隔离实例）：F157 / F166 / F173 / F176 / F161 / F137 / F118 / F129 / F076 / F170 全 PASS；`node --test` 0 fail；`run-all` 7/7；`ci-deploy.sh` DEPLOY OK（构建 → 重启 → health 200 → 公网 200 → E2E 7/7）。
- 线上实拉复核：章首注脚已是玩家语言；第 1 句散文后仍给完整表、第 2 句起不再复读；兜底回包带「仍可：观察 · 前进」。
- 新发现（转 F178，本轮未做）：observe 分支（`server/index.js:2312`）对散文回通用模板「你放慢呼吸，重新审视「场景」」且不给可执行动词——F157 只覆盖 unknown 兜底，observe 分支漏网。
- 顺延：F177（休息灰置无理由）、F078/F093/F097/F102/F128/F138（risk high 或需人工确认）。

### 第 26 轮验收记录（2026-11-17 cron；走查 → F171/F172 → 上线即现回归 F174 → 断言对齐 F175）
- 走查（390×844 / 1440×900，干净上下文）：首屏 0.4s 可开始、前进 425–479ms、战斗 6 回合无死路、刷新续档精确、console error 0、双视口 overflow 0；四维 4/3/5/3，详见 docs/PRODUCT-REVIEW.md「第 26 轮」。
- F171 ✅ devin swe-2-high：`server/load-env.js`（无依赖读仓库根 `.env`，已存在键不覆盖）+ `gateway.js` 供应商解析（OPENCODE_GO 优先、`AI_ALIYUN_*` 兜底、不带 `x-opencode-session`）+ `scripts/assert/ai-provider-config.mjs`（fetch 桩四组断言）。线上效果：AI 网关从「no API key configured」变为真正可调用。
- F172 ✅ devin swe-2-high：≥1200px 主列居中（`--side-w`/`--main-w`，实测 1440 下 `.stage-col` x=303 w=824 中心 715 vs 视口中心 720）、`.key-badge` 收进按钮右下角 opacity .5 / 10px、底栏单列同版心；断言 `scripts/e2e/desktop-layout.mjs`（旧码红证：中心偏离 150.5px）。
- F174 ✅ devin swe-2-max：`/ai-action` 散文快路径（`echoRequired()===false` 不打网关，直接 `resolveAction`，degraded 保持 falsy）+ 指令形态网关 6s 超时；断言 `ai-prose-fastpath.mjs`（旧码红证：20s 才回；新码 22ms）。线上实测：同一句散文由 **12.1s + 误判补给播报** → **77ms + 「可这里没有你说的石阶」**。
- F175 ✅ devin swe-2-high + 调度器收尾：`ai-degraded-parity.mjs` / `degraded-banner.mjs` 改为自起「无 key 隔离实例」验证降级（真实 `degraded:true` 证据保留），线上（AI 可用）改为断言「与 `/action` 正文逐字一致 + 不得出现通用观察模板」；`flee-guidance-wording.mjs` 目标改为 `E2E_BASE_URL||线上`。
  - 本条 devin 在 F168 上跑到 25 分钟超时（`locator.isEnabled()` 对不存在的元素会等满 20s × 40 次），按回退规则由调度器接手：`count()` 预判 + 500ms 超时、第二场遭遇改用全新存档（旧写法撤出后已到章尾必红）、变体池断言改比对整段舞台文本。3 连跑 PASS（13.2 / 9.7 / 12.9s）。
- 回归面：F171/F172/F174/F175/F118/F168/F170 全 PASS；`node --test` 238/238；`ci-deploy.sh` 两次 DEPLOY OK，`run-all` 7/7。
- 顺延：F173（降级尾注/前进模板重复，低风险文本）、F078/F093/F097/F102/F128/F138（risk high 或需人工确认）。

- [ ] F187 （P1 节奏/文本，第30轮走查）守关战落地那一刻一屏塞进 6 段：正文（巨像的拳落下来…）+【遭遇】+【提示：撤离】+【任务：每日任务完成】+【系统：状态提示——你的 HP 94/100 · 94%。「石像守卫」HP 75，估算每回合能对你造成约 10–16 点伤害……】——玩家要读完最后一行才敢按「攻击」，而这一屏真正要他做的只有一个动作。要求：① 落地开战只留三件事：敌方 HP、我方 HP、下一步该按什么（一行）；② `guardianWarning` 在落地开战路径上压成一句（`它 HP 75，每回合约 10–16 点；你有 94/100`），只有 HP<60% 时才展开完整恢复指引；③【遭遇】【提示】【任务】三条系统行合并为一条或两条，任务奖励行放末尾一句；④ 不得删「逃跑」/「攻击」/「道具」等动作词，`flee-guidance-wording` / `combat-*` 既有断言不得放宽。断言：`node scripts/assert/combat-open-brief.mjs` —— 新档推进到守关战落地，断言该次回包里「【」开头的系统段落 ≤ 2 段、正文总长 ≤ 320 字、含「攻击」与「逃跑」、含实测敌方 HP 数字；旧码上必红
  verify: node scripts/assert/combat-open-brief.mjs
  risk: med

- [ ] F188 （P2 行动经济学，第30轮验收发现）潜行额度满时仍白扣 5 MP：`stealth_charges` 上限 2，连潜第 3 次正文仍是「（魔力消耗 MP 10→5）【潜行】…（潜行 2/2）」——额度没有涨、世界没有任何变化，玩家却继续付 5 MP，属于「花钱买同一句话」。要求：① 额度已满（2/2）时「潜行」要么拒绝并如实说明「气息已沉到极致（潜行 2/2），先走一步再看」，要么给出等价收益（例如顺带回复少量状态/明确「再潜一次不叠加」）；② MP 不足的既有拒绝文案不动；③ 数值（5 MP/次、上限 2）不动。断言：`node scripts/assert/sneak-at-cap.mjs` —— 新档连潜 3 次，断言第 3 次要么 `refused:true` 且 MP 不变、要么正文明说「不叠加/已满」；两种情况都不得出现「额度未变但 MP 照扣」的静默浪费
  verify: node scripts/assert/sneak-at-cap.mjs
  risk: low

- [ ] F189 （P1 文本厚度，第31轮走查）战斗回合播报是模板复读：实测石像守卫一战 6 个回合里有 4 个回合的正文完全逐字相同——「第N回合 · 你的攻击命中石像守卫，造成 14 点伤害。 · 石像守卫的反击命中你，造成 10 点伤害。」玩家连按「攻击」时读到的是同一句话，只有敌方阶段阈值（50%/25%）才插一态度描写。要求：① `server/engine/combat.js` 的 `strike()` 命中/未命中/暴击文案改为按 `(side, turn, enemy.seq)` 轮换的 ≥3 条变体池，且必须保留「命中/造成 N 点伤害」这类可被既有断言解析的事实子串；② 同一场战斗内相邻两回合不得出现逐字相同的整句（同一事件类型的变体轮换不得回退到同一条）；③ 数值、RNG 抽取顺序完全不变（同 seed 下 hp/mp/敌 hp 逐回合与旧版相等，`server/engine/combat.test.js` 全绿）；④ **只允许改 `server/engine/combat.js` 与其测试文件，严禁改 `server/index.js`**（该文件本轮有另一条车道在改）。断言：`node scripts/assert/combat-round-variety.mjs` —— 新档打到一场 ≥4 回合的战斗，断言相邻回合正文不全等、每回合仍含「造成 N 点伤害」事实、同 seed 数值序列不变；旧码上必红
  verify: node scripts/assert/combat-round-variety.mjs
  risk: med

- [ ] F190 （P2 可用性，第31轮走查）「重新登记（换猎人代号）」一键把玩家踢回觉醒首屏，全程没有任何二次确认：它和「关键1/武器1/防具1/消耗品2/材料」这些背包分页标签同处一个抽屉，位置在分页面板最下方，误触代价是整局上下文消失（虽然原代号可找回，但玩家当下以为自己把档删了）。要求：① 点击后弹一次确认（原生 `confirm` 或站内确认条皆可），文案点明「存档仍在服务器，用原代号可找回」；② 确认后行为与今天完全一致；③ 既有的「另起新档（旧档将无法在此浏览器找回）」提示不得删。断言：`node scripts/assert/rebind-confirm.mjs` —— Playwright 打新档→开抽屉→点「重新登记」，断言出现确认层且未直接跳回觉醒首屏；取消后仍在游戏内
  verify: node scripts/assert/rebind-confirm.mjs
  risk: low

- [ ] F191 （P2 数值可信，第31轮走查）战斗面板「每回合预估 承伤 ~7」与实测不符：石像守卫一战 6 个回合实际每回合稳定 −10（分别 10/10/10/10/10/0），面板给的 `承伤 ~7` 偏低 30%，而攻 16 预估实际打出 14。玩家靠这个数字判断「还能撑几回合」，估错就白送一条命。要求：① 面板承伤/攻击预估与 `resolveTurn` 同口径（含暴击上下限与 undodgeable 系数），或改成区间显示（`9–16`）并标注「按不暴击/暴击上限」；② `guardianWarning` 的 10–16 区间若与实际一致则保持，不得为了对齐面板而收窄；③ 数值公式本身不动，只改展示口径。断言：`node scripts/assert/combat-estimate-caliber.mjs` —— 打一场 ≥4 回合的战斗，实测每回合承伤必须落在面板给出的区间内（闭区间），失败打印逐回合实测值
  verify: node scripts/assert/combat-estimate-caliber.mjs
  risk: low
