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
- [x] F099 技能面板显示引擎算出的预计伤害区间：面板写「威力 24」而实战仅 1 点伤害（差 24 倍），玩家按面板决策必然误判。改为服务端下发 damage_preview（min–max），面板与战斗日志同源 ✅ (2026-11-16 cron devin; combat.js 抽出 `computeDamage`/`damageRange`，`strike`/`resolveTurn` 与 preview 同源；index.js 技能视图下发 `damage_preview{min,max}`；SkillsPanel/CombatPanel/App.tsx 全部改「预计伤害 min–max」，无裸「威力」；实测 tiger_fury power24 → 26–49，30 次实放全落区间)
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
- [x] F103 死亡回包自相矛盾：`你倒下了，战斗结束。` 紧跟 `【战斗】撤离失败，X 仍堵在面前——你寸步未移。`（交战中「前进」致死分支仍拼撤离失败文案）。要求：死亡即收束，不得再拼回合/撤离失败句；五条死亡日志统一形态 ✅ (2026-11-16 cron devin; `advanceWithEncounter` 对 `hp<=0` 直接返回死亡结算、`combatTurn` 致死回合清空战报，settleDeath 播报成唯一收尾；`death.mjs` 驱动改「交战中前进→撤离掷逃反击致死」并加负向词表（撤离失败/仍堵在面前/寸步未移），隔离实例 3 连跑全绿、stash 服务端修复后红证指向「撤离失败」)
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
- [x] F108 页脚固定文案写成「面板 5–0」（应为 5–9，0 无快捷键）：改成 `面板 5–9` 或按视口只显示「5–9 / ESC」 ✅ (2026-11-16 cron; 断言 `panel-affordance.mjs` 绿)
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [ ] F109 行动栏「休息」角标与快捷键并排读作「休息 3 4」（`rest-count` + `<kbd>4</kbd>`），与旁边「潜行 3」混淆：角标带单位（`剩 3`）或改 `3/3` 徽标并与 kbd 视觉分离
  verify: node scripts/assert/panel-affordance.mjs
  risk: low
- [ ] F110 「防御」回合无防御叙述：日志只有 `第3回合 · 地下城狼的反击偏离了目标，没有命中你。`，玩家看不到自己做了什么；补「横刀格挡」类叙述并从引擎取减伤数值
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
- [ ] F118 AI 降级零提示：`/ai-action` 回 `degraded:true` 时前端无任何提示，正文是与「环顾四周」首句逐字相同的模板句。要求：降级时气泡尾加「（系统叙事降级：按规则解析）」，观察模板句按场景轮换 ≥3 句
  verify: node scripts/assert/degraded-banner.mjs
  risk: low
- [x] F119 （并入 F113）移动端 390×844 `footer.actions` 实测 y=483 h=361 = 视口 42.8%，17 个按钮三行堆叠，正文区仅 483px。要求同 F113：战斗组非交战态折叠为单行入口、系统组收进抽屉，正文区 ≥60% 视口 ✅ (2026-11-16 cron，随 F113 落地；实测 footer 181px(21.4%)、正文 528px(62.6%)，断言并入 `combat-actions-ui.mjs` (e) 段)
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: med
- [ ] F120 「休息」连续两次正文拼接重复：「体力一点点回到四肢。体力与魔力一点点回流，…」。要求：休息叙述按回合轮换且不重复上一句
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
- [ ] F126 部署/验收脚本继承泄漏的环境变量导致假红与**误回滚**：本轮 `ci-deploy.sh` 第 8 步 E2E 因 shell 里残留的 `E2E_BASE_URL=http://127.0.0.1:3082/game` / `API_BASE=…:3082` 打到不存在的端口，5/5 全红 → 触发 `rollback.sh` 把 `client/src` 检出回旧 ref（服务端仍是新代码），线上变成「新后端 + 旧前端」的混合态，且工作区出现 staged 反向改动。要求：`ci-deploy.sh` 与 `rollback.sh` 开头 `unset E2E_BASE_URL API_BASE E2E_NO_CLEANUP SL_VERIFY_API_BASE`（或用 `env -u` 包住 node 调用）；`rollback.sh` 只回滚构建产物/重启，不得改写 `client/src` 工作区（改 `git checkout $REF -- client/src` 为备份+构建，或回滚后 `git reset --hard` 前先拒绝在有未提交改动时执行）；`map-interactive` 类断言若连不上端口应报「环境错」而不是「业务回归」
  verify: node --test scripts/e2e/ci-deploy-env.test.mjs
  risk: med
  - 2026-11-16 03:35 追加（升级为生产事故）：线上 pm2 进程带着 `DB_PATH=/tmp/mut.db` 跑了 1h45m，真实玩家存档全部写进 /tmp（已合并回 `data/game.db`，旧库留档 `.bak-20261116-033300`）。除 `unset` 外还要求：`ci-deploy.sh` 显式固定 `DB_PATH=/www/Solo-Leveling/data/game.db`（不依赖缺省值）；`/api/health` 回包带上 `db_path`，部署第 6 步断言其等于预期；`rollback.sh` 重启时同样固定 DB_PATH。
- [ ] F127 `scripts/report.sh` 全表汇总存在系统性假红：2026-11-16 02:35 / 02:42 两份报告都报 31 项 FAIL（PASS 38/39），但把同样的 FID 逐条单跑与按报告顺序串行复跑（F110→F117）**全部 PASS**（F112 24.06s、F113 26.37s、F116 10.74s、F117 16.40s）。现象集中在 UI/Playwright 类断言的超时型失败，怀疑 report.sh 的 `vout="$(./scripts/verify.sh "$fid" | tail -1)"; rc=$?` 取到的是 tail 的状态、或串行跑时未给每个断言独立 settle 预算（前一条断言的浏览器/DB 残留未清）。要求：`rc` 改为 `set -o pipefail` 下的显式 `if ! out=$(...)` 判定并保留完整输出到报告；每条断言跑前清 `e2e-*/verify-*` 存档；对超时型失败重跑一次再判；报告里 FAIL 行必须附断言原始错误行（现在只有 `[VERIFY] X FAIL`，无从定位）
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
- [ ] F131 撤离文案把「守关者残骸」模板套在普通精英怪上：从毒牙蛇（非守关者、且从未被击杀）撤离时播报「你且战且退，撤回了「惩罚副本」——守关者的残骸在身后缓缓凝聚」。要求：撤离文案按敌型与 boss_cleared 分支（普通怪=「它没有追出来」、已击杀 boss=残骸、未击杀 boss=仍守在门后），断言：普通遭遇撤离回包不得含「守关者」「残骸」
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
- [ ] F142 拒绝往来不落库（minor）：refused 的输入与警告零日志，刷新后「离开这里」连同「你无法撤离」一并消失，玩家回查无据；F137 把更多日常输入变成 refused 后「被抹掉的对话」变多。要求：refused 输入仍写一条 user 日志 + 一条 system 拒绝文案（不产生任何数值结算/位移），或明确在回包标注 `logged:false` 并让前端保留本地气泡。断言：封门拒绝后 `GET /api/saves/:id` 的日志含该输入与拒绝文案，且 hp/mp/xp/scene 零变化。
  verify: node scripts/assert/refused-log-visibility.mjs
  risk: low
- [x] F143 面板直开只认裸名（minor）：「背包」能开面板，但「打开背包」→ unknown 吃兜底、「看看背包」被裸「看」抢成 observe。要求：`打开/查看/看看/打开我的/给我看` + 面板名 一律路由到对应面板（F129 的整句锚定原则不变，长句叙述不得被吞）。断言：「打开背包」「看看背包」「打开我的属性」均回 `panel`；「我打开背包发现里面空了」不得回 panel。 ✅ (2026-11-16 cron devin swe-2-high; `server/index.js` 的 `PANEL_ROUTES` 抽出 `PANEL_VERB = "(?:打开我的|给我看|打开|查看|看看|瞧一瞧|看一下|调出|显示)?\\s*"` 并前置到六条路由（整句锚定不变，长句首尾对不上锚点照走意图解析）；新断言 `panel-open-verbs.mjs`（14 组动词+名/裸名 → 正确 panel 且 hp/mp/scene/xp 零副作用；「我打开背包发现里面空了」「他打开地图看了一眼就合上」回包无 panel；/ai-action 同口径）；隔离实例 2 连跑全绿，旧码红证「打开背包 → intent=unknown，panel=undefined」；**契约冲突已处理**：F129 的 `no-placeholder-prose.mjs` 原把「查看背包」当反面用例，现改成长句叙述「我查看背包，里面只剩一把断剑」（整句锚定强度不变，「打开地图看看」反例保留），F129 线上复跑 PASS)
  verify: node scripts/assert/panel-open-verbs.mjs
  risk: low

## 第 18 轮试玩新增（2026-11-16 10:43，cron；线上真机 58 步，Lv.1→Lv.2，桌面 1440×900）
- [ ] F144 （major）战斗中「使用道具」不可指定物品且按背包顺序乱烧资源：交战中输「使用治疗药水」被拒（只认裸「使用道具」），再输「使用道具」时系统挑了「魔力药剂」（MP 16/20 时回蓝），第二次才轮到治疗药水。要求：`item` 意图支持「使用/喝 + 物品名」（复用既有供给解析，交战中也要生效），裸「使用道具」在多个可用补给中按**当前最缺**（HP 百分比低于 MP 时优先治疗）选取，并在播报里点名选了哪件。断言：交战态输「使用治疗药水」→ 消耗的是治疗药水（该栈 -1、mp 不变）、HP 上升；裸「使用道具」在 HP 60%/MP 100% 时不得消耗魔力药剂
  verify: node scripts/assert/item-target-in-combat.mjs
  risk: med
- [ ] F145 （major）脱战完全不能用补给、恢复通道只剩「休息」配额：战斗后残血输「使用道具」→「殿里没有迫近的威胁——补给留到石像真正动起来时再用。」，输「喝治疗药水」→ 未识别。休息有 3/3 配额，配额耗尽 + 残血 = 只能残血硬闯，接近设计死路。要求：脱战允许「使用道具」/「喝 <药名>」回血（零战斗结算、占一条日志、不推进场景），或明确给出替代恢复路径（「休息 x/3」「回城/章节回溯」）并让「使用道具」指路。断言：脱战残血存档输「使用道具」→ HP 上升且消耗一件治疗类补给；若不改这一条，则回包必须同时含剩余休息次数与一条可达的恢复方式（不得只说「留到战斗再用」）
  verify: node scripts/assert/out-of-combat-supply.mjs
  risk: med
- [ ] F146 （minor）未识别兜底固定追问「你是想攻击还是想离开？」与语境无关、且不指路面板专属操作：脱战输「喝治疗药水」「加点力量」「跳」都回同一句尾巴；而「加点力量」「装备猎刀」这类面板操作明明有可行路径（属性面板 +1、背包点装备）。要求：兜底问句按语境生成（脱战不再问「攻击还是离开」），并在命中「加点/属性点/装备/卸下」等词时给一句指路（「属性点请到属性面板分配」/「装备请到背包点『装备』」）。断言：脱战未识别输入的回包不得含「你是想攻击还是想离开」；「加点力量」「装备猎刀」回包须含对应面板名
  verify: node scripts/assert/unknown-followup-context.mjs
  risk: low
- [ ] F147 （minor）开局配发装备不自动穿、属性面板写「无配发装备」与播报矛盾：建档播报「猎人协会向你配发基础装备」，但武器/防具位「空置 —」，生锈猎刀、旧皮甲躺在背包里要手动装备；属性面板装备栏还显示「无配发装备」。Lv.1 没发现要手动装备 = 裸身打 Lv.3 守关者。要求：建档即装上配发的基础武器/防具（或播报改成「配发了……请到背包装备」并让首个观察提示），属性面板装备栏与 save 的装备字段同源。断言：新档 `GET /api/saves/:id` 的 weapon/armor 非空且攻击力含武器加成；属性面板装备栏文案不含「无配发装备」
  verify: node scripts/assert/starter-gear-equipped.mjs
  risk: med
- [ ] F148 （minor）背包「N 件」计数与 API 物品栈不符、关键道具不可见：击杀后背包面板显示「7 件」，`GET /api/saves/:id` 返回 8 个物品栈（含 `gate_shard`×2）——传送门碎片既不计入「件」也不在任何分类页，玩家看不到自己持有的关键道具。要求：计数口径与列表一致（不可见就不计数、或给出「关键道具」页签并显示），分类页不得静默吞物品。断言：构造含 `gate_shard` 的存档，背包面板「N 件」数值 = API 可见物品栈数，且每个栈都能在某个页签里看到
  verify: node scripts/assert/bag-count-consistency.mjs
  risk: low
- [ ] F149 （待验证）HP 归零死亡/回溯流程本轮未实测（Lv.1 却打赢了 Lv.3 守关者，没能送死；升级后 168 HP 更难死）：下一轮用连续作战/惩罚副本专项送死，验证 HP→0 是否有可读死亡播报 + 回溯落点 + rest 回满，而不是静默回血。断言脚本在演练后补，不要用现有 `death.mjs` 代替（它只覆盖 ch1 固定路径）
  verify: node scripts/assert/death-probe-live.mjs
  risk: low
