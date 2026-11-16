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
- [ ] F084 日志可回溯：前端不再固定只取最近 50 条，提供「加载更早」分页（服务端 limit 已支持 200）
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
- [ ] F099 技能面板显示引擎算出的预计伤害区间：面板写「威力 24」而实战仅 1 点伤害（差 24 倍），玩家按面板决策必然误判。改为服务端下发 damage_preview（min–max），面板与战斗日志同源
  verify: node scripts/assert/skill-damage-preview.mjs
  risk: med
- [ ] F100 quest-settlement 断言补强：「无敌人时释放技能 猛虎猛击」不得推进每日「力量校准」（现有 (c) 只覆盖不存在的技能名，变异测试可通过 → 假绿）
  verify: node scripts/assert/quest-settlement.mjs
  risk: low

## 第 6 轮试玩新增（2026-11-15 22:1x，独立审查；F096 已修）
- [ ] F101 断言口径反向锁定缺陷：`chapter-gate.mjs` 的 `observeFree()` 断言「观察回复必须包含场景正文前 12 字」——等于把 F092 的「整幕复读」写成绿线；同理原「第 8 推过门进第 2 章」把软门+可绕过写成期望值（本轮已随 F096 改口径）。要求：观察断言改为「两次观察文本互不相同且 < 120 字、标题取 scene_title 而非敌人名」，并补一条负向断言（复读整幕时 FAIL）
  verify: node scripts/assert/observe-short.mjs
  risk: med
- [ ] F102 章节解锁口径三处不一致：地图 Ch.8 写死「需 Lv.70」、`chapter_unlock.level` 回包是 40、`chapters.json` 的 `unlock.level` 又是第三个值；玩家看到「锁定 · 需 Lv.70」却能直接走进去（F093 软门）。要求：地图/回包/数据单一事实源（`/api/chapters` 下发 `unlock.level` 与 `unlocked/blocked_reason`），前端不再写死数字；软门期间锁定态与「已开启」播报不得并存
  verify: node scripts/assert/chapter-unlock-single-source.mjs
  risk: med
- [ ] F103 死亡回包自相矛盾：`你倒下了，战斗结束。` 紧跟 `【战斗】撤离失败，X 仍堵在面前——你寸步未移。`（交战中「前进」致死分支仍拼撤离失败文案）。要求：死亡即收束，不得再拼回合/撤离失败句；五条死亡日志统一形态
  verify: node scripts/assert/death.mjs
  risk: low
- [ ] F104 通关页残留开发备注：结算面板写「注：战斗统计未接入，总击杀暂记「—」。」，而 `stats.kills` 有真实值。要求：删除该备注，`总击杀` 与存档 kills 同源渲染
  verify: node scripts/assert/ending-stats.mjs
  risk: low
- [ ] F105 验收脚本自身的可复现性：`ending-closure.mjs` 把默认端点写死 `127.0.0.1:3089`（隔离实例），导致 `scripts/report.sh` 里 F089 永远 FAIL（其它断言默认 3020）；`map-interactive.mjs` 在 report 顺序跑时偶发 20s+ 超时（本轮 report 记 FAIL，单独连跑 3 次全绿）。要求：统一默认端点为 `_http.mjs` 的 3020（仍允许 API_BASE 覆盖），并给 Playwright 断言加 settle 等待 + 一次重试
  verify: node scripts/assert/map-interactive.mjs && node scripts/assert/ending-closure.mjs
  risk: low

## 第 7 轮试玩新增（2026-11-15 23:1x，cron；F092/F098 同轮已合并）
- [x] F106 （阻断）门拒绝分支仍在扣资源：ch1 守关者未击杀时点「前进」回包 `【主线】「石像守卫」的威压仍封着出口——你无法越过守关者，只能退回「敬拜」。（体力消耗 HP 78→75 · MP 1→0）`——无位移、无推进却照扣 3 HP / 2 MP 并写消耗日志，连点可原地耗死（与 F096 声称的 refused 零消耗矛盾）。要求：所有「门未开 / 体力不足 / MP 不足」拒绝一律 `refused:true` 短路（零 HP/MP/scene/log 变更），并下发 `advance_mode` 把主按钮改写成「折返守关者」；新增 `gate-refusal-free.mjs` 覆盖守关者门、章节等级门、终章门三处 ✅ (2026-11-16 cron; 所有门拒绝 refused 零消耗 + advance_mode 换标；审查发现房内软锁另立 F121)
  verify: node scripts/assert/gate-refusal-free.mjs
  risk: med
- [x] F107 交战期装备/加点免费：**行为已由 F094 修**（实测线上交战中背包「装备」disabled + `title="交战中无法更换装备"`、面板下方提示「交战中无法使用或更换装备——补给请走战斗「道具」指令（占一回合）」），**仍缺断言**：`combat-actions-ui.mjs` 未覆盖 equip/spend。要求补 `combat-equip-gate.mjs`：交战中 `POST /item op=equip` 与 `/spend` 必须被拒且零回合零属性变化，非交战放行 ✅ (2026-11-15 cron; 新增断言 combat-equip-gate.mjs，变异验证敏感)
  verify: node scripts/assert/combat-equip-gate.mjs
  risk: low
- [ ] F108 页脚固定文案写成「面板 5–0」（应为 5–9，0 无快捷键）：改成 `面板 5–9` 或按视口只显示「5–9 / ESC」
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [ ] F109 行动栏「休息」角标与快捷键并排读作「休息 3 4」（`rest-count` + `<kbd>4</kbd>`），与旁边「潜行 3」混淆：角标带单位（`剩 3`）或改 `3/3` 徽标并与 kbd 视觉分离
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [ ] F110 「防御」回合无防御叙述：日志只有 `第3回合 · 地下城狼的反击偏离了目标，没有命中你。`，玩家看不到自己做了什么；补「横刀格挡」类叙述并从引擎取减伤数值
  verify: node scripts/assert/defend-narration.mjs
  risk: low
- [ ] F111 技能面板伤害与引擎同源（替代/合并 F099）：面板 `威力 24` 而实战命中 `造成 31 点伤害`，玩家按面板估伤害必然误判。服务端下发 `damage_preview {min,max}`（含暴击与力量系数），面板与战斗日志同一函数
  verify: node scripts/assert/skill-damage-preview.mjs
  risk: med
- [ ] F112 断言可复现性（F105 追加）：`chapter-progress-ui.mjs`（F091 的 verify）连续 3 次 FAIL——「did not reach epilogue within the landing budget」，23:08 报告起就是红的，属断言驱动方式问题（靠 N 次 UI 动作走到终章，现在有守关者门后不可达）。要求改 DB 落点构造终章前存档再走 1-2 步 UI，或直接断言顶栏 `x/y` 与 panel 数据一致（仍保留一次真实 UI 断言）
  verify: node scripts/assert/chapter-progress-ui.mjs && node scripts/assert/chapter-progress-ui.mjs
  risk: low
- [ ] F113 移动端底部操作区被战斗组撑高：F094 落地后非交战态也渲染 4 个 disabled 战斗键，390×844 下 footer 由 285px → **361px（占屏 43%）**，行动组挤成「探索前进/环顾四周/潜行/休息/攻击」5 键一行（每键 ≈62px 宽，小于四字标签的舒适宽度），叙事区只剩 ~360px。要求：非交战态把战斗组折叠成单行矮提示（或只在「战斗」二级入口里给出），交战时再展开四键；390px 下行动组最多 4 键一行。注意 F094 的断言 `combat-actions-ui.mjs` 第 (a) 段要求非交战四键 disabled 可见，改布局时同步改断言（改为「入口存在且 disabled」而不是「四个按钮常驻」）
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: low

## 第 8 轮试玩新增（2026-11-15 23:5x，cron；独立审查，47 次真实点击）
- [x] F114 （阻断）死亡回溯把 `save.scene` 退回第 2 幕（ch1_law, scene_index=1），`chapter_steps` 仍保留 4/7 → 之后每次「前进」整幕复读、进度不动却照扣 HP/MP（实测 HP 84→81→152→149），地图「当前」与正在上演的守关战不一致。要求：进度由 `scene` 单点推导（`chapter_steps = pathIndex+1`）或回溯时场景与步数同步回退且不重复计费；播报的落点必须与 `save.scene` 一致 ✅ (2026-11-16 cron; chapter_steps 由 scene 单点推导、回溯退两幕且播报取真实落点、无位移零消耗)
  verify: node scripts/assert/death-respawn-consistency.mjs
  risk: med
- [ ] F115 「回到地面/医院」场景 `ch1_surface` 仍刷地下城遭遇（石像残兵 Lv.2 HP 52/52 强制交战），叙事穿帮。要求：遭遇表按 `scene.kind` 分区或给场景 `no_encounter` 标记
  verify: node scripts/assert/encounter-scene-kind.mjs
  risk: med
- [ ] F116 （= F093 复测未过）地图 Ch.2 写「锁定 · 需 Lv.5」，Lv.4 玩家点前进即进第 2 章（OR 软门 `level_ok || chapter_ok`）。要求：`unlockedFor` 改回 AND 硬门，或地图文案改「推荐 Lv.5 · 可强行进入（受压制）」，锁定态与放行不得并存
  verify: node scripts/assert/chapter-unlock-and.mjs
  risk: med
- [ ] F117 章末 7/7 无「进入下一章」入口，切章藏在又一次扣费的「前进」里。要求：7/7 时 `advance_mode` 改主按钮为「进入第2章 · 每日任务」且该次不再扣体力
  verify: node scripts/assert/chapter-end-cta.mjs
  risk: low
- [ ] F118 AI 降级零提示：`/ai-action` 回 `degraded:true` 时前端无任何提示，正文是与「环顾四周」首句逐字相同的模板句。要求：降级时气泡尾加「（系统叙事降级：按规则解析）」，观察模板句按场景轮换 ≥3 句
  verify: node scripts/assert/degraded-banner.mjs
  risk: low
- [ ] F119 （并入 F113）移动端 390×844 `footer.actions` 实测 y=483 h=361 = 视口 42.8%，17 个按钮三行堆叠，正文区仅 483px。要求同 F113：战斗组非交战态折叠为单行入口、系统组收进抽屉，正文区 ≥60% 视口
  verify: node scripts/assert/mobile-footer-budget.mjs
  risk: med
- [ ] F120 「休息」连续两次正文拼接重复：「体力一点点回到四肢。体力与魔力一点点回流，…」。要求：休息叙述按回合轮换且不重复上一句
  verify: node scripts/assert/rest-narration.mjs
  risk: low

## 第 8 轮验收后审查（2026-11-16 01:xx，cron）
- [x] F121 （阻断，F106 回归）守关房内「前进」改为零位移 refused 后玩家没有可点的下一步：`advanceMode` 已换标「折返守关者」但人就在房内，行动栏四键在无交战时全 `disabled`（`title="当前没有可攻击的目标"`），唯一出路是在自由输入框手打「攻击」（`peacefulCombatIntent` 的 bossChallenge）——等于软锁。可达路径：守关战「逃跑」成功（F095 逃生阀）+「前进」落回房内。要求：`advanceMode` 增 `challenge_boss` 语义，主按钮改「叫阵守关者」并真 dispatch「攻击」，或该态下解禁行动栏「攻击」；房内文案指向可点按钮；`gate-refusal-free.mjs` 删掉以 `next_choices.length>0` 充当「有出路」的假绿断言，新增 UI 级断言 `boss-room-escape-ui.mjs`（真点开战）；顺带修 `saveView` 不再下发遗留 `main_steps`、F107 断言在全新 scratch DB 上因 equipment.json 残留 id 误红 ✅ (2026-11-16 devin; `advanceMode` 在 idx===idxBoss 且无交战时下发 `challenge_boss`，主按钮换标「叫阵守关者」点击真 dispatch「攻击」、行动栏与战斗面板「攻击」同步解禁（`title="守关者就在面前 — 叫阵开战"`）、快捷键 1 同义；房内 refused 文案改指「叫阵守关者」；`saveView` 停发 `main_steps`；`gate-refusal-free.mjs` 正向改断 `challenge_boss`+逐次文案点名+真开打，`chapter-boss-gate.mjs` (g) 连点 4 次，`combat-equip-gate.mjs` setup 清 stale 装备位+精确增量口径；新断言 `boss-room-escape-ui.mjs` DB 落点 sealed 态→真点主按钮→断言敌名/回合)
  verify: node scripts/assert/boss-room-escape-ui.mjs && node scripts/assert/gate-refusal-free.mjs
  risk: med
- [ ] F123 `ch1-boss-beatable.mjs`（F095 的 verify）有固有 RNG 抖动：本轮 9 连跑中 1 次报 `boss fight exceeded 12 actions`（12 动作预算边缘）。要求：把「≤12 动作打赢」改成「≤12 动作打到 HP 0 或换最优回合序列」，或把预算放宽到 16 并在断言里记录实际动作数分布（20 次采样），避免定时任务出现随机红
  verify: node scripts/assert/ch1-boss-beatable.mjs && node scripts/assert/ch1-boss-beatable.mjs && node scripts/assert/ch1-boss-beatable.mjs
  risk: low
