# FEATURES — 增量开发清单

规则：每跳只做**一个**未勾选项；勾选时在行尾追加 `✅ (<日期> <lane>)`。
`lane` 取值：`devin`（SWE-2 免费模型）或 `opencode`（deepseek-v4.1-flash）。

## [BLOCKING] 阻塞回归（全量 E2E 守门，需优先于新功能）

- [x] GE2E-20261119 回归失败（高频抖动 4/6）：`action.mjs` 第二推体力未扣，`assert failed: second advance must cost vitals (HP 100->100, MP 20->20)`（must_choose 置灰后改点选项「按石碑所写，低头敬拜」分支）｜verify: `cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/action.mjs`｜risk: high
  - 现场：2026-11-19T03:18Z 全量（commit `9bbc4b1`）28/29，`action` 9.0s FAIL；截图 `/root/logs/e2e-action-1795058316848.png`
  - 非并发污染：跑测前后 `pgrep run-all.mjs|ci-deploy.sh|vitest` 无并发；隔离单跑 6 次 2 PASS / 4 FAIL（4.3–6.3s），load1≈2.6/4 核时更易红
  - 与上次全绿同源：`git diff 205ea94..HEAD` 仅 docs 两文件，被测 bundle 构建于 revert 之后 → 既有测试/实现时序脆弱，非新改动引入
  - **根因（第87轮定位）**：断言与渲染竞态——回包先追加日志，顶栏 HP/MP 下一帧才写进 `.gauge-num`，`action.mjs` 在日志落地瞬间读数，稳定读到旧值（同场景手工探针可见 MP 20→19，体力确已扣）。修法：断言前有界等待（3s）数值变化，超时仍按原口径 FAIL——真零消耗不会洗绿。连跑 3/3 PASS，全量 34/34 PASS。
  - 待查方向：`scripts/e2e/lib.mjs:126 readVitals` 只读 DOM 文本，`action.mjs:60-66` 的 `waitForFunction` 可能被"用户回声"节点先满足、早于 save 状态回写（读到旧体力）；或「低头敬拜」确为零消耗铺陈步（此时须确认产品意图再改断言口径，禁止为过测改断言）
  - 报告：`docs/runs/e2e-20261119T031800Z.md`
- [ ] GE2E-20261118 回归失败（偶发）：`quests.mjs` 打开任务面板后 `.quest` 20s 未出现，面板落到「任务信息不可用。与系统的连接中断」错误态｜verify: `cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/quests.mjs`｜risk: high
  - 现场：2026-11-18T15:48Z 全量（commit `d9ad5f1`）13/14，`quests` 24.6s FAIL，`page.waitForSelector: Timeout 20000ms exceeded … waiting for locator('.quest')`；截图 `/root/logs/e2e-quests-1795017013973.png` 显示侧栏「任务」已选中但内容区为错误文案
  - 非确定性：同命令隔离连跑 4 次全 PASS（4–5s），紧接着全量二跑 14/14 PASS；手工 `GET /game/api/saves/<id>/quests` 返回 200 且 payload 正常 → 一次瞬时 fetch 失败，非稳定回归
  - 产品侧缺陷（真正待修）：`client/src/App.tsx:1172-1180` 的任务面板数据只做单次 `getQuests(...).catch(() => setQuestsError(true))`，失败后既无重试按钮也无自动重试，`QuestPanel` 在 `error` 时只渲染一句死文案——用户开着面板遇到一次网络抖动，任务页就被永久钉在错误态，只能切页签重新拉取。要求：失败态给「重试」入口（或 1 次自动退避重试），并在重试成功后清 `questsError`；同款隐患一并检查 `inventory`/`map`/`shadows` 三个面板
  - 报告：`docs/runs/e2e-20261118T1548Z.md`

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
- [x] F097 ✅ (2026-11-17 devin) （阻断）遭遇/守关者等级按玩家等级带宽缩放：ch2 守关者 200HP / 18 伤害、ch7「地狱之犬 Lv.19 HP185」对 Lv.3 玩家每回合打 4 点挨 44 点 → 必死循环。要求：遭遇与守关者等级钳制到 `player.level ± 2`（或与章节 `expected_level` 取小），`expected_level` 写入 `chapters.json` 并做 CI 断言；ch2 守关者应让 Lv.1–2 在 ≤12 回合内可赢
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
- [x] F102 ✅ (2026-11-18 devin) 章节解锁口径三处不一致：地图 Ch.8 写死「需 Lv.70」、`chapter_unlock.level` 回包是 40、`chapters.json` 的 `unlock.level` 又是第三个值；玩家看到「锁定 · 需 Lv.70」却能直接走进去（F093 软门）。要求：地图/回包/数据单一事实源（`/api/chapters` 下发 `unlock.level` 与 `unlocked/blocked_reason`），前端不再写死数字；软门期间锁定态与「已开启」播报不得并存
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
- [x] F128 （阻断，第36轮修复上线）第 2 章惩罚副本死亡循环：ch2 任意战斗中死亡 → 回溯到 ch2_daily_quest →「前进」唯一出口是 ch2_penalty_gate → 强制遭遇「惩罚副本·毒牙蛇 Lv.5 HP200 攻24 boss:true」，Lv.4（攻 16、伤害恒 9）需 ~20 回合、蛇每回合反击 18，玩家 ~9 回合必死；自动化实测 50+ 次循环无一脱出（deaths 3→53），且界面没有任何「撤离」提示（真正的撤离键是自由输入「前进」，按钮「逃跑」反而可能失败）。要求：战斗面板在惩罚副本给出可见目标（「存活至副本结束 N/M 回合」）与撤离指引；或让 Lv.4 在该副本有可行打法（药水/技能/等级带宽钳制，与 F097 合并考虑）；断言：脚本从死亡回溯点连续 12 次「前进」必须能离开 ch2_penalty_gate（到达别的场景或完成副本），不得 12 次都停在惩罚副本→毒牙蛇
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
- [x] F138 惩罚副本「回满血再挑战」反被打回死循环：2/3 休息召来可击杀的惩罚沙虫 Lv.4（+36XP，唯一活路），但 **3/3 休息召来的却是 Boss 本体**（「休憩被硬生生打断——惩罚副本·毒牙蛇摸到了你的藏身处」）——玩家最自然的「回满血再挑战」操作反而立刻回到必死遭遇，且位置规则不可预测。要求：惩罚副本内休息遭遇一律从「惩罚副本杂兵池」（沙虫/毒蛇 Lv.4，可击杀）取样，Boss 本体只在玩家主动叫阵/前进到守门房 3/3 时才出现；休息回包须带 `encounter_source:"rest"` 与可读提示。断言：同一存档在惩罚副本连做 3 次休息，遭遇名字不得出现「毒牙蛇」；三次休息的遭遇等级均 ≤ `player.level + 1`
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

- [x] F187 ✅ (2026-11-17 devin) （P1 节奏/文本，第30轮走查）守关战落地那一刻一屏塞进 6 段：正文（巨像的拳落下来…）+【遭遇】+【提示：撤离】+【任务：每日任务完成】+【系统：状态提示——你的 HP 94/100 · 94%。「石像守卫」HP 75，估算每回合能对你造成约 10–16 点伤害……】——玩家要读完最后一行才敢按「攻击」，而这一屏真正要他做的只有一个动作。要求：① 落地开战只留三件事：敌方 HP、我方 HP、下一步该按什么（一行）；② `guardianWarning` 在落地开战路径上压成一句（`它 HP 75，每回合约 10–16 点；你有 94/100`），只有 HP<60% 时才展开完整恢复指引；③【遭遇】【提示】【任务】三条系统行合并为一条或两条，任务奖励行放末尾一句；④ 不得删「逃跑」/「攻击」/「道具」等动作词，`flee-guidance-wording` / `combat-*` 既有断言不得放宽。断言：`node scripts/assert/combat-open-brief.mjs` —— 新档推进到守关战落地，断言该次回包里「【」开头的系统段落 ≤ 2 段、正文总长 ≤ 320 字、含「攻击」与「逃跑」、含实测敌方 HP 数字；旧码上必红
  verify: node scripts/assert/combat-open-brief.mjs
  risk: med

- [x] F188 ✅ (2026-11-17 devin) （P2 行动经济学，第30轮验收发现）潜行额度满时仍白扣 5 MP：`stealth_charges` 上限 2，连潜第 3 次正文仍是「（魔力消耗 MP 10→5）【潜行】…（潜行 2/2）」——额度没有涨、世界没有任何变化，玩家却继续付 5 MP，属于「花钱买同一句话」。要求：① 额度已满（2/2）时「潜行」要么拒绝并如实说明「气息已沉到极致（潜行 2/2），先走一步再看」，要么给出等价收益（例如顺带回复少量状态/明确「再潜一次不叠加」）；② MP 不足的既有拒绝文案不动；③ 数值（5 MP/次、上限 2）不动。断言：`node scripts/assert/sneak-at-cap.mjs` —— 新档连潜 3 次，断言第 3 次要么 `refused:true` 且 MP 不变、要么正文明说「不叠加/已满」；两种情况都不得出现「额度未变但 MP 照扣」的静默浪费
  verify: node scripts/assert/sneak-at-cap.mjs
  risk: low

- [x] F189 ✅ (2026-11-17 devin) （P1 文本厚度，第31轮走查）战斗回合播报是模板复读：实测石像守卫一战 6 个回合里有 4 个回合的正文完全逐字相同——「第N回合 · 你的攻击命中石像守卫，造成 14 点伤害。 · 石像守卫的反击命中你，造成 10 点伤害。」玩家连按「攻击」时读到的是同一句话，只有敌方阶段阈值（50%/25%）才插一态度描写。要求：① `server/engine/combat.js` 的 `strike()` 命中/未命中/暴击文案改为按 `(side, turn, enemy.seq)` 轮换的 ≥3 条变体池，且必须保留「命中/造成 N 点伤害」这类可被既有断言解析的事实子串；② 同一场战斗内相邻两回合不得出现逐字相同的整句（同一事件类型的变体轮换不得回退到同一条）；③ 数值、RNG 抽取顺序完全不变（同 seed 下 hp/mp/敌 hp 逐回合与旧版相等，`server/engine/combat.test.js` 全绿）；④ **只允许改 `server/engine/combat.js` 与其测试文件，严禁改 `server/index.js`**（该文件本轮有另一条车道在改）。断言：`node scripts/assert/combat-round-variety.mjs` —— 新档打到一场 ≥4 回合的战斗，断言相邻回合正文不全等、每回合仍含「造成 N 点伤害」事实、同 seed 数值序列不变；旧码上必红
  verify: node scripts/assert/combat-round-variety.mjs
  risk: med

- [x] F190 ✅ (2026-11-17 devin) （P2 可用性，第31轮走查）「重新登记（换猎人代号）」一键把玩家踢回觉醒首屏，全程没有任何二次确认：它和「关键1/武器1/防具1/消耗品2/材料」这些背包分页标签同处一个抽屉，位置在分页面板最下方，误触代价是整局上下文消失（虽然原代号可找回，但玩家当下以为自己把档删了）。要求：① 点击后弹一次确认（原生 `confirm` 或站内确认条皆可），文案点明「存档仍在服务器，用原代号可找回」；② 确认后行为与今天完全一致；③ 既有的「另起新档（旧档将无法在此浏览器找回）」提示不得删。断言：`node scripts/assert/rebind-confirm.mjs` —— Playwright 打新档→开抽屉→点「重新登记」，断言出现确认层且未直接跳回觉醒首屏；取消后仍在游戏内
  verify: node scripts/assert/rebind-confirm.mjs
  risk: low

- [x] F191 ✅ (2026-11-17 devin) （P2 数值可信，第31轮走查）战斗面板「每回合预估 承伤 ~7」与实测不符：石像守卫一战 6 个回合实际每回合稳定 −10（分别 10/10/10/10/10/0），面板给的 `承伤 ~7` 偏低 30%，而攻 16 预估实际打出 14。玩家靠这个数字判断「还能撑几回合」，估错就白送一条命。要求：① 面板承伤/攻击预估与 `resolveTurn` 同口径（含暴击上下限与 undodgeable 系数），或改成区间显示（`9–16`）并标注「按不暴击/暴击上限」；② `guardianWarning` 的 10–16 区间若与实际一致则保持，不得为了对齐面板而收窄；③ 数值公式本身不动，只改展示口径。断言：`node scripts/assert/combat-estimate-caliber.mjs` —— 打一场 ≥4 回合的战斗，实测每回合承伤必须落在面板给出的区间内（闭区间），失败打印逐回合实测值
  verify: node scripts/assert/combat-estimate-caliber.mjs
  risk: low

- [x] F192 ✅ (2026-11-17 devin) （P1 移动端体验，第32轮走查）390px 下「档案」抽屉打开后是个**死胡同**：抽屉内容固定是背包（标题写「档案/背包」），里面没有任何 技能/属性/地图/任务 的切换入口，而底部系统键被 `.side-scroll` 整块盖住（`elementFromPoint` 实测命中 `side-scroll` 而不是按钮）。玩家的实际操作是「点档案 → 发现进错面板 → 按 × 关掉 → 再点技能」四跳，且「档案」这个名字让人以为里面是存档而不是背包。要求：① 抽屉内加一排与底部系统键同名的切换（背包/技能/属性/地图/任务），点一次直达对应面板内容（技能为技能列表+可用态，属性为五项属性+自由点，地图为章节节点，任务为主线/每日）；② 抽屉打开时点遮罩或 × 关闭的既有行为不变；③ 不得改动桌面（≥900px）三栏布局与 `.side-foot` 的存档/影子/战斗；④ 复用既有 CSS 变量，不新增颜色体系。断言：`node scripts/assert/mobile-drawer-nav.mjs` —— 390×844，新档 → 点「档案」→ 断言抽屉内出现 ≥4 个可点切换 → 点「技能」→ 断言抽屉仍开着且内容含技能名（如「猛虎猛击」）→ 点「任务」→ 内容含「每日任务」→ 按 × 后 `aside.sidebar.open` 为 null；旧码上必红（抽屉内无切换）
  verify: node scripts/assert/mobile-drawer-nav.mjs
  risk: med

- [x] F193 ✅ (2026-11-17 devin) （P1 内容厚度/选择感，第32轮走查）第一章「环顾四周」没有回报（第33轮复核：模板句已被换掉，连点 8 次拿到 8 条不同描写，但背包/属性/任务/XP 仍然零变化，每句尾巴都是「（仍可说「观察」再看一处，或说「前进」）」）——玩家第一次试完就明白「观察」是个没有产出的按钮。这是四维打分里「选择感 2/5」的直接来源。要求：① 给 ch1 石殿场景 3 个**一次性**可发现物（石像底座刻痕 / 祭坛下的补给袋 / 壁画上的警告），首次观察命中实体时返回 discovery（获得消耗品或解锁一句剧情线索，奖励只发一次）；② 同一实体第二次观察改口「这里你已经查过了」，不再发奖励；③ 连续观察不同实体时正文不得逐字重复（沿用 observeEntitySeq 轮换）；④ 不改遇敌/战斗数值。断言：`node scripts/assert/observe-discovery.mjs` —— 新档依次观察 3 个不同实体，断言至少 2 次回包含 discovery 且背包件数增加（或线索落库），同一实体重复观察返回已查过且背包件数不变；旧码上必红
  verify: node scripts/assert/observe-discovery.mjs
  risk: med

- [x] F194 ✅ (2026-11-17 devin) （P2 数值可信/成长可见，第33轮走查）升级那一刻数值凭空变化却不解释：实测 Lv.1 打完守关者时 HP 54/100，回包只说「【升级】Lv.1 → Lv.2 · 自由属性点 +3 · HP/MP 上限提升」，而顶栏立刻变成 HP 168/168 · MP 64/64——玩家的血从 54 直接满了，日志里没有一个字说明「回满」。要求：① 升级播报补一句实测前后值（`HP 54/100 → 168/168（上限提升并回满）`、MP 同理），数字必须取真实结算结果而不是模板常量；② 若设计上不是回满（例如只提升上限），则改为保留当前 HP 并按新上限显示，两者必须与顶栏一致；③ 不改升级曲线、属性点与战斗数值。断言：`node scripts/assert/levelup-announce.mjs` —— 新档打到升级，断言升级回包含「HP」与升级后的真实 HP 数值且与 `save.hp/save.max_hp` 一致、含「回满」或「上限」说明；旧码上必红
  verify: node scripts/assert/levelup-announce.mjs
  risk: low

- [x] F195 ✅ (2026-11-17 devin) （P1 文本不说谎，第33轮走查）守关房被逼退的提示在撒谎：连续两次「前进」被威压逼退时，HP 逐次实测都是 94/94 不变，文案却写「它每回合仍在耗你的血」；同一句「第 N 次被威压逼退」除数字外逐字重复，玩家连按只会读到同义句。要求：① 只有真的扣了血（有 HP 增量）才允许出现「耗你的血」这类句子，未扣血时改为如实口径（例如「它只是把路封着，暂时没动你」）；② 逼退文案按次数轮换 ≥3 条变体，除计数器外正文不得逐字相同；③ 段落里给出的出路必须真实可达（「攻击」/「叫阵」按钮在守关房可用，已实测可行）；④ 不改门禁逻辑与数值。断言：`node scripts/assert/boss-refusal-truthful.mjs` —— 新档走到守关房连按 4 次「前进」，逐次记录 HP 并解析回包：HP 没变的那些次不得含「耗你的血/流失」等扣血表述，且 4 次正文去重后 ≥3 种；旧码上必红
  verify: node scripts/assert/boss-refusal-truthful.mjs
  risk: low

- [x] F196 ✅ (2026-11-17 devin) （P1 选择感，第34轮走查）选项是假的：`chapters.json` 有 8 个场景的两个选项 `next` 完全相同，服务端只按 `choice.next` 跳转，正文/奖励/风险一律不区分——实测 Ch.2 开场选「今天实在撑不住了，先睡」与「按部就班完成今天的训练」落到逐字相同的下一屏，「站定，等它露头」与「绕向石柱借掩体」也是同一场毒牙蛇。玩家一旦发现选择被吞掉，后面所有选项都当装饰。要求：① 这 8 处（ch1_double_gate / ch1_watch / ch1_statues / ch1_awaken / ch2_daily_quest / ch2_penalty_gate / ch4_raid_party / ch6_red_gate）每个选项必须产生**可观察的差异**：至少一项为不同的回包正文（该选项专属 first-line，不得与另一选项逐字相同）；② 至少一半场景的选项要带真实后果（不同 HP/MP 消耗、不同道具、不同阵营/线索记录、或不同敌人等级），写在 `choices[].effects` 之类可由服务端读的数据里，不得只在文案里假装；③ 不改主线链、不改场景 `next` 拓扑（两条路仍汇聚到原节点，避免破坏既有断言与章节进度）；④ 不改战斗数值公式。断言：`node scripts/assert/choice-branching.mjs` —— 新档走到 ch1_double_gate / ch2_daily_quest / ch2_penalty_gate，逐场景分别选 A 与 B（两个独立新档），断言两次回包正文首段不完全相同、且至少一个场景的 `save.hp/mp/items` 或 `save.flags` 有可观察差异；旧码上必红
  verify: node scripts/assert/choice-branching.mjs
  risk: med

- [x] F197 ✅ (2026-11-17 devin) （P1 数值可信/风险告知，第34轮走查）「可强行进入」不给量化危险：地图 Ch.2 写「推荐 Lv.5 · 可强行进入（本章战斗难度高于你的当前等级）」，Lv.3 玩家进入后遇到 Lv.6 敌人毫无提示，实测在惩罚副本毒牙蛇（200 HP）战后剩 HP 4/172、靠两次 miss 才没死。要求：① 软门进入前的回包与地图节点给出**本次遭遇的真实对比**（敌方等级/HP 与玩家等级/HP，或沿用 F191 的 `est_take_lo/hi` 承伤口径给一行「单回合预计承受 X–Y」）；② 数字必须来自 `encounterEngine` 与 `computeDamage` 同一事实源，不得前端硬编码；③ 软门仍然放行（不改 F093 判定），只补告知。断言：`node scripts/assert/soft-gate-risk.mjs` —— Lv.1 新档强行进入 Ch.2，断言回包/章节视图含敌方等级数字与玩家等级数字、且承伤区间两端均为正整数；旧码上必红
  verify: node scripts/assert/soft-gate-risk.mjs
  risk: low

- [x] F198 ✅ (2026-11-17 devin) （P2 文本质量，第34轮走查上线后实测）分支选项的回显行写的是英文 id 而不是玩家点的中文标签：点「先放慢脚步，绕墙观察那些石像」，日志里先落一行「选择 observe」，玩家会以为自己敲了什么暗号。要求：回显行用 `choices[].label` 原文（或直接不落回显行、只落 lead 正文），不得把内部 id 暴露给玩家；服务端回包与前端本地 echo 两处同口径。断言：`node scripts/assert/choice-echo-label.mjs` —— 新档点第二个选项，断言日志里出现的回显文本等于该按钮 label，且不含 `[a-z_]{3,}` 形式的 id；旧码上必红
  verify: node scripts/assert/choice-echo-label.mjs
  risk: low

- [x] F199 ✅ (2026-11-17 devin) （P1 体验硬伤，第35轮真实玩家走查）首屏唯一的「觉醒」按钮在代号为空时是禁用灰键，而页面上没有一行字说明「先登记猎人代号」：干净上下文 390×844 / 1440×900 实测首屏 1.5–2.8s 渲染完成后（`awakeDisabledBefore=true`），玩家第一反应是「页面坏了 / 按钮点不动」。要求：① 代号为空时在输入行下方给一行可读提示（如「先登记一个猎人代号，再按「觉醒」」），输入非空即消失；② 按钮禁用行为不变，不得放开空代号提交；③ 不改觉醒接口/代号校验/冲突处理。断言：`node scripts/assert/awake-hint.mjs` —— 干净上下文进 /game，断言「觉醒」disabled 为 true 时可见文本含「代号」与提示语（`/先.*代号|登记.*代号/`）；填名后提示消失且按钮 enabled；两视口各一遍；旧码上必红
  verify: node scripts/assert/awake-hint.mjs
  risk: low

- [x] F200 （P1 节奏感，第35轮真实玩家走查）战斗只能一回合点一次：地下城狼 2 回合尚可，守关者/惩罚副本是 7–13 回合（第34轮实测毒牙蛇 13 回合），每回合 1.2–1.5s，玩家必须连点十几次键盘，中途读不了日志也没有「连击」；实测点一次 22–30ms 发出请求，说明瓶颈纯粹是「一回合一次点击」。要求：① 战斗面板加「连击 ×3」键（一次连续结算至多 3 回合，战斗提前结束即停），走同一 `resolveTurn`/`computeDamage` 路径、RNG 抽取顺序不变，逐回合照常落日志与 HP 行；② 不引入后台自动战斗/离线挂机；③ 交战五键与 390 布局契约不变（新键只在 `.btn-group-combat` 内加一枚，四键断言针对非交战组不受影响）。断言：`node scripts/assert/combat-multi-round.mjs` —— 打到一场 ≥5 回合的战斗，点一次「连击 ×3」后回合数 +3 或战斗提前结束，且同 seed 下逐回合 hp/mp/敌 hp 与连点三次「攻击」逐项相等
  verify: node scripts/assert/combat-multi-round.mjs
  risk: high

- [x] F201 ✅ (2026-11-17 devin) （P2 成长可见/信任，第35轮真实玩家走查）没有任何「进度已保存」的反馈：每个动作其实都写库（刷新后 Lv./HP/战斗日志逐项保留，实测 2.1–3.5s 续上），但玩家只在手动点底栏「存档」时看到「存档已写入」，刷新前会怀疑这一路的推平会不会白打。要求：① 每次 `/action` 成功回包后，给一处极轻的「已记录」微提示（顶栏右侧或日志尾注，1.5–2s 淡出，不进正文、不占行高）；② 交战态不得谎称已写入（交战中存档禁用是设计，此时提示改为「交战结束后可写入」或不显示）；③ 不改存档落库时机与接口。断言：`node scripts/assert/autosave-hint.mjs` —— 新档点一次「探索前进」，断言出现「已记录/已自动记录」类提示且 2.5s 内自行消失；交战中触发攻击后该提示不得出现「已写入存档」字样
  verify: node scripts/assert/autosave-hint.mjs
  risk: low

- [x] P202 （P1 文本质量/衔接硬伤，第36轮真实玩家走查）遭遇战与"濒死正文"自相矛盾：「探索前进」的正文以终局描写收束（「巨像的拳落下来。你听见自己腿骨断裂的声音……血在石板缝里摊开，视野边缘开始发黑」），紧接着立刻下发「【遭遇】石像守卫 Lv.2 拦住了去路——HP 75/75」，玩家在"已被打断腿等死"的文字里满血 94/100 开打 Lv.2 小怪。要求：① 遭遇触发时，紧接其前的正文必须收束成一句"战斗起势"（撑起身/刀还在手边/它已经逼到面前之类），不得以终局描写（视野边缘开始发黑 / 腿骨断裂 / 血在石板缝里摊开 / 来不及叫）结尾；② 正文提到的对手与真正的战斗对象必须一致：若该段正文写的是守关者/巨像，遭遇对象须为 boss；若遭遇的是普通小怪，正文不得把玩家写成已经倒地濒死；③ 不改战斗数值与遭遇概率。断言：`node scripts/assert/encounter-prose-continuity.mjs` —— 新建档反复「前进」直到遭遇触发（至多 12 次），断言交战前最后一条正文不含终局词表且含起势句；再断言同一次遭遇中"正文写巨像/守关者"与"战斗对象是普通小怪"不得同时成立
  verify: node scripts/assert/encounter-prose-continuity.mjs
  risk: low

- [x] P203 （P2 内容厚度/文本，第36轮真实玩家走查）观察的尾注每次逐字重复：「（仍可说「观察」再看一处，或说「前进」）」连点三次都是同一句，玩家分不清自己是"又看出一点"还是"原地打转"；而且观察三句都是独立好句子，却没有累计感、也没给过任何实质线索或收益。要求：① 同一存档内该元提示最多出现一次（之后换一句不重复的收束，或干脆不出现），且不得出现「重新审视」；② 连续观察给出可见的探索进度（如「石殿探索 2/3」），第 3 次观察给一条实质信息或一件小物（写入日志，不刷物品也能给线索文本）；③ 观察仍免费、正文仍以场景名开头（不得打红 F092 的 `action-prose-by-chapter.mjs`）。断言：`node scripts/assert/observe-exploration.mjs` —— 同一场景连点 3 次「环顾四周」，断言三次正文互不相同、元提示不重复出现、第 3 次含探索进度或线索字样；并断言正文仍以「<场景名>」开头、不含「重新审视」
  verify: node scripts/assert/observe-exploration.mjs
  risk: low

- [x] P204 ✅ (2026-11-18 devin) （P0 选择感硬伤，第37轮真实玩家走查）「探索前进」会整段吃掉场景选择：29 个带 `choices` 的场景里有 25 个同时带 `next_scene`，`advanceOutcome` 在没有 choice 时直接沿 `next_scene` 推进，于是 4/7 那屏「【检测到符合条件的个体。是否接受成为「玩家」？】……只有两个悬在血泊上方的选项」按「前进」不会出现任何选项，下一屏已经是「光幕展开……你站起来」；`accept` 自带的 `effects {xp:30, flag:system_bound}` 也没结算。要求：① 数据层给关键选择场景加 `must_choose: true`（至少 `ch1_system` / `ch1_law` / `ch1_statues`，可再加终章前一处），这类场景上**不带 choice 的 advance 一律零消耗拒绝**：正文列出选项（形如「这里必须做出选择：1) … 2) …」），不推进、不改 `save.scene`、不掷遭遇、不扣 HP/MP；② 显式「选择 accept」照常落 `choice.next` 并叠加 `effects`（xp 30 入账、`system_bound` 写入）；③ 未标 `must_choose` 的场景行为完全不变（现有 e2e/断言大量依赖「前进」推进主线，不得回归）；④ 不动战斗数值、遭遇概率与存档口径。断言：`node scripts/assert/choice-gate.mjs` —— 新档推到 `ch1_system`，按「前进」断言 scene 不变 / XP 不变 / 拒绝文本列出两个选项名；再「选择 accept」断言 scene=`ch1_awaken`、XP +30、`system_bound` 存在；对未标 `must_choose` 的 `ch1_double_gate` 断言「前进」仍能推进；旧码上必红
  verify: node scripts/assert/choice-gate.mjs
  risk: high

- [x] P205 ✅ (2026-11-18 devin) （P1 选择感，第37轮真实玩家走查）连击 ×3 完全没有代价：实测整场战斗 MP 停在 16/20，连击三回合的伤害（14 / 14 / 23）与逐回合点「攻击」逐项相同，于是「攻击」键成了纯冗余——战斗只剩一个按得最快的键，选择感归零。要求：① 给连击一个真实代价（每回合 MP 2，或整次固定 MP 6，取不到就拒绝并提示，不得静默降级为单次攻击）；② 单键「攻击」保持零消耗且不得削弱，让「省资源慢慢磨 vs 快打付代价」成为真选择；③ 不改伤害公式与 RNG 抽取顺序（同 seed 三回合伤害仍逐项等于逐次攻击）；④ 连击键上标出代价（如「连击 ×3 · 6MP」），资源不足时禁用并给出可见理由。断言：`node scripts/assert/combo-cost.mjs` —— 交战态点一次连击，断言 MP 恰好 -6 且三回合伤害与逐次攻击逐项相同；MP 不足时该键 disabled、有可见理由且不发请求
  verify: node scripts/assert/combo-cost.mjs
  risk: medium

- [x] P206 ✅ (2026-11-18 devin) （P2 文本质量/去重，第37轮 P204 收尾）must_choose 场景的拒绝正文没有去重：在 `ch1_law` 连点 7 次「探索前进」，日志里叠了 7 条逐字相同的「【系统】这里必须做出选择：1) … 2) … 3) …」（实测 refusalCount=7），像报错刷屏；而章节门早就做过同档去重（见 `gate-refusal-hint-spam` 断言）。要求：① 同一场景、同一条拒绝文案在同一存档内只落一次；重复触发时改为极轻的就地提示（例如顶栏下缘「选择上面的一项继续」1.5–2s 淡出，参考 `.save-hint`）或干脆不再追加正文——界面选项键始终可见，玩家不会因此卡住；② 换场景或选项集合变化后必须能再落一次；③ 不改拒绝判定本身（零消耗、不推进口径不变）。断言：`node scripts/assert/choice-refusal-dedupe.mjs` —— 新档推到 `ch1_law`，连点 6 次「前进」，断言含「必须做出选择」的日志行数 ≤ 1，且 6 次点击后 `scene`/`hp`/`mp` 全不变、选项键仍 ≥ 2 且可点
  verify: node scripts/assert/choice-refusal-dedupe.mjs
  risk: low

- [x] P207 ✅ (2026-11-18 devin) （P0 行动经济学，第38轮真实玩家走查）「观察」是零成本无限产出的补给站：线上实测新档连打 6 次「观察」（`POST /api/action`），HP 100/MP 20 全程不变、每场 0 遇敌，却在第 1/3/4 次各白给一瓶药剂（「低级治疗药水」「魔力药剂」），到 3/3 之后仍然每次给出全新散文与越来越荒诞的「这一带已经看熟」提示（OBS6 还在描述新内容，却说已经看熟）。结果：玩家可以站在第一幕刷满背包，战斗难度与资源管理彻底失效。要求：① 每个场景的「有产出」观察次数封顶（复用现有 `探索 n/3` 口径，3 次为上限，含首次免费）；② 超过上限后不再产出物品、不再「发现」，正文如实说明「这里能翻的都翻过了」并且每次观察必须付出代价（推进 `encounter_clock` / 消耗 MP 2 / 触发一次遇敌判定，三选一，宁小勿无），不得维持零成本；③ 3/3 之后不得再出现「发现·…」「获得 …」字样，也不得在说明「已经看熟」的同时给出全新景物描写；④ 不改观察的散文池与既有的「观察不以『重新审视』开头」契约。
  verify: node scripts/assert/observe-economy.mjs
  risk: medium

- [x] P208 ✅ (2026-11-18 devin) （P2 成长可见性，第38轮真实玩家走查复读）顶栏只有 `XP28` 一个裸数字，看不到离下一级还有多远，得开「属性」面板才知道 28/70；而面板里那句「经验值 14% · 距离 Lv.2 还需 42 经验」写得很清楚，说明服务端数据齐备、只是顶栏没用上。要求：顶栏 XP 旁边加一条极细进度条（宽 ≤ 56px，复用现有 CSS 变量与配色，不新增行高、不挤压 390px 下的顶栏），`title` 与 `aria-label` 给「经验 28/70 · 距 Lv.2 还需 42」，数据只读 `save.xp` 与 `save.xp_to_next`，前端不自行换算；升级回包后立即更新，刷新后一致。
  verify: node scripts/assert/xp-bar-topbar.mjs
  risk: low

- [x] P209 ✅ (2026-11-18 devin) （P1 工程死路，第38轮验收发现）`scripts/assert/combat-actions-ui.mjs` 已自我失效：连跑必崩在 `browser.newContext: Target page, context or browser has been closed`（第 324 行）。根因是重试循环先失败一次（`fetch failed`）后浏览器已随之关闭，第二次仍对同一个已关闭的 browser 调 `newContext()`，异常直接抛到顶 → `report.sh` 里这条永远是红，而且红因与业务无关。同类：同一 worktree 里 `server/db.test.js` 三连（`stats_json 非法 JSON` / 道具）在 main、P205、P207 三个工作区全红，也属环境/用例自身问题，不是业务回归。要求：① 重试前显式关闭并按需重启 browser（每次 attempt 独立 launch，或 attempt 内 catch 后 `browser.close()` 再重建）；② 首败日志必须打印失败步骤与 URL（现在只有一句 `fetch failed`）；③ 用例名带随机后缀（F136 口径）；④ 修好后在隔离实例上连跑 3 次全绿，并在 `report.sh` 全表里确认由红转绿。
  verify: node scripts/assert/combat-actions-ui.mjs
  risk: low
  > 备注（调度验收 P211 落地）：db.test.js 三红的真根因不是用例逻辑，是**调度 shell 泄漏的环境变量**：`DB_PATH=/tmp/sl-main38.db` 让 `server/db.js` 打开 A 库，而用例 `raw()` 硬编码 `<repo>/data/game.db` 打开 B 库 → 插进去的行读不到（`rows.length` 0）。清掉 `DB_PATH/E2E_BASE_URL/API_BASE` 后三条全绿（3/3）。同一泄漏也解释了 P209 原始症状的首因：`E2E_BASE_URL=http://127.0.0.1:3118/game`（死端口）→ `fetch failed` → 浏览器随之关闭。

- [ ] P210 （P1 工程死路，第40轮调度发现）`scripts/report.sh` 在全表模式下逐条执行 FEATURES 里每一条 verify（每条断言自起隔离实例、部分还要起 Playwright），实测运行 >50 分钟仍未写出报告文件，被调度器强行终止——于是「本轮汇报」这件必做事项在 15 分钟单轮预算内永远做不完，报告只能手工替写。要求：① 支持增量模式（`--changed` 取本轮合并区间涉及的 verify、或 `--since <ref>`），增量模式 3 分钟内产出报告；② 全表模式改为有界并发（默认并发 2，CPU>90% 时自动降到 1），单条失败不阻塞其余条目；③ 每条结果边跑边落盘（部分报告也要可用，进程被杀不丢已跑结果）；④ 增量模式与全表模式对同一批 FID 的 PASS/FAIL 结论必须一致（抽 5 条对照）。断言：`node scripts/assert/report-incremental.mjs` —— 在隔离仓库副本上跑 `--changed` 于 180s 内生成报告文件且含本轮 FID，杀掉进程后已跑行仍在文件里，再对同一批 FID 与全表模式结论逐条比对相等
  verify: node scripts/assert/report-incremental.mjs
  risk: medium

- [x] F210 ✅ (2026-11-18 devin; 390 下选项键 auto-fit 栅格 + 2 行 clamp + title 全文，旧码 sw−cw 36–204px 必红，新码三场景 sw=cw=177 连跑 8 次 PASS，桌面 1440 无回归) （P1 视觉/可用性，第40轮真实玩家走查）390×844 下分支选项的文字**越过按钮边界**：`.btn-group-choice button` 固定 86×44（`clientWidth` 84）、`white-space: nowrap` + `overflow: visible`，实测文本宽 120–288px（首幕「先放慢脚步，绕墙观察那些石像」sw=204；`ch1_law`「退到石柱后，观察石像与石碑的对应」sw=232；`ch1_worship`「抬起头，盯住巨像的眼睛（需先观察过石像）」sw=288）。结果文字直接压在相邻按钮与背景网格上，截图 `docs/runs/walk-11180304-m16.png` 里出现裸文字选项（「爬向那把脱手的旧刀」没有边框）、相邻按钮互相叠字，玩家读不全就选不了——选项是本作唯一的决策入口。要求：① 390 下选项按钮按内容自适应（一行 1–2 枚、可换行 `white-space: normal`、`min-height 44`，最多 2 行后 ellipsis 且 `title` 给全文）；② 任何情况下 `scrollWidth ≤ clientWidth`（允许省略号，但不允许溢出可见区）或按钮边界包住文本；③ 相邻按钮矩形不得重叠；④ 不改变选项的 `choice.id`/顺序/服务端行为，桌面（≥900px）布局不回归。断言：`node scripts/assert/choice-buttons-fit.mjs` —— 新档分别走到 `ch1_double_gate` / `ch1_law` / `ch1_worship`，逐个断言每个 `.btn-group-choice button` 的 `scrollWidth ≤ clientWidth + 1`、按钮矩形两两不相交、文字可见高度 ≥ 1 行且 `footer.actions` 无横向溢出；旧码上必红（实测 sw−cw = 50–204px）
  verify: node scripts/assert/choice-buttons-fit.mjs
  risk: medium
- [x] F211 （P2 选择感/诚实，第40轮真实玩家走查）带前置条件的选项不置灰：全新档全程没观察过石像，`ch1_worship` 的「抬起头，盯住巨像的眼睛（需先观察过石像）」仍是 `disabled=false`，`title` 只是把同一句文案重复一遍。玩家点下去只会得到一句泛泛的拒绝（或被静默吞掉），无法判断是"条件不满足"还是"游戏坏了"；把条件写进选项名本身也像调试文本。要求：① 未满足前置时该键 `disabled=true`，并在按钮下方/`title` 给一条**可执行**的说明（如「先「观察」一次石像的眼睛」）；② 满足前置后同一键恢复可点且 `disabled=false`；③ 若产品选择"仍可点"，则点击必须回 `refused:true`、`scene`/HP/MP 不变，且正文明说缺哪一步——两种实现取其一，但不得静默；④ 不改 `chapters.json` 的主线拓扑与其它选项的条件。断言：`node scripts/assert/choice-precondition.mjs` —— 新档直推 `ch1_worship` 不观察：断言该键 disabled 且提示含「观察」，或点击后 `refused` 且正文含「观察」且 `save.scene` 不变；再观察一次后重进该场景，断言该键可点并能落地 `choice.next` ✅ (2026-11-18 devin swe-2-high 一次过、无回退；服务端 next_choices 增 locked/locked_reason，前端 disabled+aria-disabled 与 .choice-hint 原文透传，新断言 choice-precondition.mjs 连跑 3 次 PASS)
  verify: node scripts/assert/choice-precondition.mjs
  risk: medium
- [x] F212 ✅ (2026-11-18 devin swe-2-high pass；.btn-group-sys 外包 .sys-scroll（桌面 display:contents、窄屏 position:relative flex 槽），两枚 .sys-fade 装饰渐隐元素替代旧 mask-image——可测量宽度、pointer-events:none；scroll 事件 + ResizeObserver 只写 data-at-start/data-at-end 驱动左右缘对称显隐，零 setState/rAF；首屏 .sys-swipe-hint 1.8s 浮层（.actions 上缘、不占行高、组件 state 会话一次）；sys-keys-affordance 隔离实例 3× PASS，desktop-layout/mobile-actions/panels 回归 PASS) （P2 视觉/手感，第40轮真实玩家走查）390 下底部系统键默认只露 3 个且无任何横滑暗示：`.btn-group-sys` 容器 183px、`scrollWidth` 472px（`overflow-x:auto`），首屏只看到 背包/技能/属性，地图/任务/影子/战斗/存档 全部在视口外（实测 x=375–667），没有裁切边渐隐、没有箭头、没有"左滑还有"的提示。第一次进游戏的玩家会以为没有地图/任务/存档。要求：① 容器右缘加渐隐遮罩（`mask-image` 或伪元素），滑到末端时左侧出现对称渐隐；② 首屏首次渲染时给一次极轻的横滑暗示（≤2s，不占行高、不进正文）；③ 保持 `.btn-group-sys` 元素与既有 `elementFromPoint` 8/8 断言口径不变（只加视觉层，不改结构）；④ 桌面（≥900px 全键可见）不渲染上述提示。断言：`node scripts/assert/sys-keys-affordance.mjs` —— 390 下断言 `.btn-group-sys` 存在右缘渐隐元素且其宽度 >0；横滑到末端后右缘渐隐消失/左侧出现；1440 下不存在任何渐隐元素；`.side-scroll` 结构不变且 8 键仍各自命中自身
  verify: node scripts/assert/sys-keys-affordance.mjs
  risk: low
- [x] F213 ✅ (2026-11-18 devin swe-2-medium pass，无回退；渲染层 splitNarrationParas 按自然段拆成多个 `<p.narration>`，单段 >200 字只在句末标点后继续切，entry.content/日志条数/CSS 零改动；新断言 prose-paragraphs 旧码实测红（单段 294 字）、新码 390 段数 7/最长 121 字/最高 187px < 0.35 视口；action-prose-by-chapter、no-placeholder-prose、choice-echo-label、encounter-split-log、scene-advance 全 PASS) （P2 文本排版，第40轮真实玩家走查）开场正文是一堵 340 字的墙：`.stage p.narration` 把三个自然段（矿灯下的委托人 / 李珠熙的招呼 / 石殿与合拢的石门）塞进同一个 `<p>`，只用 `\n\n` 分隔，390 下一屏全是同字号同灰度，vision 两次把它读成"顶部文字被裁切/显示异常"。要求：① 服务端把开场这段（及同类 >200 字的长段）按自然段拆成多个 `p.narration`；② 390 下单段渲染高度 ≤ 视口 35%，段落间距沿用现有 `--line` 变量；③ 不删改任何原文句子（只拆段，不改字），`action-prose-by-chapter` / `no-placeholder-prose` 不得放宽；④ 日志条数与滚动行为不变。断言：`node scripts/assert/prose-paragraphs.mjs` —— 新档首屏断言 `.stage p.narration` 数量 ≥ 5、单段字数最大值 ≤ 200、单段渲染高度 ≤ 0.35×视口高；全文拼接后与拆分前逐字相同
  verify: node scripts/assert/prose-paragraphs.mjs
  risk: low

- [x] P211 ✅ (2026-11-18 devin swe-2×3 pass；verify.sh/report.sh 入口清 DB_PATH/E2E_BASE_URL/SL_GAME_DB/API_BASE 并打印被清键值，db.test 复用 db.js 的 DB_FILE；env-leak-guard 新码 PASS/旧码 6 红，污染 env 下 `verify.sh P211` PASS) （P1 工程死路，第41轮调度验收发现）断言/单测被**调度 shell 泄漏的环境变量**打成假红：本机常驻 `DB_PATH=/tmp/sl-main38.db`、`E2E_BASE_URL=http://127.0.0.1:3118/game`（死端口）、`API_BASE=…/zhihucopy/api`。后果：① `combat-actions-ui.mjs` 先 `fetch failed`（打到死端口）→ 浏览器随之关闭 → 重试对已关浏览器 `newContext` 崩；② `server/db.test.js` 的 `raw()` 硬编码 `<repo>/data/game.db`，而 `server/db.js` 按 `DB_PATH` 打开另一个库 → 插进去的行读不回（`rows.length` 0，实测 2 条红），清掉变量后 3/3 全绿。`ci-deploy.sh` 已在入口 `unset`，`verify.sh`/`report.sh` 只清了 `API_BASE`。要求：① `verify.sh` 与 `report.sh` 入口统一 `unset E2E_BASE_URL API_BASE DB_PATH SL_GAME_DB SL_VERIFY_API_BASE`（`SL_VERIFY_API_BASE` 作为唯一显式覆盖口保留），并在报告里打印被清掉的值；② `server/db.test.js` 不再硬编码库路径，改为复用 `server/db.js` 导出的 `DB_FILE`（或 `db.name`），保证「应用打开的库 == 用例看到的库」；③ 不改任何断言语义与产品行为。断言：`node scripts/assert/env-leak-guard.mjs` —— 在 `DB_PATH=/tmp/x.db E2E_BASE_URL=http://127.0.0.1:3118/game` 的污染环境下跑 `scripts/verify.sh P209`，断言其内部已清理变量（打印清理日志）且断言通过；再断言 `node --test server/db.test.js` 在该污染环境下仍全绿
  verify: node scripts/assert/env-leak-guard.mjs
  risk: low

- [x] F214 （P1 成长可见性/视觉，第43轮真实玩家走查）390×844 下**顶栏的经验徽记和经验条整体被裁出视口**：实测 `.stat.stat-xp` 矩形 `left=393 / right=472`（视口 390），其内 `b`（数字）`left=412`、`i.xp-bar` `left=424 / right=472`；`.status` 自身 `scrollWidth == clientWidth == 390`，即越界内容是被 `overflow: hidden` 裁掉而不是可横滑——手机上**从头到尾看不到任何经验数值/进度条**，只有打开属性面板才见到「13% · 15/110 · 距离 Lv.3 还需 95」。这是「我离下一级还有多远」在移动端完全缺失。要求：① 390 下顶栏必须让 XP 可见（换行到第二行、或与金币并列收进一行、或收成 `Lv.2 ↑15` 紧凑态，二选一由实现定），断言口径为「元素矩形完整落在视口内」；② 数值与进度条不得只剩其一；③ 金币/攻防等现有项不得因此被挤出（一次只裁低优先级信息且要显式：宁可少显示一项，也不要出现"半截被裁"）；④ ≥900px 桌面布局零回归。断言：`node scripts/assert/mobile-xp-visible.mjs` —— 390 下断言 `.stat.stat-xp` 与 `.xp-bar` 的 `getBoundingClientRect().right <= innerWidth` 且 `left >= 0`、可见（宽高 > 0）、文本含数字；1440 下断言 XP 位置与现状一致；旧码上必红（实测 right=472 > 390）
  verify: node scripts/assert/mobile-xp-visible.mjs
  risk: low
  done: 第44轮 devin swe-2-medium（未失败，无回退）—— styles.css 末尾追加 ≤640px 块 `.status-nums .stat-xp{order:-1;display:inline-flex;align-items:center}`，XP 提到数值行首；390 实测 left=12/right=91、xp-bar 43..91、.status 390/390 无溢出；1440 left=1341/right=1420 与改前逐位一致；旧码 red 证 left=393/right=472
- [ ] F215 （P2 视觉/手感，第43轮真实玩家走查）战斗胜利 + 升级**没有任何视觉反馈层**：第 5 回合「石像守卫倒下了，战斗结束 / 击败 石像守卫，获得 XP +75 · 金币 +19 · 符文碎片 ×1、石核 ×1 / 【升级】Lv.1 → Lv.2 · 自由属性点 +3 · HP 66/100 → 168/168」全部只是 `.stage-col` 里的一行普通日志，与「你蹲下看了看」同一视觉音量（vision 对 `mP-combat` 给首屏清晰度 2/5、层级 2/5：「第一眼更像读日志，而不是战斗胜利后的明确反馈」）。要求：① 胜利/升级时给一层轻量结算反馈（横幅或卡片，含「战斗结束」「Lv.N」「XP/金币/掉落」摘要与属性点提示），可用 2.5–3.5s 自动淡出或一键关闭，不做全屏阻塞弹窗；② 390 下不得遮挡或顶开底部 `.actions-main`（结算层收起后布局零位移），1440 下不得盖住右侧档案栏；③ 成功/失败/撤离三种收尾都有对应措辞，不得对撤离谎报胜利；④ 日志正文照旧保留（结算层是补充，不替代日志）。断言：`node scripts/assert/combat-reward-banner.mjs` —— 新档打到一场胜利并升级：断言出现结算层元素、含「Lv.2」与「XP」字样、390 下其矩形不与 `.actions-main`/`.input-row` 相交、4s 内自动消失且消失后 `scrollWidth==clientWidth`；对「逃跑」收尾断言不出现「战斗结束/胜利」字样
  verify: node scripts/assert/combat-reward-banner.mjs
  risk: medium
- [x] F216 ✅ (2026-11-18 第54轮 devin swe-2-medium 一轮完成、无回退；`OBSERVE_OVER_LINES` 3→4 条互不同义且每条带可执行动作词，`observeOverRiskTail` 增「动静 N/4」计数（N 由现有 `encounter_clock` 推导、封顶 PITY_LIMIT，不新增字段）；实测第 4–7 次正文 动静 1→2→3→4/4、HP/MP 100/20 全程不变、相邻收束句 Jaccard 0.044–0.050；旧码红证 `(c) 第4次正文缺「动静 N/M」计数`；observe-economy / observe-prose-concrete / action-prose-by-chapter / no-placeholder-prose 全 PASS，233 单测 0 失败，部署 7/7 E2E，线上 verify PASS) （P2 选择感/文本，第43轮真实玩家走查）「观察」在探索计满 3/3 后仍可无限连点且文案高度同质：第 4/5/6 次分别是「这里能翻的都翻过了，连石碑你也翻来覆去看了几遍」「四壁、地面、缝隙你都看熟了」「能看的你都看遍了，再蹲下去只是把同一段回忆重放」——三句同义、零产出、HP/MP 全程不动（实测 6 次 `100→100 / 20→20`），玩家只能靠「逗留的动静」那句模糊尾注猜测还要不要继续。遇敌时钟确实兑现（下一次「前进」即遭遇石像守卫），所以这不是"无限刷收益"，但**交互上是一次没有反馈的空转**。要求：① 3/3 之后继续观察必须给可见的「逗留计数」（如「动静 2/3」）或直接禁用并说明原因，二者取其一；② 第 4 次起的收束句不得互相近义（同场景同档连续两次去重度 ≥0.6 即算不合格），至少给出可执行指引（「再蹲下去会被围上，说『前进』动身」）；③ 观察仍不得产出物品/经验（P207 口径不放宽）。断言：`node scripts/assert/observe-after-cap.mjs` —— 新档同一场景连点「观察」7 次：第 4–7 次每次 HP/MP 不变、无「获得」字样，且第 4 次起正文含「动静 N/M」计数或该键 `disabled=true` 并给出原因；相邻两次收束句字符重合率 < 0.6
  verify: node scripts/assert/observe-after-cap.mjs
  risk: medium
- [x] F217 ✅ (2026-11-18 devin swe-2-medium pass；scroll effect 按「整窗日志有无 user 行」分流——全新存档（开场全 narrator/system、零动作史）scrollTo(0) 停在正文开头，有动作史老档照旧沉底；first-entry-scroll 旧码实测红（relTop=-946）、新码 fresh relTop=16.0/scrollTop=0、同档 3 动作后 reload 仍沉底 bottomDelta=-40.7，连跑 2 次 + verify PASS；prose-paragraphs / combat-round-feedback / desktop-layout / boot / action 回归全 PASS) （P2 首屏/节奏，第43轮真实玩家走查）首次进入游戏时日志**自动滚到底部**，开场正文从中间读起：390 下创建角色后 `.stage-col` 的 `top = -764`（桌面 -315），第一屏读到的是「李珠熙朝你点头 / 石门在身后合拢」中段，vision 对 `m2` 的描述直接从"主角笑了一声说这地方像旅游景点"开始——开场第一段（E 级猎人、本月第四份 D 级委托、母亲的药费）整个在视口上方，新玩家不知道前面还有内容。要求：① 全新存档（无历史日志）进入时停在正文**开头**，或给一条「↑ 从头读」锚点/一条"以上为开场"的分隔；② 有历史日志的老档保持滚到底（这是对的，别改坏）；③ 不改日志条数与滚动容器结构。断言：`node scripts/assert/first-entry-scroll.mjs` —— 新档进入后断言首个 `.stage-col` 子元素的 `top >= 0`（或存在「从头读」锚点且点击后首个元素可见）；同档追加 3 次动作后刷新，断言仍滚到底部（最后一个元素可见）
  verify: node scripts/assert/first-entry-scroll.mjs
  risk: low


- [x] F218 ✅ (2026-11-18 cron 第49轮；devin swe-2-high 一轮完成，未回退。服务端 combat.last_json 落 {turn,kind,line}（真实事件拼句，刷新回灌仍在，开战清空），`body.seed` 仅追加进回合 RNG 盐默认口径不变；前端 .stage 改纵向 flex、交战面板与回溯控件钉在列顶独立槽位（.stage-col 独占滚动，面板与正文矩形恒不相交），CombatPanel 增 .combat-report 结算行，顶栏 HP/MP ≤1.1s 跳字；新断言 combat-round-feedback 覆盖 390/1440 不相交 + seed 确定性落空 + 每回合结算行；verify 连续 2 次 PASS、部署 E2E 7/7、线上 verify PASS战斗回合**没有任何"命中/未命中/伤害"的可视播报**，且 390 下「交战」浮层直接压在日志正文上：第 1 回合点「攻击」后我方 HP 97→94、回合数 +1，敌方仍 `42/42`，日志里没有一个字说明这一刀是落空、被闪避还是只是没结算（桌面同一场战斗的「造成17点伤害 / HP 25→8」是写在日志里的，手机端被浮层盖住，vision 对 `m3` 判"浮层与背景文字粗暴重叠"、清晰度 2/5、层级 2/5）。玩家能合理得出的结论是"攻击键坏了"。要求：① 每回合结束时在战斗区（不是被遮住的日志）输出一行结算播报：命中/未命中/暴击/承伤数值 + 敌方 HP 变化，缺一不可；② 390 下战斗浮层不得与 `.stage-col` 正文重叠（浮层占据独立区域，或正文在战斗期间收起），断言两点矩形不相交；③ 战斗期间顶栏 HP/MP 变化要有一次短暂高亮/跳字（与 F215 的结算层口径一致，可复用其组件）；④ 不改战斗数值与回合规则。断言：`node scripts/assert/combat-round-feedback.mjs` —— 新档打一场：断言每回合 DOM 中存在含「伤害/闪避/未命中」其一的行且该行在战斗区内；控制狼的随机种子使某一回合必然落空，断言该回合出现「未命中/闪避」字样而不是空白；390 下断言战斗浮层矩形与 `.stage-col` 矩形 `intersects=false`
  verify: node scripts/assert/combat-round-feedback.mjs
  risk: medium
- [x] F219 ✅ (2026-11-18 cron 第48轮；devin swe-2-medium 前台 420s 超时被 kill，改动落盘但断言 DOM 取样用错选择器 → 回退 OpenCode 修断言；拒绝文案去方位词、按 choice_refusal_count 确定性轮换三版文案、选项组 1.4s 一次性描边高亮指认位置；must-choose-copy 旧码必红（含「上方」+ 第 2/3 次逐字相同）/新码 PASS，390 下 3 条文案两两不同、HP/MP 与日志条数零变动) - [ ] F219 （P2 文案/可负担性，第46轮真实玩家走查）must_choose 拒绝文案**方向说反 + 逐字重复**：390 下被「前进」拒绝两次，原文 `【系统】仍需做出选择——点上方选项，或说「选择 序号」`，但剧情选项组实际渲染在行动行（`探索前进/环顾四周/潜行/休息` y≈593）**下方**（y≈653），玩家按提示往上看不会找到任何可点项；且第 2、3 次拒绝逐字相同，等于刷屏。要求：① 拒绝文案改为不含方位词的指代（如「先做下面这道选择」改为直接高亮选项组 / 或让拒绝行本身带一个可点的选项锚点）；② 连续拒绝不得逐字重复，第 2 次起改为把可选项清单再列一遍或聚焦到选项组；③ 拒绝时 HP/MP 与日志不得变动（现状正确，别改坏）。断言：`node scripts/assert/must-choose-copy.mjs` —— 新档进入 must_choose 状态连点「前进」3 次：断言 3 条拒绝文案两两不同；断言文案中不出现「上方」（390 下选项组 `top` 大于行动行 `top` 时）；断言每次点击后 HP/MP 与日志条数不变
  verify: node scripts/assert/must-choose-copy.mjs
  risk: low

- [x] F220 ✅ (2026-11-18 cron 第52轮；devin swe-2-high 一轮完成，未回退。`CHAPTER_ENTRY_NOTES` 四条注脚全部改为「向前推进」口径（迈入/探步/穿过/踏进），删掉「立在原地听风/未耗一丝力气/站稳了脚跟/没有出手」，只保留「代价从下一步开始」这一事实；轮换机制与池长度不变，数值/推进/存档结构零改动。新增断言 `advance-copy-consistency.mjs`（隔离实例 + 逐章进入链首各点一次前进，覆盖 4 条变体），旧文案回填必红、新文案 PASS；verify 两次 PASS、部署 E2E 7/7) - [ ] F220 （P1 行动-叙事矛盾，第50轮真实玩家走查）点「探索前进」却被正文写成没动：390 与 1440 两遍一致，第 1 次点「探索前进」后新增正文为「（石门在身后合上。**你只是立在原地听风，未耗一丝力气**——再往前一步，代价就开始了。）」，字符 +283、日志 11→18 条（场景确实推进了），但句子在告诉玩家"你没有前进"。这是 `narrative-systems-designer` 的 Dissonant（动作与叙事互相拆台）：按钮的语义与正文的语义相反，玩家会怀疑按键是否生效。要求：① 每次「前进」落地的正文必须与"向前推进"自洽（不要出现「原地/听风/未耗力气/立在原地」这类未推进措辞），或有代价就明写代价；② 若该段是"进入下一场景前的过渡旁白"，请把它挂在场景切换而非前进按钮的响应上；③ 不改任何数值与章节推进逻辑。断言：`node scripts/assert/advance-copy-consistency.mjs` —— 新档从首屏起连点「探索前进」直到 must_choose，逐次断言新增正文不含「原地/听风/未耗」三者，且每次点击后 `save.stage`（或章节 x/7）单调不减
  verify: node scripts/assert/advance-copy-consistency.mjs
  risk: medium
- [x] F221 ✅ (2026-11-18 第55轮 cron 双段 devin swe-2（第一段 high 实现、第二段 medium 修类名冲突）：兜底回包整段删除「眼下可以做…输入「帮助」查看完整指令表」尾巴（F176 的「每档给一次」一并作废），回包序改为 回显→面板指路→可做之事→叙事句收尾，`说「X」` 锚点仍 ≥2 护住 F146；must_choose 拒绝去掉 `1) 2) 3)` 编号改选项名「」串接（保留「必须做出选择」落库指纹，F219 三版轮换/DOM 高亮/零消耗全绿）；帮助入口移入顶栏 `.help-toggle`「?」键走同一 dispatch。首次部署 mobile E2E 红——帮助键复用 `.drawer-toggle` 类导致 4 处唯一选择器 strict violation，改独立类 + 共享观感样式后 7/7 E2E 通过) - [ ] F221 （P2 文本/调试腔，第50轮真实玩家走查）自由输入被当成命令行，回复尾部补说明书：输入「我蹲下来，用手背碰了碰石板上那摊血。」→ 2.9s 后正文接住了（「痕迹已经干透，辨不出是什么时候留下的」），但末尾追加「眼下可以做：说「观察」环顾四周；说「前进」推进剧情。输入「帮助」查看完整指令表。」——把指令表塞进小说段落，且同类措辞也在 must_choose 拒绝里以「1) … 2) … 3) …」编号复述选项。要求：① 自由输入的叙事回复不得含「眼下可以做」「输入「帮助」」「查看完整指令表」这类命令行话术，帮助入口留在 UI（`?`/帮助键）而非正文；② must_choose 拒绝文案不得再用 `1) 2) 3)` 复述选项（F219 已改成三版轮换 + 高亮，这轮把"复述清单"一并去掉，改为一句指认 + 高亮）；③ 叙事句不得被系统话术截断（回复须以叙事句结尾）。断言：`node scripts/assert/free-input-prose.mjs` —— 新档发 3 条自由输入，断言每条回复不含「输入「「眼下可以做」「查看完整指令表」，且最后一句不含「)」编号；must_choose 态连点「前进」2 次，断言语案不含 `1)`/`2)` 形式的选项复述
  verify: node scripts/assert/free-input-prose.mjs
  risk: low
- [x] F222 （P2 续档一致性，第50轮真实玩家走查）刷新后日志少一条：战斗后刷新，`.stage-col > *` 由 52 → 51（1440 为 56 → 55），双视口双复现；HP/MP/XP/金币四项数值均正确保留，所以丢的是一条**日志节点**而不是数值。玩家观感是"我刚才那场战斗的记录被吃掉了一行"。要求：① 定位被丢的是哪一条（怀疑是 `.combat-report` 结算槽或遭遇段在重灌时的空节点）；② 保证刷新前后 `.stage-col > *` 数量一致，或仅允许"空槽位"这一类已知差异，并在断言里显式列出；③ 不改战斗数值与存档结构。断言：`node scripts/assert/reload-log-parity.mjs` —— 新档打完一场战斗，记录刷新前 `.stage-col > *` 的条数与最后 3 条文本，刷新后断言条数相同、最后 3 条文本逐字相同
  verify: node scripts/assert/reload-log-parity.mjs
  risk: medium
  done(第53轮): 缺的其实是**仅内存态**的系统回执行（F155/F163 抽屉展开回执「已调出技能面板/道具面板」、断线警报）——服务端不落库，刷新回灌后自然消失，战斗结算与数值行一条没丢。修法只动 `client/src/App.tsx`：`UiEntry.ephemeral` 标记 + `.holo-ephemeral` class，回执行照常渲染（F155 的 `skill-panel-feedback` 仍 PASS）。断言把豁免写成**闭集白名单**：豁免行 innerText 必须命中 `/已调出(技能|道具)面板|【警报】与系统的连接中断/` 且 ≤2 条，越界即红（拒绝「谁挂 class 谁就能静默丢行」）；并要求刷新前至少存在 1 条豁免行，防止豁免类空转绿。红证：旧码 FAIL（`expected an ephemeral receipt…`）。
- [ ] F223 （P2 视觉/首屏，第50轮真实玩家走查）两个视口都没有唯一主行动，桌面还右下沉一大片空：vision 对 `walk-20261118T0832Z-m2-first.png`（390）判「视觉最抢眼的是第二行大按钮，但『探索前进』又带数字 1 和亮蓝框，主 CTA 至少两三个候选，不唯一」、对 `d2-first.png`（1440）判「右下与底部右侧大片暗色空白，内容集中左上，三栏失衡」「材质与按钮样式同质、主视觉焦点不足」；另两遍都读到顶栏属性行最右「攻20」贴边。要求：① 同一时刻只允许一个按钮带主行动样式（`.btn-primary` 或等价），剧情选项出现时由选项接管主位、通用四键降为次级；② 1440 下把右栏底部与正文下方的空白用"下一步提示/进度/任务卡"填到 ≤20% 视口高，或收窄容器使三栏等重；③ 390 下顶栏属性行不得有元素贴视口右边（已在 F214 修 XP，此项针对其余 stat）。断言：`node scripts/assert/primary-cta-unique.mjs` —— 390/1440 各断言首屏 `button` 中带主行动样式的元素恰好 1 个；断言 1440 首屏底部空白区高度 < 0.2×视口；断言 390 下 `.status-nums .stat` 每个 `getBoundingClientRect().right <= innerWidth - 8`
  verify: node scripts/assert/primary-cta-unique.mjs
  risk: low
- [x] F224 （P2 发现性/桌面端死路，第55轮部署后自查）帮助入口只在窄屏存在：`.drawer-toggle` 与 `.help-toggle` 的基线样式是 `display:none`，只有 `@media (max-width:880px)` 里 `display:block`，所以 1440 桌面视口顶栏既无「档案」也无「?」——而 F221 已把兜底回包里的指令表尾巴整段删除，宽屏玩家现在**没有任何**发现指令表的路径（只能自己猜着输入「帮助」）。要求：① 桌面（>880px）提供可见的帮助入口（顶栏 `?` 键或正文外的固定帮助锚点，不得塞回叙事正文）；② 窄屏行为不变（仍走 `.help-toggle`，不得重新占用 `.drawer-toggle` 唯一选择器）；③ 点击后与服务端「帮助」指令同一条 dispatch，指令表落日志行。断言：`node scripts/assert/help-entry-desktop.mjs` —— 1440×900 下 `.help-toggle` 或等价的帮助锚点 `isVisible()` 为真且 44px 触达；点击后 `.stage-col` 新增一行含「前进」与「帮助」的指令表；390×844 下帮助键仍可见、`.drawer-toggle` 仍唯一（count===1）
  verify: node scripts/assert/help-entry-desktop.mjs
  risk: low
  done(第56轮): 只动 `client/src/styles.css`（19 行）：把 `display:none` 从 `.drawer-toggle, .help-toggle` 共享基线里摘掉，
  `.drawer-toggle` 单独保留 `display:none`（宽屏有右侧常驻档案栏，桌面不需要抽屉），`.help-toggle` 提为桌面基线 `display:block`；
  窄屏 `@media (max-width:880px)` 里的 `display:block` 相应删掉，只留 `order`/`margin-left` 排布。共享观感（hull-2 底、44px 触达、
  `min-width:44px`）不变。新增 `scripts/assert/help-entry-desktop.mjs`（208 行，自起隔离实例 + worktree 自己的 `client/dist`）：
  1440 命中 44×44 可点、点击后 `.stage-col` 多出含「前进/帮助」的指令表行、`.stage.top` 前后都是 71（顶栏不增高）、
  `scrollWidth-clientWidth=0`；390 下帮助键仍可见且 `.drawer-toggle` count===1。红证：把 dist CSS 的 `.help-toggle`
  改回 `display:none` → 断言必红（`1440 桌面下 .help-toggle 不可见`），复原后连跑 2 次均 PASS。
  部署后线上 1440 复测：`.help-toggle` 位于 x=1376、44×44、点击落指令表、stage top 71→71、无横向溢出、无 pageerror。

- [x] F225 观察动作的代价没落到数值上（P0 零成本空转）｜第47轮走查：新档连点「环顾四周」6 次，HP 恒 100/100、MP 恒 20/20，XP/金币不变；第 5 次文案「收获不会再多一分，体力却一直往下耗」、第 6 次「动静攒过了头，附近的东西已被惊动：再挪一步多半要正面撞上」，机制上什么都没发生（`game-balance-analyst` 死选项 + `narrative-systems-designer` Dissonant）。verify: `node scripts/e2e/observe-cost.mjs` 新档连点观察 6 次，断言 HP 或 MP 至少一项单调下降（≥1 点/次）或第 4 次起返回 must_choose/disabled；若走“省略消耗”路线则断言第 4 次后按钮 disabled，且正文不再出现「体力…耗」类承诺
  verify: node scripts/e2e/observe-cost.mjs
  risk: med
  done(第58轮): 侦察确认 P207/F216 已把「前 3 次免费观察 / 第 4 次起 encounter_clock +1 + 动静 N/4 可见计数」钉死，observe-economy 还证明保底账兑现为真实遇敌——
  所以本轮**不**改成扣 HP/MP（会推翻免费观察契约，observe-economy / observe-after-cap / action-prose-by-chapter / observe-prose-concrete / no-placeholder-prose 五个断言全红），
  只修真实残留矛盾：`OBSERVE_OVER_LINES[1]`「体力却一直往下耗」与 hp/mp 全程不变相悖（承诺了不存在的扣血）→ 改口「逗留的动静却在一格一格往上走」，
  并在 P207 注释里写死口径「代价只许如实写动静/时间」；观察全线文案（进度尾注 / 复核池 / prose.js observe 池 / 风险尾注）复查无其它扣体力承诺。
  新增 `scripts/e2e/observe-cost.mjs`（206 行，自起隔离实例：空闲端口 + 临时 DB + AI key 置空）：新档连发 6 次「观察」，断言 (a) 前 3 次 hp/mp/scene 不变、
  (b) 第 4–6 次 encounter_clock 严格 +1 且「动静 N/M」N 严格递增、(c) 6 条回包零「体力…耗/耗…体力」虚假承诺、(d) 复核区每条含前进/休息/潜行指引、(e) 正文非空且前 3 次带场景名前缀。
  红证：`OBSERVE_OVER_LINES[1]` 复原旧句 → (c) 在第 5 次观察 FAIL（exit=1），复原新句 PASS。自测：observe-cost 3 连跑 PASS（1.5–1.9s）、
  observe-after-cap / observe-economy / observe-prose-concrete / action-prose-by-chapter / no-placeholder-prose 全 PASS、`cd server && node --test` 242 pass / 0 fail。
  遗留：本条「扣数值代价」的字面诉求被 P207/F216 的免费观察契约否决；若日后要真扣 HP/MP，须先重开免费观察契约（连带改 5 个断言），不宜单轮内动。
- [x] F226 决策未做时连点「前进」无限追加系统行（P0 拒绝刷屏）｜第47轮走查：must_choose 状态下连点「探索前进」8 次，`.stage-col` 由 20 → 36 行（每次 +2），HP/MP/XP/金币零变化；同一句拒绝可无限写进日志、把正文顶走。
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/reject-spam.mjs
  risk: low
  done(第57轮): 根因是库层已去重（P206 `choice_refusal_repeat`）但前端不知道：`/action`、`/ai-action` 的 refused 回包新增 `choice_refusal_repeat:true` 下发，
  且重复拒绝时连 user 行也不再落库（避免刷新后条数与界面不一致）；`client/src/App.tsx` 的 `dispatch` 收到标记后撤回乐观追加的 user 行、
  不追加 reply 行，本次拒绝改走既有 `.sys-toast` 瞬时层（2.6s 自消，不进 `.stage-col`）+ 既有 `flashChoices()`，首条拒绝正文与选项组始终留在页面上。
  新增 `scripts/e2e/reject-spam.mjs`（193 行，自起隔离端口/临时 DB，直落 `ch1_law`）：首拒 10→12 行（照旧 +2），6 连点 12→12（增量 0），
  「必须做出选择」+3 个选项名仍可见，HP/MP/XP/金币零变化；PASS 10.0s。冒烟 boot 5.5s / action 6.3s 均 PASS，连跑 2 次稳定。
- [x] F227 刷新续档丢 9 条非回执日志（P1 续档一致性，F222 的扩大）｜第47轮走查：战斗+抉择后 `.stage-col` 64 行，刷新后 55 行，最后一条逐字相同、数值全对；F222 的豁免白名单只认「已调出技能/道具面板|【警报】与系统的连接中断」，战斗行与叙述行仍在丢。
  verify: node scripts/e2e/resume-log-count.mjs
  risk: med
  打完一场并做一次抉择后记录 n0 与末 3 条，刷新后断言 n1===n0 且末 3 条逐字相同（豁免白名单不得扩大）
  done(第59轮): 根因是 `client/src/App.tsx` 续档/切档回灌只取 `LOG_PAGE(=50)+1` 条并 slice 末 50，
  内存里累积的 60+ 行刷新后必然缩水；改为 `resumeLog()` 一次取到 `LOG_CAP(200)`（与「加载更早」上限同口径），
  行数顶到 200 时才保留「加载更早」入口。服务端/存档结构/端口零改动，豁免白名单未扩大。
  新增 `scripts/e2e/resume-log-count.mjs`：旧码 82→80 FAIL（丢最旧 2 条）、新码 82→82 PASS，
  且断言以服务端日志条目数 >50 为覆盖前提（F167 一段拆多行会假绿）；F222 `reload-log-parity` 仍 PASS。
- [x] F228 双视口没有唯一主行动（P2 视觉，F223 复现）｜第47轮 vision：`walk-20261118T1110Z-m1-first.png`（390）判「四个探索键 + 两条剧情分支 + 页签三层同权重，不知道点哪」；`walk-20261118T1110Z-d1-first.png`（1440）判「多个入口竞争主次，右下大片暗色留白」。建议把续档页那条「先『观察』一次四周，看清线索后这一步才放得开」的引导前置到首屏主 CTA 位。
  verify: node scripts/e2e/primary-cta.mjs
  risk: low
  断言 390 与 1440 下首屏存在唯一 `.cta-primary`（或等效高亮类），且同权重可点按钮不含第二个描边高亮
  done(第60轮): devin swe-2-high 落地 `pickPrimaryCta(save, liveCombat)` 单一事实源——分支组有未锁定项 →
  第一条分支键接管主位（四探索键降回哑光 `.btn`）、交战 → 「攻击」、其余落在行动组「前进」槽（叫阵/
  终章/下章/折返四态同槽）；实心系统青 + 微光 `.btn.cta-primary`，全屏同刻恰 1 颗，epilogue 横幅入口与
  叫阵态「叫阵·攻击」同步降级。新断言 `scripts/e2e/primary-cta.mjs`（双视口 6 条，13 可点键仅 1 发光）。
  验收：隔离实例 verify PASS（390/1440 各 1 颗，点后仍 1 颗）、`repetition-and-jargon` / `combat-lock-hint`
  双绿（后者旧码基线本就红，主位落到分支键后 3 步直落守关房）、部署内置 E2E 11/11、线上 verify PASS。
- [x] F229 顶栏数值行贴边与字号（P2 排版）｜第47轮 vision 在 `m1-first` 与 `m16-resume` 两次把「攻20」读成「攻2」（疑似右边缘被裁），移动端「金币」字号过小 vision 读不出（桌面能读到「金币17」）。
  verify: node scripts/e2e/stat-row-fit.mjs
  risk: low
  390 宽度下量 `.status-nums .stat` 末项 `getBoundingClientRect().right <= innerWidth - 8`，且正文字号≥11px、数值≥12px（脚本待建）
  done(第62轮): devin swe-2-high 纯 CSS 24 行 + 新断言 `scripts/e2e/stat-row-fit.mjs`（自起隔离实例，照抄 deny-feedback.mjs 的起法）。
  根因：≤880px 档 `.status-nums` 是 nowrap+横滚，390 下 scrollWidth 460 对槽宽 366——「防」「金币」整格落出视口、
  「攻20」右缘压进 28px 右缘渐隐被读成「攻2」。修法：`.status-nums` 加 `padding-right:28px`（与渐隐等宽，
  装得下时末项整格落在渐隐外）；≤640px 档并入 F214 媒体块——间距 sp-4→sp-2、label 13→11px(--fs-xs)、
  数值 12px、`.xp-bar` 48→24px，桌面档零改动。实测 390：最右「金币0」right=350（限 382）、零横滚；
  1440：right=1352（限 1432）。红证已实测（撕修复 → `防9 right=418 > 382`）并写进脚本头注释。
  验收：verify F229 PASS、boot/action PASS、ci-deploy 内置 E2E 13/13（含 stat-row-fit 9.0s）、health 200 + 公网 200，
  部署后线上直跑 stat-row-fit 复验 PASS。注意：`bash scripts/ci-deploy.sh` 自带 `flock -n`，外面再套 `flock .deploy.lock`
  会被判「another deploy is running」，须直接执行脚本。


- [x] F230 「动静」满格零后果——观察可无限白嫖（P0 零成本空转）｜第48轮实测：连点「观察」7 次 HP/MP/XP/金币全部 0 变化，第 7 次文案已写「动静 4/4，附近的东西已被惊动：再挪一步多半要正面撞上」，随后前进既没遭遇战也没扣血。`core-loop-designer` 的 Decision 缺失 + `game-balance-analyst` 的支配策略（观察零消耗，永远优于前进）｜verify: 状态满足 `动静>=4/4` 后，下一次「前进」必须返回遭遇战事件或 HP 扣减，断言 `/game/api/state` 的 `hp|mp|flags.danger` 与文案一致；脚本 `scripts/e2e/dwell-consequence.mjs`｜risk: med
- [x] F231 must_choose 未决时「前进」静默拒绝，且首次 6.41s 无回包（P0 无反馈）｜第48轮实测：3 次连点「前进」耗时 6.41s/1.1s/1.1s，日志行数恒定 12，无 toast、无按钮 shake、无任何可见提示，只有一行复述三个选项名的系统句。`game-detail-bar` §2「Every action answers at once in sight, sound and motion」｜verify: 拒绝路径必须在 300ms 内出现可见拒绝元素（`.toast, .deny-hint` 之一，`getBoundingClientRect().height>0`），且连点 3 次新增日志行数 ≤1｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/deny-feedback.mjs
  risk: low
  done(第61轮): devin swe-2-high 落地三段改动。① 服务端 `sceneView` 下发 `must_choose`（非必选场景同样有 ≥2 分支，
  前端不能再按选项个数猜门）；② `/ai-action` 增 `mustChooseAdvance` 预选门——规则词表判 advance + 场景 must_choose +
  非交战时与散文快路径同走 `resolveAction`，必拒指令不再白跑 AI 网关（线上首包 6.41s 的成因就是这次上行），
  `/action` 本无 AI 调用天然在网关前命中同一 refused 分支；③ 前端 `dispatch` 在点击当帧点亮既有 `.sys-toast` 槽位
  （文案「抉择未定——先选一个：点选项键，或输入「选择 <选项名>」」，镜像 server/ai/keywords.js 的 advance 词 +
  疑问句守卫 + 早位意图排除，避免「观察再走」这类被早位意图接走的输入谎报），同步触发 F219 选项组闪光；回包侧
  `refused && intent==='advance' && must_choose` 补亮同槽位；重复拒绝 toast 不再复读三个选项名。`.sys-toast` 加
  `max-width + text-overflow:ellipsis` 防 390 横溢。
  新断言 `scripts/e2e/deny-feedback.mjs`（305 行，自起隔离实例）：拒绝元素先于回包可见（同表 performance.now，防快回包洗绿）、
  可见延迟 <300ms（实测 44/45/47ms）、回包 <800ms（实测 227–252ms）、连点 3 次 `.stage-col` 增量 ≤1（实测 0）、
  HP/MP/XP/金币双口径零变化、390 无横溢 + 1440 不盖档案栏。红证：旧码（stash + 旧 dist）跑新断言必红
  （「1.5s 内未出现可见拒绝元素——静默拒绝旧毛病」），复原后连跑 4 次 PASS。
  验收：verify F231 PASS(8.8s)、reject-spam / primary-cta / boot / action PASS、`cd server && node --test` 242 pass 0 fail、
  `tsc --noEmit` clean；ci-deploy 内置 E2E 12/12（含 deny-feedback 7.2s），health 200 + 公网 200，
  线上 bundle 已含新文案。API 探针另证 `选择 1` 照常落地、非必选场景「前进」正常推进（门禁未吞出路）。
  遗留：前端那组 advance/早位意图正则与 `server/ai/keywords.js` 是镜像关系（仅用于当帧提示，服务端仍是唯一裁判），
  若日后词表改动需同步，最好把词表抽成共享 JSON 由前后端同引。
- [x] F232 「休息」按钮可点但完全无反馈（P1 死选项）｜第48轮实测：满状态连点「休息」3 次，每次 0.9s，0 新日志、HP/MP 不变、无提示、按钮不是 disabled。`intuitive-game-design` 的三层反馈（Immediate/Post 全缺）｜verify: 满状态点「休息」后 300ms 内出现「体力与魔力俱满，无需休息」提示，或按钮置 `disabled + aria-disabled="true"` 并在 DOM 有原因文案；`scripts/e2e/rest-feedback.mjs` 断言二者其一｜risk: low
- [x] F233 首次建档未写 save_id，刷新回落「觉醒协议」页（P1 续档摩擦）｜第48轮实测：觉醒后刷新 `localStorage` 为空、页面回到觉醒页需再点「继续这个存档」；点过之后才出现 `solo_leveling_save_id`。文案「存档绑定本机浏览器」与行为不符 ｜verify: 建档成功 1s 内 `localStorage.getItem('solo_leveling_save_id')` 非空；reload 后直接进主界面且不出现「继续这个存档」按钮｜risk: low
- [x] F234 首屏视觉三项：无唯一主行动（F228 修复未上线）、属性行字号过小、「攻20」被读成「攻2」（P2 视觉）｜第48轮 vision 对 `docs/runs/walk-20261118T1315Z-m1-first.png`（390）判「四个探索键 + 两条剧情按钮权重完全相等，不知道点哪」，且对 `m6-combat` 再次把「攻20」读成「攻2」；另 `> 左上还有 地图/任务/影子/战斗/存档` 这句说明书直接印在系统框内。注：仓库已有 `111ece0 merge feat/F228` 的 cta-primary 修复，但线上未生效，需确认部署 ｜verify: 线上 390 与 1440 下 `document.querySelectorAll('.cta-primary').length===1`；`.stat-row` 字号 ≥11px 且末项 `getBoundingClientRect().right <= 容器宽度-8`；系统框内不含「左上还有」文本｜risk: low

- [x] F235 ✅ (2026-11-18 devin swe-2-high) 前后端意图词表镜像漂移风险（P3 工程，第61轮 F231 遗留）｜F231 为了在「点击当帧」就能给出拒绝回执，在 `client/src/App.tsx` 里镜像了 `server/ai/keywords.js` 的 advance 词、疑问句守卫与早位意图族（观察/攻击/防御/道具/逃跑…）。服务端仍是唯一裁判，镜像错只会导致「提前弹提示」偶发不准，但两份词表一旦分叉就会长期无人发现。要求：把意图判定词表抽成单一 JSON（如 `shared/intents.json`），`server/ai/keywords.js` 与前端同引（前端走 Vite 的 JSON import），并把 advance/早位意图的顺序语义写进该文件的注释。断言：新增 `node scripts/assert/intent-vocab-single-source.mjs` —— 断言仓库内只有一份意图词表定义（在 `server/ai/**`、`client/src/**`、`scripts/**` 里 grep advance 正则字面量，命中数 ≤1 且指向 shared 文件），并断言 `deny-feedback.mjs` 与 `choice-refusal-dedupe.mjs` 仍 PASS｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/assert/intent-vocab-single-source.mjs

- [x] F236 （第62轮调度侦察）F232「休息无反馈」疑似已被 F177 覆盖，需现场证据而非再改一遍｜代码现状：`server/index.js` 的 `restStatus()` 在 hp/mp 俱满时返回 `available:false, reason:"体力与魔力俱满，无需休息"`；前端 `App.tsx` 已有 `disabled={busy||restBlocked}` + `.rest-hint` 可见文案；线上新档实测 `footer.actions` 的「休息」按钮 `disabled="" aria-disabled="true"` 且 `.rest-hint` 显示「体力与魔力俱满，无需休息」。而第48轮走查报「按钮不是 disabled、每次 0.9s」。要求：用 Playwright 现场复现三分支（新档满状态 / hp<max 可休息 / 配额用尽）并留截图，再决定 F232 是改代码还是判为已修；反馈必须是玩家可感知的（常驻可见文案或日志增量），不得把 hover/title 当反馈
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/rest-feedback.mjs
  risk: low
  done(第67轮): **F232 的 48 轮结论证伪，不改产品代码。** 新增 `scripts/e2e/rest-feedback.mjs`
  （自起隔离实例 + 临时 DB_PATH + DB 直改存档，三分支各留截图）实测：
  A 满状态 → `disabled=true aria-disabled=true`，`.rest-hint` 可见「体力与魔力俱满，无需休息」，
  DOM click 后 `.stage-col` 子节点 10→10 零增量（禁用键不吃点击）；B `hp=50,max=100,rest_used=0`
  → `disabled=false`、`.rest-hint` 不渲染，真点击 2 次日志 10→18 且存档 `hp 50→100` 真回满
  （`rest_used=2`）；C `rest_used=3` → `disabled=true`，`.rest-hint`「本章休息次数已用完（0/3）」。
  即「按钮不是 disabled / 点了无反馈」在现网不成立（F177 已覆盖），三分支均有玩家可感知反馈。
  负向锁：B 分支断言 `disabled===false`，写死禁用会红。稳定性：调度器侧连跑 3 次 PASS（11.0/16.1/11.3s），
  devin 侧 3 次 PASS；boot/action 冒烟 PASS；合入 main 后 `verify.sh F236` PASS（17.5s）。
  备注：48 轮走查当时大概率为旧 dist 未部署；本条纯断言，无产品代码改动，故未触发部署。

- [x] F240 观察见底后的指路文案把玩家推向被门禁锁死的「前进」（P1 指路冲突）｜第49轮实测：场景 `must_choose`（三个剧情选项）时，观察第 5、6 次的括号提示写「说「前进」或「潜行」马上动身」，但同屏「探索前进」必被拒（点击后 80ms 出 toast「抉择未定」，日志 0 增量）。玩家照提示操作会连续吃两次拒绝。`intuitive-game-design` Q2 Affordance gap（Perceived 与 Real 不一致）、`narrative-systems-designer` 的 Irrelevant Choice｜verify: 新增 `scripts/e2e/dwell-guidance.mjs`——在 `must_choose` 场景连点「环顾四周」6 次，断言每次新增正文里的指路句**不含**「前进/探索前进」且**必须**包含至少一个当前真实可点的选项键文案；同时断言该场景下「前进」仍返回 refused（门禁不被文案改动顺手打开）｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/dwell-guidance.mjs
  risk: low
  done(第62轮): devin swe-2-high 落地观察区指路改造——`server/index.js` 新增 `mustChooseGuide`（选项 label 取自
  scene.choices，与 P204 拒绝正文同一「、/或」串接），must_choose 场景下 observeClosing 收束、
  OBSERVE_OVER_LINES 复核正文池、observeOverRiskTail 风险尾注三处指路全部改点名真实选项；非必选场景
  文案一字未动，「探索 N/N」计数口径不变，必选门判定未碰。新断言 `scripts/e2e/dwell-guidance.mjs`
  （自起隔离实例，DB 直落 ch1_law）：连点 6 次「环顾四周」回包正文均无「前进」、6/6 点名真实选项，
  随后「探索前进」仍 refused + HP/MP 零变化。红证：旧码第 1 次观察即 FAIL（「或说「前进」」）。
  验收：verify F240 PASS、dwell-guidance 连跑 3 次 PASS、boot/action PASS（本地实例）、
  `cd server && node --test` 242 pass 0 fail。
- [x] F241 观察 4–6 次的括号提示逐字复读（P1 文本质量）｜第49轮实测：连续 6 次观察，第 4/5/6 次新增 125/116/115 字，除 `动静 1/4 → 2/4 → 3/4` 的数字外，`这一带已经看熟——你逗留的动静越积越明显，黑暗里的东西迟早会循声找来——说「前进」动身，或说「潜行」绕开。` 三处完全相同。`game-detail-bar` §5「Content that never repeats」｜verify: 新增 `scripts/e2e/observe-dedupe.mjs`——同一场景连点 6 次「环顾四周」，把每步新增正文按句号切分，断言任意单句出现次数 ≤2，且去重后不同句子数 ≥6｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/observe-dedupe.mjs
  risk: low
  done(第64轮): devin swe-2-medium 定位到根因在 `observeOverRiskTail`——正文池按 clock 轮换，唯独风险尾注只有「未过/已过保底线」两个固定变体，
  故 4–6 次观察除「动静 N/4」外逐字复读。改法：四组措辞池（普通/必选 × 未过/已过）各 3 条，种子取推进后的 `clockNext`（每轮观察稳定 +1，确定性可复现，无随机数）；
  「动静 N/4」计数串、`clockNext >= PITY_LIMIT-1` 写「已被惊动」、`encounters:"none"`/终章/must_choose 分支与指路（不含「前进」）口径全部未动。
  新断言 `scripts/e2e/observe-dedupe.mjs`（168 行，照 observe-cost 的隔离实例 + fetch 打法）：6 次观察正文先剔场景名前缀，再按 `。！？` **与 `——`** 切句、数字归一后统计；
  断言单句 ≤2 次、去重 ≥6 句、复核区仍带「动静 N/4」。红证（实测）：只按句号切旧码会因计数串进句而假绿，加 `——` 切法后旧码 FAIL「说「前进」动身，或说「潜行」绕开」出现 3 次。
  验收：verify F241 PASS(1.74s)、observe-dedupe 连跑 2 次 PASS、observe-cost/dwell-guidance PASS、server `node --test` 242 pass 0 fail；
  ci-deploy 内置 E2E 16/16、health 200 + 公网 https://openfolio.uk/game/api/health 200。
- [x] F242 桌面 1440×900 首屏正文末行被底部操作区截断（P2 排版硬伤）｜第49轮 vision 对 `docs/runs/walk-20261118T1519Z-d2-main.png` 明确报「正文最底部一行被底部固定操作区遮挡/截断，首屏阅读不完整」；同屏底部并列 行动四键 / 选择两键 / 系统八键 / 自由输入 四层，主 CTA 被四个平行行动键稀释。`game-detail-bar` §9b Layout that never spills out of its frame｜verify: 新增 `scripts/e2e/stage-bottom-clearance.mjs`——390 与 1440 下量 `.stage-col` 最后一行 `getBoundingClientRect().bottom` 与 `.actions` 顶部 `top`，断言间距 ≥8px；并在日志滚到底后断言最后一行完整可见（未被 fixed 层覆盖，`elementFromPoint` 命中正文而非 `.actions`）｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/stage-bottom-clearance.mjs
  risk: low
  done(第65轮): devin swe-2-high 先量后改，发现**真因不是矩形相交**——滚到底态本来就有 49.8px/41.7px 间距（朴素「间距 ≥8px」断言对旧码假绿），
  缺陷是停顶/中滚位时 `.stage-col` 裁剪缘把最低可见行拦腰铡断（1440 停顶 `.narration` 越出裁剪缘 108.3px、390 停顶 `.holo` 越界 25.8px，
  与 walk-20261118T1519Z-d2-main.png 完全对应）。改法纯 CSS：`.stage-col` 加 `--edge-fade`（== 下内边距同一 var，桌面 sp-8=32px、≤880px 同步 sp-6=24px）
  + `mask-image` 下缘渐隐（含 `-webkit-`），停顶/中滚时越界行溶出而非铡断，滚到底时末行完整停在渐隐区之上、零变暗；与 `.status-nums`/`.sys-fade` 同一渐隐语言。
  `.stage-col` clientHeight 改前/改后 559/444 → 559/444（Δ=0，未拿空白换可读行数）。新断言 `scripts/e2e/stage-bottom-clearance.mjs`（373 行，照 attr-plus-disabled 隔离实例骨架）：
  两视口各测停顶态越界像素 + 下缘渐隐存在、滚到底末行与 `.actions` 间距 ≥8px、`elementFromPoint` 命中 `.stage-col` 正文、无横溢、`.stage` 与 `.actions` 矩形不相交（防「把底栏挪出视口」洗绿）。
  验收：verify F242 PASS(6.49s，改前红证写在脚本头注)、stage-bottom-clearance 连跑 2 次 PASS、desktop-layout/mobile/boot/action PASS；
  ci-deploy 内置 E2E 17/17、DEPLOY OK、health 200 + 公网 https://openfolio.uk/game/api/health 200。
  遗留（并入 F223 处理）：底栏四层并列（行动四键/选择两键/系统八键/自由输入）稀释主 CTA 的问题本轮未动，F223 的「唯一主行动」断言覆盖它。
- [x] F243 属性面板「剩余属性点 0」时 `+1` 按钮无明确禁用态（P2 死选项视觉）｜第49轮 vision 对 `docs/runs/walk-20261118T1519Z-m7-属性.png` 报「剩余属性点为 0 时 +1 按钮虽较暗，但没有明确禁用态，容易让人误以为仍可点击」，且 `+1` 按钮距右侧面板边缘安全边距偏小。`intuitive-game-design` Q2 的 signifier 缺口｜verify: 点数=0 时断言每个 `+1` 控件 `disabled===true` 或有 `aria-disabled="true"` 且 `opacity ≤ 0.45`；390 下 `+1` 右缘距面板内边 ≥8px（脚本 `scripts/e2e/attr-plus-disabled.mjs`）｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/attr-plus-disabled.mjs
  risk: low
  done(第63轮): devin swe-2-high 只改样式 + 新断言（StatsPanel 的 disabled/aria-disabled/onSpend 本就正确，逻辑零改动）。
  ① `.stat-add:disabled` 换成「空槽」signifier：虚线退边 + -45° 斜纹舱底（repeating-linear-gradient，--line-strong 同族青灰，
  无新色板）+ 去饱和字色（--faint）+ cursor:not-allowed，opacity 0.35→0.4（仍 ≤0.45），enabled 态视觉零改动；
  ② ≤880px 抽屉档 `.stat-panel .stat-line` 补 padding-right:12px，+1 右缘内收 12px（≥8），仪表条相应缩短，44×44 触达尺寸不动。
  新断言 `scripts/e2e/attr-plus-disabled.mjs`（240 行，照抄 deny-feedback/stat-row-fit 的隔离实例 + 直落 free_points 起法）：
  free_points=0 → 5 颗全 disabled + opacity≤0.45 + cursor=not-allowed；390 右缘内收 12.0px 且 docSW=390；1440 面板完整；
  反向 free_points=3 → enabled 5/5（防把按钮写死禁用洗绿）。
  红证（实测）：回退旧样式重建 dist → FAIL「「力量」+1 cursor=default」；390 边距旧码 gap 0 < 8。
  验收：verify F243 PASS(17.25s)、脚本连跑 3 次 PASS、stat-row-fit/deny-feedback PASS、server node --test 242 pass 0 fail、
  tsc --noEmit 干净；ci-deploy 内置 E2E 15/15、health 200 + 公网 https://openfolio.uk/game 200。


- [x] F244 观察 / 前进正文把整段选项清单拼进每一行，第 4–6 次还双层括注嵌套（P1 文本复读 · 日志腔）｜第51轮走查：连点「环顾四周」6 次，正文增量 +123/+118/+149/+192/+195/+196，但第 3–6 次行尾逐字重复「必须做出选择——说「按石碑所写，低头敬拜」、「退到石柱后，观察石像与石碑的对应」或「趁乱往石门方向逃」」，第 4 次外层括注里又套一遍同一串选项（一行内同一段话出现 2 次）。`game-detail-bar` §5 Content that never repeats + `narrative-systems-designer` The Info Dump｜verify: 新增 `scripts/e2e/observe-mustchoose-prose.mjs`——隔离实例落到 must_choose 场景后连点「观察」6 次，逐行断言：① 单行内「必须做出选择」≤1 次；② 单行内「按石碑所写」整串选项名 ≤1 次；③ 单行括号嵌套层数 ≤1；④ 6 行去重后的描述句 ≥4 句。回退旧码应 FAIL｜risk: med ✅ 第85轮（F244）：观察正文里整串选项名只在本场景第一次观察的收束句完整点名一次（dwell-guidance「至少一次点名」契约由这一次承担），其后收束句、复核区正文与风险尾注改挂不点名措辞「仍须在眼前这几条路中选定」——新增 MUST_CHOOSE_GUIDE_VAGUE，mustChooseGuide 本体不动（前进拒绝/自由输入/「看尽」拒绝行照旧）。
   verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/observe-mustchoose-prose.mjs
  risk: med
- [x] F245 ✅ (2026-11-18 第74轮 cron；devin swe-2-medium 两段：① 实现 `.rest-tap-catcher` 透明承接壳——restBlocked 时把禁用「休息」键包进 span（inline-flex 顶原生槽位、`::after` 全覆盖收点击），onClick/Enter/Space 调 `showToast(save.rest.reason)`，文案透传服务端 reason（满状态「体力与魔力俱满，无需休息」/次数用尽「本章休息次数已用完（0/3）」）；可用态整层不渲染，真回血路径与 F236「禁用键 DOM .click() 零增量」契约不变 ② 修自身引入的回归——承接壳让 desktop-layout 的 `.btn-group > .btn` 只数到 3，选择器扩到壳内按钮并新增 `hitTestAction`（命中允许落在键自身或其承接壳）。验收：verify F245 PASS(14.5s，A toast 18ms/可见 2838ms、B 13ms/2783ms、C catcher=0 且真回血 50→85)、rest-full-feedback 连跑 2 次 PASS、rest-feedback/action/boot/desktop-layout 全 PASS、ci-deploy 25/25 E2E PASS、health 200 + 公网 /game 200) 满 HP/MP 时点「休息」日志零增量、无 toast，只有常驻静态提示（P1 反馈真空）｜第51轮：HP 100/100 · MP 20/20 连点「休息」3 次，每次 `.stage-col` innerText 增量 0；100ms 采样 `.sys-toast` 为 null（同一条走查里「前进」被拒时 toast 80ms 内出现、存活约 1.5s，证明 toast 机制可用，是这条路径没接）。玩家无法判断这一下是否被系统收到。`game-detail-bar` §2「Every action answers at once」+ `intuitive-game-design` Q5 三级反馈缺 Immediate 层｜verify: 新增 `scripts/e2e/rest-full-feedback.mjs`——满状态点「休息」断言 200ms 内 `.sys-toast` 出现且文本含「体力」或「魔力」、可见时长 ≥1.2s（照 deny-feedback 的 80ms/时长写法）；反向：HP 降到 60 时点「休息」断言出现恢复文案而非拒绝文案｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/rest-full-feedback.mjs
  risk: low
- [x] F246 ✅ (2026-11-18 devin) 做完抉择后章节进度 2/7 掉回 0/7（刷新后仍是 0/7）（P1 进度显示回退）｜第51轮：选「退到石柱后，观察石像与石碑的对应」前状态栏为 `第1章 双重地下城 2/7`，抉择落地、拿到线索 `read_the_law`、进入遭遇后变 `0/7`，`goto` 重载后依旧 `0/7`（HP 97/100、MP 18/20、XP 10、金币 10 均正确续档，故非渲染抖动）。`game-detail-bar` §6「Never take away earned progress」显示层违约｜verify: 新增 `scripts/e2e/chapter-progress-monotonic.mjs`——记录抉择前 `status` 里 `\d/7` 的分子，抉择并等遭遇出现后再读，断言后者 ≥ 前者；再 reload 断言等于抉择后的值｜risk: med
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/chapter-progress-monotonic.mjs
  risk: med
  done(第66轮): devin swe-2-high 新增 `chaptersEngine.progressStepsOf`——支线站位按「出边（next_scene 优先、choices[].next 其次，只跟本章内）BFS 第一个可达主线链节点的下标」反推步数（链上照旧 = 位置+1），sceneView 与 /api/chapters 同用此口径，纯数据无随机；ch1_watch 据此显示 2/7 而非 0/7、也不虚增到 3/7。新断言 `scripts/e2e/chapter-progress-monotonic.mjs`（API 隔离实例）：抉择 2/7 → 支线守住 2/7（刷新/地图同分子）→ 回主线 3/7 → 死亡回溯落链首 1/7；旧码红证 `steps=0`（写在脚本头注）。
- [x] F247 ✅ (2026-11-18 devin swe-2-medium) must_choose 状态下「探索前进」仍实色全亮可点，只靠 1.5s toast 告知必被拒（P1 死选项 / 可负担性缺口）｜第51轮：状态栏已写「【系统】这里必须做出选择」，正文流里仍有「前进」入口、底栏「探索前进 1」仍与「环顾四周 / 潜行 / 休息」同尺寸同色；点它 → 正文 +0 字，80ms 后 toast「抉择未定——先选一个…」约 1.5s 消失。vision 对 m3 结论：「系统已写明必须做出选择，界面却仍保留正文右侧『前进』和底部『探索前进』入口，看不出被禁用或置灰」。`intuitive-game-design` Q2：优先改 Real，而不是靠提示补救｜verify: 新增 `scripts/e2e/forward-locked-in-choice.mjs`——落到 must_choose 后断言「探索前进」`disabled===true` 或 `aria-disabled="true"` 且 opacity ≤0.5，正文流「前进」同款；反向：非 must_choose 回合该按钮 `disabled===false`（防写死禁用洗绿）｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/forward-locked-in-choice.mjs
  risk: low
  done(第68轮): devin swe-2-medium 新增 `forwardChoiceLocked`（非交战 + sceneMustChoose + 非换标形态），「探索前进」叠加 disabled/aria-disabled 与指路 title，视觉沿用 .btn:disabled(opacity .45)；快捷键 1 同口径改弹 DENY_CHOICE_TEXT + 选项组描边，不再发必拒请求。换标（查看结算/叫阵/下章/折返）与交战撤离不受影响。新断言 `forward-locked-in-choice.mjs`：390/1440 实测 disabled=true aria=true opacity=0.45、title 含「选择」，反向普通探索档 disabled=false opacity=1 且点击正文 +5 行，无横向溢出；旧码红证写在文件头。deny-feedback.mjs 因按钮不可点改经输入框发「前进」，口径不变、仍 PASS。
- [ ] F248 战斗面板与战报互斥：面板一开正文战报被顶出可视区；且 390 下 stage 底与底栏只隔 1px（P2 版式/信息架构）｜第51轮实测：`.combat` 为 `position: static` 占位块（390 下 y=144–432、高 288），面板打开时正文「【战斗】石像残兵 HP 52→35」被挤出可视区，看血条就看不到战报；`.stage` 底边 646 与 `.actions` 顶边 647 只隔 1px（桌面 664/665 同样 1px，F242 要求 ≥8px）。`game-detail-bar` §9b Layout that never spills out of its frame + §9a「HUD that lives」｜verify: 新增 `scripts/e2e/combat-log-coexist.mjs`——交战态断言战斗面板与最新一条战报**同时可见**（两者 `getBoundingClientRect()` 均落在视口内且互不覆盖 ≥80% 面积），并断言 `.stage` 底与 `.actions` 顶间距 ≥8px（390 与 1440 各测一次）；回退旧码应 FAIL｜risk: med
  verify: 待实现 scripts/e2e/combat-log-coexist.mjs（落地后补命令）
  risk: med


- [ ] F249 「观察」零成本无限刷内容 + 同段原文重复堆叠（P0）｜第52轮实测：干净档点「环顾四周」×6，正文长度 1513→1631→1780→1972→2167→2363 **每次必涨**，而 HP 100/100、MP 20/20、XP 0、金币 0 **全程无一变化**，无遇敌无消耗；6 段「体积没有新变化」的描述逐段原样堆叠成文字墙（截图 `docs/runs/walk-20261118-1933-m7.png`）。`game-balance-analyst` Dominant Strategy / Dead option 判定 + `narrative-systems-designer` Info Dump 反模式｜verify: 新增 `scripts/e2e/observe-no-farm.mjs`——同一场景连点观察 6 次，断言 (a) 正文中**任意两段文本不完全相同**，(b) 第 3 次起观察返回「此处已无新发现」且按钮 disabled（或取得等价代价：扣除体力/推进回合），(c) 全程 HP+MP 之和变化量 ≠ 0 或明确标注为免费动作且不产出资源；旧码应 FAIL｜risk: med
- [ ] F250 must_choose 局面「探索前进」未锁定、连点静默吞键（P1，F247 疑似回归）｜第52轮实测：分支出现（按石碑敬拜 / 退到石柱后 / 趁乱往石门方向逃）后连点「探索前进」3 次——第 2 次正文 +93 字给出「输入『选择 <选项名>』」，**第 3 次正文长度 1413→1413 零变化**，且点击返回 `OK` 而非 `DISABLED`，按钮无灰化、无拒绝动效、无音效。违反 `intuitive-game-design` 三层反馈缺失 **Immediate** 层（症状正是玩家报「点了没反应」）｜verify: 复用 `scripts/e2e/forward-locked-in-choice.mjs` 并加一条——连续 3 次触发锁定后，`button[data-act=forward]` 的 `aria-disabled` 恒为 true 且每次点击都有可见拒绝反馈（正文行数或 toast 计数 +1）；若 3 次点击正文零变化则 FAIL｜risk: med
- [ ] F251 建档后首屏被「背包」侧栏自动展开遮住正文（P1）｜第52轮实测：觉醒成功进入第一幕时 `.side-panel` 已为打开态（`side-close` 可点、背包 tab 为 on），三段开场叙事全部被面板覆盖，玩家第一眼看到的是一张物品清单而不是剧情；`game-detail-bar` §9a「Prompts/cards never block play」+ `intuitive-game-design` Question 1 首 30 秒主动性｜verify: 新增 `scripts/e2e/first-entry-no-drawer.mjs`——干净 localStorage 建档进第一幕，断言 `.side-panel` 关闭、正文首段在视口内可见面积 ≥60%、无 panel 盖住 `.stage`；旧码 FAIL｜risk: low
- [x] F252 ✅ (2026-11-18 devin swe-2-high) 正文增量无视觉区分，6 次动作后成一堵同色文字墙（P1，视觉类）｜第52轮实测（`m7` 视觉分析）：新追加段落无分隔线、无时间戳、无淡入、无「最新一条」高亮，字号与颜色与历史文本完全一致，一屏只能容 2–3 段、需大量滚动才能找到本次结果。`game-detail-bar` §9c「Motion: every element moves」+ §9b「All text fits its box」｜verify: 新增 `scripts/e2e/log-increment-style.mjs`——连续 3 次动作后每个 `.log-entry` 有独立 class 且最新一条带 `data-latest="1"`（断言其 computedStyle 的 border-left 或 background/opacity 与上一条不同），且 390 宽下 `.log` 区域无横向溢出；回退 FAIL｜risk: med
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/log-increment-style.mjs
  risk: med
  done(第70轮): 每段日志包进 .log-entry（splitStageEntry 多段各成节点、ephemeral 标记上移以保住 resume-log-count 的直接子节点豁免），最末条挂 data-latest="1"；CSS 给条目 sp-5 间距 + 透明预留左轨 + 240ms 淡入（reduced-motion 归零），最新条 3px --system-dim 左轨 + rgba(79,200,255,.05) 淡底，padding 代偿保证高亮迁移不左右跳。新断言 log-increment-style.mjs 双视口（390/1440）连跑 2 次 PASS；boot/action/reject-spam/deny-feedback/stage-bottom-clearance/resume-log-count 全绿。`.log` 区域无横向溢出；回退 FAIL｜risk: med
- [x] F253 「休息」在满状态恒 DISABLED 却常驻动作栏，属死选项占位（P2，视觉/平衡）｜第52轮实测：开局满 HP/MP 连点 3 次均返回 DISABLED（文案「体力与魔力俱满，无需休息」），按钮仍以正常视觉占据第一排 1/4 宽度，~1/3 的正常游玩时间它都不可用。`game-balance-analyst` Dead option 症状 + `game-detail-bar` §9a「disabled shakes with the denied sound」 ✅ 第69轮：blocked 态降为 20px 虚线胶囊（垂直居中、隐藏快捷键角标、颜色降权不用 opacity），available 态恢复 44px；`rest-affordance.mjs` 锁 20/44 与 Δ24px，`rest-feedback.mjs` 三分支回归绿
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u DB_PATH -u E2E_BASE_URL -u API_BASE node scripts/e2e/rest-affordance.mjs
  risk: low
- [ ] F254 390 宽底部动作区四排 10+ 按钮挤压、长选项被撑成两行（P1，视觉类）｜第52轮实测（`m7` 视觉分析）：底部依次为 前进/观察/潜行/休息 → 3 个剧情选项 → 战斗/背包/技能/属性/地图/任务/影子/存档 → 自由输入 + Enter，共 4 排；「退到石柱后，观察石像与石碑的对应」两行文字把按钮撑高，功能按钮字号低于 12px。`game-detail-bar` §9b「Phones get their own layout」+ §9a「never system fonts or plain rect bars」+ 44px 触控下限｜verify: 新增 `scripts/e2e/mobile-action-bar.mjs`——390×844 下断言所有 `.actions button` 的 `offsetHeight ≥ 44`、正文按钮内文字行数 = 1（`scrollHeight ≤ clientHeight*1.2`）、字号 ≥13px、整条 bar 无横向溢出（`scrollWidth ≤ clientWidth`）、功能类按钮折叠进「更多」；1440 下同样跑一遍｜risk: med

- [x] F255 ✅ (2026-11-18 第54轮走查复测 4/4 通过，commit e9928c6) 手机端底部功能键（背包/技能/属性/地图/任务/影子）点了不打开抽屉，面板内容写进离屏 aside（P0，可负担性缺口）｜第53轮实测（390×844）：脱离交战后关闭抽屉，点底部「任务」→ `aside.sidebar` 类仍为 `sidebar`、`getBoundingClientRect().x=390`（宽 374，整块在屏幕右侧外）；再点「属性」同样停在 x=390，屏幕**零变化**（无滑出、无遮罩、无高亮）；只有右上「档案」会令类变 `sidebar open`、x=16、`.drawer-veil` opacity 1。决定性序列：`afterClose sidebar@16 → afterTask sidebar@390 → afterAttr sidebar@390`。玩家会认为按钮坏了，且完全查不到属性/任务/背包信息。`intuitive-game-design` Q2「优先改 Real，而不是靠提示补救」+ `game-detail-bar` §9b「Phones get their own layout」｜verify: 新增 `scripts/e2e/mobile-panel-open.mjs`——390×844 下依次点底部 背包/技能/属性/地图/任务/影子，每次断言 ① `aside.sidebar.classList.contains('open')` 为真、② `rect.left < innerWidth - 100`（真正进入视口）、③ 面板标题文本出现在可点区域内、④ 点 × 后类移除且 rect.left ≥ innerWidth-1；另断言点「档案」打开同一抽屉（对照组，防写死）。回退旧码应 FAIL 5/6 项｜risk: low
  verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/mobile-panel-open.mjs
  risk: low
- [ ] F256 正文机制括注/数值播报与三选项逐字复读（P1 文本质量 · 调试腔）｜第53轮：① 抉择后正文直接追加「（体力消耗 HP 100→97 · MP 20→18）」；② 连点观察 6 次，每次段落尾部都带「（探索 N/3 · …必须做出选择——说「按石碑所写，低头敬拜」、「退到石柱后，观察石像与石碑的对应」或「趁乱往石门方向逃」）」，同一串选项名 6 次逐字重复，第 5/6 次一行内「必须做出选择」出现 2 次；③ 自由输入回包混入元指令「说「观察」可以把四周再看一遍；说「前进」则是继续往里走」。`narrative-systems-designer` **Info Dump**（可删而不影响结果）+ `game-detail-bar` §5 Content that never repeats｜verify: 新增 `scripts/e2e/prose-hygiene.mjs`——落 must_choose 后连点观察 6 次，逐条断言 ① 单条正文中「必须做出选择」≤1、「按石碑所写」≤1；② 全文不出现 `（.*HP \d+→\d+.*）` 正则命中（机制括注归 HUD/战报，不入叙事）；③ 自由输入回包中不含「说「观察」」这类元指令；回退旧码应 FAIL 3/3｜risk: med
  verify: 待实现 scripts/e2e/prose-hygiene.mjs（落地后补命令）
  risk: med
- [x] F257 「动静 x/4」威胁计数不兑现：6 次观察停在 3/4，不触发遭遇也不扣血（**P0**，第54轮由 P1 升级：零成本重复获益 · 支配策略）｜✅ 已修：双径兑现——可掷怪场景在把 `encounter_clock` 推到 `>= PITY_LIMIT` 的那一次观察回包里直接走 `tryEncounter` 撞真实遭遇（`combat:{op:"set"}` + `【遭遇】` 播报 + clock 清零，「动静 N/4」尾注保留）；不可掷怪场景（`encounters:"none"`/终章）写【看尽】行并回 `save.observe={available:false,reason}`，前端「环顾四周」disabled + `aria-disabled` + `title` 理由 + 就地小字，刷新后仍锁定（日志行持久化，不加列）。`observe-threat-pays.mjs` 两轮均第 7 次观察撞遭遇；`observe-economy.mjs` 按新口径收紧（第 7 次断言撞怪、8+ 断言 refused）；`observe-cost`/`observe-dedupe`/`observe-after-cap` 全绿（1–6 次行为不变，阈值确认为 4 非 3）｜第53轮：连点「环顾四周」6 次，正文从「动静 1/4」涨到「动静 3/4」，第 6 次文案已写「逗留的动静攒过了头，附近的东西已被惊动：再拖下去多半要正面撞上」，但 HP 100/100、MP 20/20、XP 0、金币 0 全程零变化，未进入遭遇，观察按钮始终 enabled 且每次仍产出 ~190 字。威胁只是纸面压力，最优解仍是「一直观察」。`game-balance-analyst` Dominant Strategy 检测 + `player-experience-modeler` 情绪曲线（该有的 tension peak 没到）｜**第54轮复核（更强证据）**：连点到 8 次，计数 4/4 封顶后第 7/8 次文案升级为「越过了界…下一刻多半撞上」，HP 100/100、MP 20/20、XP 0、金币 0 仍零变化、不加遭遇、按钮不 disabled，每次仍产出 191/202 字——零成本收益无上限。｜verify: 新增 `scripts/e2e/observe-threat-pays.mjs`——同一 must_choose 场景连点观察至计数上限，断言 ① 第 4/4 次观察后 300ms 内出现【遭遇】或 HP/MP 下降（威胁必须兑现）；若设计为「不兑现」则断言 ② 计数达上限后观察按钮 `disabled=true` 且正文给出「此处已看尽」；旧码两者皆不满足应 FAIL｜risk: med
  verify: node scripts/e2e/observe-threat-pays.mjs
  risk: med
- [ ] F258 点「逃跑」后仍停在交战态、无明确失败战报（P2 反馈真空）｜第53轮：交战中点底部「逃跑」按钮，等 2.5s 后底部仍显示「交战中无法写入存档、也无法推进剧情 · 先「逃跑」或打赢这一场」，战斗面板与六键原样保留，正文末尾没有任何「逃跑失败/被拦下/仍被缠住」的战报行；玩家无法判断这一下是否被系统收到（同样的静默也出现在满状态「休息」，见 F245）。`intuitive-game-design` Q5 三级反馈缺 **Post** 层（有输入、无结果评估）｜verify: 新增 `scripts/e2e/flee-feedback.mjs`——交战态点逃跑，断言 600ms 内 `.log` 增量 >0 且含「逃」字，并且断言状态二选一：要么脱离交战（`.combat` 消失），要么仍交战但出现失败原因文本；两者皆无则 FAIL｜risk: low
  verify: 待实现 scripts/e2e/flee-feedback.mjs（落地后补命令）
  risk: low
- [x] F259 数字变化无动效：HP/XP/金币/进度静默跳变，经验只给文字不给进度条（P2 成长可见性 · 视觉类）｜第53轮：HP 100→97、MP 20→18、XP 0→10、金币 0→10、进度 2/7→3/7、战斗 52→35/97→92 都是一次性字符替换，无 count-up、无 bar 残影（`game-detail-bar` §9c「a lost chunk flashes, holds about 0.3 s, then drains」/「Numbers pop in with an overshoot」）；属性面板「经验值 0% 0/70 距离 Lv.2 还需 70 经验」纯文字无进度条。截图 `docs/runs/walk-20261118-2109-m9-attack.png`｜verify: 新增 `scripts/e2e/num-feedback.mjs`——触发一次扣血与一次加钱，断言 ① 150ms 内存在带 `data-anim=count` 或过渡中的元素（采样 3 次中至少 1 次中间值与终值不同），② HP 条存在 `.ghost`/`[data-ghost]` 残影节点，③ 属性面板经验条元素存在且宽度随 XP 变化；回退旧码应 FAIL｜risk: low ✅ (2026-11-19 devin+opencode)
   verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/num-feedback.mjs
  risk: low

- [ ] F260 手机首屏（390）主 CTA 不唯一：四排操作区同屏争夺注意力（P1，视觉/可负担性）｜第54轮看图（`docs/runs/walk-20261118-2200-m2.png`）：一屏并列 ① 探索前进/环顾四周/潜行/休息 ② 两个同尺寸剧情选项（「跟着队伍走向殿中央」亮蓝、「先放慢脚步…」暗色同宽）③ 战斗/背包/技能/属性 ④ 自由输入 + Enter，共 4 排 10+ 个可点目标；唯一最亮的蓝按钮不是唯一可点目标，新玩家会在「探索前进」与「跟着队伍走」之间犹豫（`intuitive-game-design` Q2 affordance gap 判据：应在首屏给**恰好一个**会动/会亮的可点对象；Q3 一次最多 3–4 个新元素被突破）｜verify: 新增 `scripts/e2e/mobile-first-cta.mjs`——390×844 干净档进入第一章后断言 ① 首屏（无滚动）可见 button 数 ≤ 6，② 恰好 1 个按钮带主行动语义（`[data-primary="1"]` 或唯一 `.btn-primary`），③ 该主按钮 height ≥ 其余可见按钮最大值 + 8px 且背景色饱和度显著更高，④ 剧情选项与探索键不同时出现在首屏（选项出现时探索键 disabled 或折叠进「更多」）；现码应 FAIL ①②④｜risk: med
- [ ] F261 正文增量高亮弱到不可见 + 日志容器底部硬切一行（P2，视觉类）｜第54轮：F252 已给最新条 3px `--system-dim` 左轨 + `rgba(79,200,255,.05)` 底色，但 m7 图结论是「基本不能分辨这一次新增了什么，只能靠语义猜」——高亮强度不足以在 390 高 DPR 屏上成立；另 `.log` 在 390 下 y=132 h=348，第 6 条 y=632，**末行被容器边界硬切**（无渐隐、无滚动提示），看图会被误判成「文字被遮挡/截断」`game-detail-bar` §9c「every element moves, with intent」+ §9b「All text fits its box」｜verify: 新增 `scripts/e2e/latest-entry-visible.mjs`——连做 3 次动作后 ① 最新 `.log-entry` 的 `border-left-width ≥ 6px` 且其背景与上一条的 ΔRGB ≥ 18（当前 ~5% alpha 不达标），② 存在 `[data-latest]` 的入场动画（`animationName != none`），③ `.log` 底部 24px 内存在渐隐遮罩元素或 `.log` 的 `scrollHeight <= clientHeight + 2`（不出现半行裁切）；现码应 FAIL ①③｜risk: low

- [x] F262 桌面端首屏正文最后一行被底部操作栏遮挡（P1，视觉类）｜第55轮 `d2` 图（1440×900）：中央叙事区第 4 段末行「当死亡临近，你没有屈服——于是，某个存在选中了你。」被底部 `.actions` 覆盖/裁切，首屏读者读到一半断在栏下；同屏还出现「亮蓝主按钮与浅色次按钮体量接近」的主次竞争。`game-detail-bar` §9b「Reserved HUD regions… they never stack」+ §9b「All text fits its box」
  verify: cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/desktop-log-occlusion.mjs
  risk: low
  完成说明（第75轮）：旧码上 ②③ 实红（无下滚提示、主 CTA 40px < 44+8）、① 未能复现（滚到底态旧码 last.bottom=634.4 ≤ actions.top=687.4，d2 图报的是底部 24px 渐隐区里那行半可见正文）→ 判为「缺下滚信号」。修法：`.stage-col` 可滚且未到底时在列底挂 `[data-scroll-hint]` 渐隐提示（到底即卸载）、`.log-entry` 补 `scroll-margin-bottom`、≥881px 主 CTA min-height 52px。脚本在隔离实例连跑 3 次稳定 PASS；boot/action/desktop-layout/stage-bottom-clearance/primary-cta 均 PASS。
- [ ] F263 战斗态两点反馈缺陷：正文夹杂机制括注 + 底部提示被六键压住（P1 文本/视觉）｜第55轮 `m14` 图（390×844）：① 叙事正文里直接写「（体力消耗 HP 100→97 · MP 20→18）」——数值播报混进小说，属 F256 的扩散；② 正文末行「交战中无法写入存档…先「逃跑」或打赢这一场」被底部战斗六键切断，玩家看不到战斗规则说明（`game-detail-bar` §9b「All text fits its box」）。`narrative-systems-designer` Info Dump + `intuitive-game-design` Q5 缺 Post 层｜verify: 扩写 `scripts/e2e/prose-hygiene.mjs`——落交战态后断言 ① 任一 `.log-entry` 不命中 `（.*HP \d+→\d+.*）`、② 战斗提示节点 `.combat-hint` 的 `bottom ≤ .actions.top`（不被六键覆盖）或已折叠进战斗面板内、③ `.log` 无被覆盖行（同 F262 判据）；现码应 FAIL ①②｜risk: med
- [ ] F264 手机战斗六键键高约 40px（<44 触控下限）且密度过高（P2，视觉/可负担性）｜第55轮 `m14` 图：3×2 不换行、不贴边，但键高约 40px，「连击 ×3 · 6MP」最紧、快捷键角标 1–6 很小；同屏下方还并列两排系统功能键（背包/技能/属性/地图/任务/影子/战斗/存档），战斗中 8 个非战斗键仍可点。`game-detail-bar` §10「touch targets at least about 44 px」+ §9b「Phones get their own layout」｜verify: 新增 `scripts/e2e/mobile-combat-keys.mjs`——390×844 进交战后断言 ① 每个 `.combat button`（攻击/连击/释放技能/防御/道具/逃跑）`offsetHeight ≥ 44`、② `scrollWidth ≤ clientWidth`、③ 交战态 `.btn-group-sys` 折叠或 `pointer-events:none`（战斗中不可误触系统页签）；现码应 FAIL ①③｜risk: low
- [x] F265 「探索前进」禁用态不可见：灰化不足、无角标、无矮化（P1，可负担性）｜第55轮 `m4` 图 + DOM：must_choose 下按钮 `disabled=true`（F250 逻辑正确），但视觉上与旁边可点的「环顾四周/潜行」同排同高，仅颜色略降，无「不可用/需先做选择」角标或锁定文案；老实测中玩家只能靠「点了没反应」推断。`intuitive-game-design` Q2（优先改 Real，signifier 未做够）｜verify: 扩写 `scripts/e2e/forward-locked-in-choice.mjs`——must_choose 下断言 ① `button[data-act=forward]` 的 `offsetHeight ≤ 可点同排按钮高度 − 8`，或存在 `[data-locked]` 角标节点且文案含「选择」、② 该按钮 `opacity` 与相邻可点按钮差值 ≥ 0.25 或 `filter: grayscale` 生效、③ 点击时出现可见拒绝反馈（toast 或正文 +1 行）；现码应 FAIL ①②｜risk: low ✅ 第78轮：键面左上 data-locked「需先选择」角标（与 .rest-count 同位点、绝对定位不增行高）+ .choice-locked grayscale(0.6)/brightness(0.82) 与同排可点键拉开质感差；disabled 键外包 .lock-tap-catcher 透明壳（F245 同构），真实点击点亮 .sys-toast「先做出选择——点选项键，或输入「选择 <选项名>」」并闪选项组。断言 forward-locked-in-choice.mjs 扩至角标/灰阶/真实点击回执，390+1440 双视口，连跑 2 次 PASS，旧码 FAIL
- [ ] F266 自由输入回包以元指令开头（「说「观察」…说「前进」…」）冒充正文（P2 文本质量）｜第55轮实测：干净档输入「我压低声音问队长：刚才那声惨叫是从石像后面传来的吗？」，回包首行是「系统 / 说「观察」可以把四周再看一遍；说「前进」则是继续往里走。」再接景物描写——教程被当成叙事正文塞回玩家。`narrative-systems-designer` Info Dump（删掉不影响结果）｜verify: 扩写 `scripts/e2e/prose-hygiene.mjs`——自由输入任意一句非指令自然语言，断言回包正文中不含「说「观察」/说「前进」」这类祈使教程句，教程改走帮助面板或 toast；现码应 FAIL｜risk: low

- [x] F267 快捷键「3」同时绑定「潜行」与「休息」，战斗中与系统键 5–9 重叠（P1，可负担性/输入）｜第56轮实测（390×844，`docs/runs/walk-20261118T2350Z-m2-firstact.png`）：DOM 读数为 `探索前进 1 / 环顾四周 2 / 潜行 3 / 休息 3`——同一个键位挂在两个动作上，按 3 到底走哪条完全靠实现顺序；进入交战后战斗六键（攻击/连击/技能/防御/道具/逃跑）无编号，底部系统组却仍是 `背包 5 / 技能 6 / 属性 7 / 地图 8 / 任务 9`，键盘玩家在战斗中按 5 会同时落在「道具」和「背包」两套语义上。`game-detail-bar` §10「Every key and button rebindable… a key already in use offers to swap」+ §9a「Prompts follow the bindings」｜verify: 新增 `scripts/e2e/hotkey-unique.mjs`——从 DOM 收集所有带 `data-hotkey` 的键帽并断言 ① 非交战态键位集合内无重复值（旧码「休息」的剩余次数与「潜行」键帽同读为 3），② 交战态同屏键帽无重复且系统页签在该态让出数字键位（旧码 道具/背包 同为 5），③ 按一次键只派发一个 `/api/action`（计数 = 1）且请求体就是键帽所指动作｜risk: low ✅ 第79轮：键位列成单一事实源（`actionHotkey/combatHotkey/sysHotkey`），键帽文案、`data-hotkey`、keydown 派发同源；交战态系统页签收掉数字键位（既不显键帽也不派发），rest-count 加 `data-rest-count` 与键帽区分。`hotkey-unique.mjs` PASS（非交战 1–9 唯一 / 交战 1–6 唯一 / 单次按键 1 次派发）
  verify: cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/hotkey-unique.mjs
  risk: low
- [x] F268 门牌页输入框与「觉醒」按钮零间距、面板内留白失衡（P2，视觉类）｜第56轮 `m1` 图（390×844）：输入框与按钮紧贴成一体、按钮距面板右缘过近，「猎人代号」四字几乎贴左缘；两行主文案字号字重完全相同，「检测到适格者」（情绪铺垫）与「登记猎人代号，接入系统」（操作指令）没有主次；底部「| 存档绑定本机浏览器… |」用竖线当装饰且上下留白不匀。这是玩家看到的第一屏，`game-detail-bar` §9b「Footer buttons sit at a fixed offset inside the bottom border」+ §9a「Explain before the player commits」
  verify: cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/gate-layout.mjs
  risk: low
  验收细则（第76轮实际落地口径）：390×844 打开门牌页断言 ① 输入框右边缘与「觉醒」按钮左边缘间距 ≥ 10px（实测 12），② 按钮右边缘距 `.holo-inner` 内容右内缘 ≥ 12px（实测 12），③ 输入框 `padding-left` ≥ 13px（实测 14；旧值 12px，故旧码红），④ 两行 `.gate-line` 的 `font-size`/`font-weight` 不相等（14px/w400 铺垫 vs 15px/w700 指令），⑤ `.gate-form` 390/1440 均无横向溢出；旧码实测 FAIL ①②④。
  完成说明（第76轮）：`.gate-form` gap 8→12px、`.gate-btn` 右侧 12px 内收、输入框 padding-left 14px、新增 `.gate-line-action`（15px/w700/正文色）区别铺垫句（14px/w400/--dim）、`.gate-note` 上留白 12→20px。devin swe-2-medium 一次通过；verify 线上 PASS 3.0s，gate-layout 隔离实例连跑 3 次全绿（2.1/2.2/2.4s）、boot/action 冒烟 PASS，ci-deploy DEPLOY OK（run-all 7/7），390 截图 vision 复核「间距清晰、主次分明、无贴边」。
- [ ] F269 桌面 1440×900 大屏利用率低 + 日志首条被顶部裁切（P2，视觉类）｜第56轮 `d1` 图：中央叙事列偏窄、左侧大面积暗色空白、日志列与右侧背包栏之间有肉眼可见的断层；更硬的问题是**滚动后的日志首条从半句开始**（截图顶部是「…石像残兵 HP 52→35 · 你 HP 97→92」），桌面首屏读者没有「这是接着上文」的信号。`game-detail-bar` §9b「Reserved HUD regions… they never stack」+ §1「Off-screen things that matter get an edge arrow」的同类原则（滚动边界要可读）｜verify: 新增 `scripts/e2e/desktop-log-top.mjs`——1440×900 连做 6 次动作后断言 ① `.log` 顶部 24px 内存在渐隐遮罩或 `[data-scroll-hint=up]`（不出现半行起始），② `.log` 宽度 ≥ 视口 45%（不像手机单列被拉宽），③ 叙事列与右侧栏之间无 >120px 的空带；现码应 FAIL ①③｜risk: low
- [ ] F270 战斗「连击 ×3 · 6MP」与「技能/道具/防御」的收益未披露，攻击可能构成支配策略（P2，平衡/可负担性）｜第56轮实测（`m5`）：石像残兵 52HP，普通攻击 17/17/暴击 27 三回合结束，全程无伤风险（仅受击 5 点）；MP 20 足够 3 次「连击 ×3 · 6MP」，而界面只写「连击 ×3 · 6MP」，从不说明 3 段总伤害、是否可被打断、与普攻的期望值差异——玩家没有依据判断「该连击还是该普攻」，`game-balance-analyst` **Option viability matrix**（每个选项需在某个场景最优，且玩家能看出为什么）与 §2「Efficiency analysis」要求披露 value-per-cost；「防御/道具」在本场完全没有存在理由（无高伤回合、无 MP 压力）= 潜在 Dead option。｜verify: 新增 `scripts/e2e/combat-option-info.mjs` + 数值表——① 交战态每个战斗按钮的 `title`/展开说明含效果数值（伤害区间或减伤 %、MP 消耗），② 服务端导出战斗动作期望值脚本 `scripts/assert/combat-ev.mjs` 对「攻击 vs 连击」按现有公式输出 DPS/MP 效率比，二者差距在 30% 内或存在情境反超（低 HP 收尾/高防目标），③ 同场景用「防御→攻击」与「纯攻击」各跑一局，断言回合数或承伤存在差异；现码应 FAIL ①｜risk: med

- [x] F271 抉择的文本形态只认序号/id，不认按钮上的完整选项文案（P1 逻辑死路）｜第75轮调度实测：must_choose 场景下 `POST /api/action {"input":"选择 1"}` 生效（intent=choice），但同一状态发 `「选择 按石碑所写，低头敬拜」`（就是按钮上印的文案，拒绝文案也教玩家「说出要做的选择」）返回 `intent=unknown` + 教程话术——照系统指示开口的玩家必然卡在抉择里，只能靠点按钮或猜序号。`intuitive-game-design` Q2 affordance gap（文字承诺与真实解析不一致）
  verify: cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/assert/choice-text-label.mjs
  risk: med
  验收标准：新档推进到 must_choose 场景后，依次发「选择 <选项完整文案>」「选择 <选项文案前 4 字>」，两次都必须 intent=choice 且场景推进；同时「选择 1」「选择 <选项 id>」仍生效（不回归）；旧码当前两项文案形态 FAIL。修法只动 `choiceSelFromInput` 的文案匹配（前缀/包含匹配按最长命中，歧义时回问），不改 UI 按钮与选项数据结构。

  完成说明（第77轮）：`choiceSelFromInput` 载荷 24 字/禁标点 → 80 字/允许标点+空白（按钮文案本身带「，」）；新增 `resolveSceneChoice`：id → 逐字 label → 唯一前缀(≥3 字) → 唯一包含(≥6 字)，短词不参与（保住 F075：「选择 观察」仍落 observe）；歧义如实回问候选、不推进，未命中仍列全部可选分支。断言自起隔离实例（1s），连跑 3 次全绿；旧码红证 `选择 按石碑所写，低头敬拜` → intent=unknown 原地不动。回归：choice-gate / choice-echo-label / choice-refusal-dedupe / choice-branching 全 PASS。devin 首调被免费额度限流（零改动）→ 已回退主模型实现。另：原条目误用重号 F267，本轮改为 F271。
- [ ] P211 （P1 工程死路，第78轮调度发现）部署闸门「假成功」：`scripts/ci-deploy.sh` 内部已 `exec 9>.deploy.lock; flock -n 9`，而调度口径再套一层 `flock .deploy.lock -c 'bash scripts/ci-deploy.sh'` 时外层先持锁 → 内层 `-n` 必然失败，脚本走 `another deploy is running` 分支并**以 0 退出**，调度器据此认为部署成功、其实一次都没部署（本轮实测连续两次假成功，改用 `bash scripts/ci-deploy.sh` 才真正发布）。要求：① 锁被占用时 exit 码非 0（如 3=busy），不得与成功同码；② 调度口径统一为直接 `bash scripts/ci-deploy.sh`（或脚本支持 `--wait` 自旋等待外层锁），并在脚本头注释与 README/AGENTS 里写清「调用方不要再套 flock」；③ `ci-deploy.sh` 结束时打印 `DEPLOYED_REF` 与本次部署的 client bundle hash，供调度器核对线上是否真的换包。断言：`node scripts/assert/deploy-lock-busy.mjs` —— 另起进程持 `.deploy.lock` 后调用入口脚本，断言退出码 ∉ {0} 且不打印 `DEPLOY OK`；空锁下调用一次断言退出码 0 且 `.deployed-ref` 前进
  verify: cd /www/Solo-Leveling && env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/assert/deploy-lock-busy.mjs
  risk: low

- [x] F272 抉择态下「观察 / 潜行 / 休息」可点但零反馈，玩家会以为卡死（P0，逻辑死路）｜第57轮实测（390×844 干净档，坐标真实点按）：推进到 `must_choose` 后「探索前进」正确 disabled 并弹「抉择未定——先选一个…」toast，但同屏的「观察」「潜行」「休息」仍是可点态；连点「观察」3 次（每次 1.1 s 间隔）——`.log` 条目数不变、toast 被清空且不再出现、按钮态无任何变化，截图 `walk-20261119T0155Z-m6/m7/m8` 三张**字节级相同**（201273 B）。`core-loop-designer`「No decision point」+ `intuitive-game-design` Q5 缺 **Post** 层（有输入、无结果评估）。｜verify: 新增 `scripts/e2e/choice-state-deadkeys.mjs`——推进到 must_choose 后依次点观察/潜行/休息各 2 次，断言每次点击 600 ms 内至少出现一种可见结果：`.log-entry` +1、`.sys-toast` 文案变化、或该键变成 disabled 且带 `[data-locked]`/`[data-dead]` 角标；三者皆无则 FAIL。现码应 FAIL｜risk: low
  复核（第81轮，未复现）：390/1440 双视口直落 `ch1_law`/`ch1_statues`/`ch1_system` 三个 must_choose 场景，连点「观察」5 次均有 `intent=observe` 回包且正文逐条增长（+40~110 字），「潜行」扣 MP、「休息」回 MP 正常，只有「前进」被 P204 必选门拒（已由 F247/F265 置灰）。曾按「三键锁死」实现并配 `choice-state-deadkeys.mjs`，但打红 F240 守卫 `dwell-guidance`（抉择态「观察」须回指路句点名真实选项）→ 已整轮 revert，未合入。待 product-walkthrough 用当前线上包重测；若仍复现，需附「点击后 600ms 网络请求条数」区分「没点到 / 被承接壳拦下 / 请求被拒」。
- [x] F273 线索的内部 id `read_the_law` 直接渲染进正文（P0，文本质量/调试腔）｜第57轮 `m5` 图 + DOM：点一次「观察」后正文出现「【线索·read_the_law】」，vision 也独立读到同串。这是变量名进小说，`narrative-systems-designer` **Info Dump** 的直接反例（玩家不需要、也读不懂）。✅ 渲染层展示映射（第82轮）：新增 `client/src/clueFlags.ts`（CLUE_LABELS 覆盖 8 个旗标 + `displayClueFlags`），`StageEntry`/`HoloWindow` 渲染前统一换中文线索名，服务端旗标账本原串不动。`prose-hygiene.mjs` 连跑 2 次 PASS（6.8s/7.4s）；恒等回退红证 FAIL（`[\"read_the_law\"]` 命中 1 次）；F196/F240 回归 PASS。
   verify: env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE -u E2E_BASE -u E2E_BASE_URL -u E2E_API node scripts/e2e/prose-hygiene.mjs
  risk: low
- [ ] F274 「观察」单次扣 HP 3 / MP 2 且可能凭空拉进遭遇战，事前零披露（P1，可负担性/Pre 层）｜第57轮桌面实测：干净档第一次点「观察」→ HP 100→97、MP 20→18、**直接进入遭遇战**（石像残兵 HP 52/52），此前按钮文案只有「环顾四周 2」，无消耗角标、无「可能遇敌」提示。`intuitive-game-design` Q5 缺 **Pre**（无预警的精确操作 → 玩家说「不公平」）；`game-balance-analyst` Option viability 要求披露 value-per-cost。｜verify: 新增 `scripts/e2e/observe-cost-disclosed.mjs`——断言「观察」键存在 `title`/角标/展开说明且含 `HP`/`MP` 数值或「可能遇敌」字样；并断言点击前 `.log` 内最近一条含该披露。现码应 FAIL｜risk: low
- [ ] F275 「战斗」键跨端行为不一致：桌面可主动开战、手机同进度 disabled（P1，可负担性）｜第57轮：桌面 `s8` 点「战斗」（`disabled=false`）后 82 ms 进入战斗并打完 4 回合（XP 10→32、金币 10→12）；手机同章「第1章 3/7」、HP 满、「当前没有可攻击的目标」提示同屏，但同一键 `disabled=true`，点击 5 s 无响应、截图 `m10/m12/m13` 与 `m8` 字节级相同。同一状态两种规则，且界面不解释差异。｜verify: 新增 `scripts/e2e/combat-btn-parity.mjs`——双视口各建干净档推进到同章节同进度，断言 `[data-act=combat]` 的 `disabled` 状态一致，且 disabled 时存在可见原因（`title` 或 `.sys-toast`）；现码应 FAIL｜risk: low
- [ ] F276 手机点一次「属性」到不了属性面板，落点停在「背包」页（P2，视觉/可负担性）｜第57轮 `m9` 图与 DOM：点底部「属性」后 `.sidebar` 打开，但当前页是「背包」（面板文本为「背包 / 武器 / 生锈猎刀 / 传送门碎片 …」），属性表要再点一次 panel tab；截图与上一张 `m8-rest3` 字节级相同（201085 B），vision 判定「属性面板未打开」。`intuitive-game-design` Q2 affordance gap（按钮承诺与结果不一致）。｜verify: 新增 `scripts/e2e/mobile-attr-onetap.mjs`——390×844 点「属性」后 500 ms 内断言可见面板内同时存在「力量」「敏捷」「体力」三行（属性页特征），且 `.side` 打开；现码应 FAIL｜risk: low
- [ ] F277 手机首屏正文末行被叙事容器拦腰裁切（P2，视觉类）｜第57轮 `m2` 图：末行只剩「某个存」，属容器边界硬切，无渐隐、无滚动提示，新玩家第一眼会以为文字出错。`game-detail-bar` §9b「All text fits its box」+ §1「滚动边界要可读」同类原则。｜verify: 扩写 `scripts/e2e/stage-bottom-clearance.mjs`——390×844 首屏断言 `.log` 内最后一条 `.log-entry` 的 `bottom ≤ .log` 可视区 bottom − 8，或 `.log` 底部 24 px 内存在渐隐遮罩/下滚提示；现码应 FAIL｜risk: low
- [ ] F278 战斗与休息的数值变化以括注形式直接写进叙事正文（P2，文本质量）｜第57轮：休息回包「（恢复 HP 94→100 · …）」、战斗正文「HP 100→97、MP 20→18」，机制播报与小说同段，属 F256/F263 的扩散面。`narrative-systems-designer` Info Dump（删掉不影响结果）。｜verify: 扩写 `scripts/e2e/prose-hygiene.mjs`——连做「观察/休息/攻击」各一次后断言任一 `.log-entry` 不命中 `/（[^）]*HP\s*\d+→\d+/`、不命中 `/MP\s*\d+→\d+/`（数值改走 HUD 动效或独立战报行）。现码应 FAIL｜risk: low

- [x] F279 锁定的动作键（前进/休息/战斗）点击后零反馈，玩家只能判定"游戏坏了"（P1，可负担性/反馈）｜第58轮实测（390×844，`docs/runs/walk-20261119T0330Z-m2-first.png`）：抉择态下「探索前进」disabled，连点 3 次——toast 空、日志条目数 13→13、按钮无抖动/无音效、无任何请求；HP/MP 满时连点「休息」3 次同样全静默（第 80 轮记录的 toast 在本包不复现）。玩家拿不到"为什么不能点"，`intuitive-game-design` Q5 **Post 层缺失** + `game-detail-bar` §9c「disabled shakes with the denied sound」+ §2「Every action answers at once」｜verify: 新增 `scripts/e2e/disabled-denied-feedback.mjs`——对 `[data-act]` 与战斗键中 `disabled=true` 的每个元素各点 1 次，断言每次点击 300 ms 内出现以下之一：`.sys-toast` 文案变化、该键 `class` 增 `data-denied`（伴随 shake 动画）、或 `aria-live` 区新增一句原因；三者皆无则 FAIL。现码应 FAIL｜risk: low
- [ ] F280 抉择态「观察」可零成本无限空转，且每次把三个选项全文重复三遍（P0，文本质量/核心循环）｜第58轮实测（`walk-20261119T0330Z-m3-obs6.png`）：连点「观察」6 次，HP 100/100、MP 20/20 全程不动，第 4–6 次没有任何新信息，只是把同一段「必须做出选择——说「按石碑所写，低头敬拜」、「退到石柱后，观察石像与石碑的对应」或「趁乱往石门方向逃」」在括号外念一遍、括号内再念一遍，加上按钮本身，玩家一屏读到同一组选项 **3 次**；「动静 3/4」只在括注里出现，没有任何 HUD 承载。`core-loop-designer` **No decision point** + `narrative-systems-designer` **Info Dump** 反模式｜verify: 扩写 `scripts/e2e/prose-hygiene.mjs`——① 推进到 must_choose 后连点「观察」4 次，断言每次新增 `.log-entry` 的 innerText 中「必须做出选择」出现次数 ≤1，且相邻两条新增 entry 的文本相似度 <0.85（去重后必须真有新信息）；② 抉择态观察累计 4 次后，断言「动静」以独立 HUD 元素（`[data-noise]`）呈现，不再只写在括号里；③ 观察是否消耗体力/魔力二者择一，但必须在按钮角标或 title 里写明（当前两者皆无）。现码应 FAIL ①②③｜risk: med
- [ ] F281 战斗面板没有敌方血条与伤害数字层，玩家不知道在打什么（P2，视觉/反馈）｜第58轮 `walk-20261119T0330Z-m5-combat.png`（vision 独立结论：「敌方血量完全缺失」）：交战态只有「交战 | 第 1 回合」浮层 + 六个战斗键，地下城狼的 42→25→8→0 只能从正文「【战斗】地下城狼 HP 42→25」读出来；伤害、承伤都是正文里的字符替换，没有飘字/独立数字层，顶栏只有自己的 HP/MP。`game-detail-bar` §2「Every action answers at once in sight, sound and motion, scaled by its weight」+ §9c「Numbers: they pop in with an overshoot… size and color differ by kind」｜verify: 新增 `scripts/e2e/combat-target-hud.mjs`——交战态断言存在可见的 `[data-enemy-hp]`（含当前/最大 HP 与名字），攻击一回合后其数值下降且宽度比例随之变化；同时断言本回合至少出现一个独立伤害数字节点（`.dmg-num[data-kind]`，字号 ≥ 正文 1.2 倍）；现码应 FAIL｜risk: low
- [x] F282 刷新/重开后回到门牌页不预填已存代号，玩家必须凭记忆重输（P2，可负担性）｜第58轮实测：刷新 → 门牌页 `input.value` 为空；输入「走查者0330」后才出现「检测到已有猎人「走查者0330」（Lv.1 · 第1章）已有存档」——说明本地明确存着上一次的代号，却不预填、也不给一键「继续」入口。`intuitive-game-design` Q2 affordance gap（界面知道的，玩家要重新手动提供）+ `game-detail-bar` §12「Save the run… so a reload resumes it」｜verify: 新增 `scripts/e2e/gate-prefill.mjs`——建号推进到第2章后 reload，断言门牌页 ① `input.value` 等于上次代号，或 ② 存在一个文案含代号的「继续 <代号>」按钮且点击后 1 次即进入存档（不经打字）；两者皆无则 FAIL。现码应 FAIL｜risk: low
- [ ] F283 手机属性面板需内层滚动，数值被甩到最右缘、与标签断开（P2，视觉类）｜第58轮 `walk-20261119T0330Z-m4-attr.png`（vision：出现内层垂直滚动条、体力/智力/感知在折线以下、数值贴右缘、「升级可获得属性点」几近贴边、底部灰字在 390 宽难辨）：面板在 390×844 下信息没能一屏放下，且行内标签与数值之间的横向间距过大，视线要横跳。`game-detail-bar` §9b「All text fits its box… layouts are computed from the content count」「Phones get their own layout, not the desktop one scaled down」｜verify: 扩写 `scripts/e2e/gate-layout.mjs` 或新增 `scripts/e2e/attr-panel-mobile.mjs`——390×844 打开属性页断言 ① 力量/敏捷/体力/智力/感知 + 战斗数值三段全部在 `clientHeight` 内无需内滚（或改为分页/折叠且首页含力量/敏捷/体力），② 每个数值右缘距面板内容右内缘 ≤ 24 px（不与标签断开超过 180 px），③ 「升级可获得属性点」文本不与面板右缘距离 < 8 px；现码应 FAIL ①｜risk: low
- [x] P212 （P1 工程死路，第82轮调度发现）验收闸门「静默空转」：`scripts/verify.sh` 只认**行首缩进续行**的 `verify:`（awk `inflag && /^[[:space:]]*verify:/`），而 FEATURES 里绝大多数条目把验收写成行内「…｜verify: 新增 `scripts/e2e/x.mjs`…｜risk: low」→ `--list` 里这些条目全是 `verify=MISSING`，`verify.sh <FID>` 直接「缺验收断言」退出 2；调度器若按条目名逐条跑验收，等于**一条都没跑**却以为过闸。要求：① `verify.sh` 解析兼容行内「｜verify: …」写法（取「｜verify:」到下一个「｜」之间的内容，去反引号），并在 `--list` 用 `[inline]` 标注来源；② 对含「新增/扩写 `scripts/…`」但该文件不存在的条目，`--list` 与 `verify.sh` 都直接报 `NO_ASSERT_FILE`（不可当 PASS）；③ CI（`scripts/ci-deploy.sh`）部署前对**本轮改动的 FID** 逐个跑 `verify.sh`，MISSING/NO_ASSERT_FILE 视为失败；④ 修完后全表抽查 5 条行内条目，`--list` 的 verify 字段非空且命令可执行。断言：`node scripts/assert/verify-parse-inline.mjs` —— 造一份含行内/续行/无 verify 三种写法的临时 FEATURES 副本，断言 `--list` 三条分别解析为 inline/block/MISSING，且 `NO_ASSERT_FILE` 条目退出码 ∉ {0} ✅ 已修复（inline/block 双解析 + `NO_ASSERT_FILE` 退出 3 + `ci-deploy.sh` 增加 `--check` 解析闸门，实测 `--list` MISSING 从 64 行降到 34 行、仅剩本无 verify 的老 F0xx）
  verify: node scripts/assert/verify-parse-inline.mjs
  risk: med
- [x] F284 进游戏后「档案」抽屉默认展开，压住正文与选项，390 下必须手动点 × 才能开始玩（P1，视觉/首屏）｜第86轮实测（干净档，390×844）：点「觉醒」3.5 s 后首屏即 `drawer-veil` 可见、`sidebar` 铺满右半屏；vision 独立判「像页面被侧栏挡住」，首屏清晰度 2/5。且关闭后 `.drawer-veil` 仍 `display:block/opacity:0`、`z-index:20`，只靠 `pointer-events:none` 兜底（截图 `walk-20261119T0533Z-m2-main.png`）。`intuitive-game-design` Q1「首 30 秒必须能做第一个动作」+ `game-detail-bar` §9e「Play within seconds: one or two presses from the title to control」｜verify: 新增 `scripts/e2e/boot-drawer-closed.mjs`——新档点「觉醒」后 2 s 断言 `.drawer-veil` 与 `.sidebar` 均不可见（`offsetParent===null` 或 `opacity==0 && display:none`），且首屏可见区域内能点到一个 `[data-act]` 剧情键；现码应 FAIL ｜**已修（第87轮）**：主症状实测**不可复现**——干净档觉醒后 2s/3.5s `.sidebar` 未带 `.open`、rect left=390（已推出屏外），正文横向未被遮挡；走查把「关闭态遮罩常驻渲染树」与正文底部裁切（F277）误判成侧栏遮挡。真实缺陷是 `.drawer-veil` 关闭态仅 `opacity:0`+`pointer-events:none`，仍 `display:block;z-index:20`；已补 `visibility:hidden`（延迟 0.2s 让淡出播完），`offsetParent` 对 fixed 元素恒 null 故不能作可见性判据。新增 `scripts/e2e/boot-drawer-closed.mjs`（自起隔离实例，390/1440 双视口）锁死「首屏抽屉关闭 + 遮罩真不可见 + 首屏 [data-act] 可点 + 点背包能开/×能关」；旧码 FAIL、新码 PASS。
- [ ] F285 抽屉展开时底部自由输入框仍可聚焦输入，回车静默无反应且输入文本不清空（P2，可负担性/反馈）｜第86轮实测：抽屉开着时向 `input[placeholder*=自由行动]` 写入「我蹲下检查石像脚边的刻痕」并派发真实 Enter（`Input.dispatchKeyEvent`），15 s 内正文长度 1319→1319 不变、无 toast、无拒绝回执；该文本一直留在输入框里（后续战斗截图 `m4` 中仍可见），玩家会以为「输入被吞了」。关掉抽屉后同一操作正常回包。`intuitive-game-design` Q5 缺 **Post** 层 + `game-detail-bar` §2「Every action answers at once」｜verify: 新增 `scripts/e2e/free-input-behind-drawer.mjs`——打开档案抽屉，向自由行动输入框输入并回车，断言 600 ms 内出现以下之一：`.sys-toast` 文案变化、输入框被清空且 .log +1、或该输入框 `disabled`/`aria-disabled` 且带可见原因；三者皆无则 FAIL。现码应 FAIL
  risk: low
- [ ] F286 交战浮层里敌我血条同色（都是红），阵营只能靠名字分辨；我方 HP 同时在顶栏与浮层重复出现（P2，视觉/无障碍）｜第86轮 `walk-20261119T0533Z-m4-combat.png`（vision：「双方血条同为红色，主要靠文字标签区分」）：顶栏 `HP 97/100` 与浮层 `走查者A HP 97/100` 两条重复，敌人 `地下城狼 HP 42/42` 与己方同色同款。`game-detail-bar` §9d「Never colour alone. Every meaning carried by colour also has a shape, an icon, a pattern or a word」+ §9b「Reserved HUD regions… so they never stack」｜verify: 新增 `scripts/e2e/combat-hp-distinct.mjs`——交战态断言敌我 HP 条的 `background` 或 `data-side` 属性不同（含 `data-side="enemy"` 与可辨识的图标/纹理），且页面内可见的 `97/100` 类己方 HP 文本只出现 1 次；现码应 FAIL
  risk: low
- [ ] F287 桌面 1440×900 无专用排版：正文单行近 1000 px、日志与底部指令之间大片空档、「逃跑」孤立在左、右侧面板与主区同亮度（P2，视觉类）｜第86轮 `walk-20261119T0533Z-d1-desktop.png`（vision：「一行接近 1000 像素宽…视线横移距离较长」「日志框与下方操作按钮之间有极大垂直空白」「逃跑按钮下方留明显空缺」「右侧面板极大且没有背景暗化，缺乏视觉焦点」）。`game-detail-bar` §9b「Phones get their own layout, not the desktop one scaled down」反向同样成立——桌面也要自己的版式（可读行宽 ~70–90 字符）｜verify: 扩写 `scripts/e2e/gate-layout.mjs`——1440×900 断言正文容器 `clientWidth ≤ 880`（或存在 `max-width` 生效的行宽限制），`.log` 底边与底部指令区顶边的间距 ≤ 120 px，且 `.btn-group-combat` 内键数≥5 时首行无空缺格；现码应 FAIL
  risk: low
- [ ] F288 同一存档刷新续档结果不一致（一次回到交战第 2 回合，一次回到门牌页且代号为空），且从未提示「交战中刷新会丢进度」（P1，存档/信任）｜第86轮实测（2 分钟内同一档案两次 reload）：第 1 次 `goto` 后直接 `交战 | 第 2 回合`、HP 94/100、敌 25/42 原样；第 2 次同 URL reload 后落到门牌页、`input.value` 为空、正文只剩「登记猎人代号」。会话内看不到「正在保存/未保存」的任何指示。`game-detail-bar` §12「Save the run in progress so a reload resumes it… show a small saving icon」+「A broken save never loses progress… tell the player」｜verify: 新增 `scripts/e2e/reload-resume-consistency.mjs`——建干净档推进到交战第 2 回合，连做 2 次 reload，断言两次都落在同一交战回合（HP/敌方 HP/回合数一致）或两次都给出一致的「本场战斗不存档，刷新将回到上一检查点」提示并在门牌页提供一键「继续 <代号>」；两种结果混用即 FAIL。现码应 FAIL
  risk: med
