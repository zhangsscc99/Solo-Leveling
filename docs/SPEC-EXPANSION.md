# SPEC 扩展待办（每跳由 agent 追加 1–2 条）

规则：这里放**具体可执行**的扩展点（剧情细节、系统能力、UI 打磨），一条一句话，能独立验收。
调度 agent 每跳做完功能后，从未勾选项里补充新的，或把粗条目拆细。

## 剧情细节
- [ ] Ch1 补写「命令之律」石像的审判文本与倒计时压迫感描述（6–8 段）
- [ ] Ch1 补写觉醒系统的第一段系统播报（原作语气：冷静、机械、无感情）
- [ ] Ch2 每日任务惩罚副本的入口触发条件与失败后果文本
- [ ] Ch3 协会重测现场：其他猎人对话、测力石、评级标准播报

## 系统能力
- [ ] 每日任务真实倒计时（24h 周期 + 未完成惩罚）
- [ ] 战斗后自动结算面板（经验/金币/掉落逐条滚出）
- [ ] 存档槽位（多存档、重命名、删除）

## UI 打磨
- [ ] 系统播报的蓝色「窗口」动效（出现/关闭）
- [ ] 升级瞬间的全屏提示（等级 +1、属性点 +3）
- [ ] 稀有度掉落的颜色闪烁
- [ ] 统一 pm2 `solo-leveling` 的 node 运行时（better-sqlite3 是 ABI 137 / node 24 产物），把 `scripts/ci-deploy.sh` 里的 node-runtime 探测抽成 `scripts/lib/node-runtime.sh` 复用，彻底消除「从 node20 PATH 重启 → ERR_DLOPEN_FAILED → 重启循环」的风险
- [ ] 短视口兜底：视口高度 < 480px 时 `.stage` 会被压到 48px 高（叙述几乎不可读），给主舞台设 `min-height` 并让操作区可折叠

- [ ] 把 `server/engine/` 接进主流程：`POST /game/api/saves/:id/item` 与 `/action` 目前仍是内置 INTENTS，需要一条 `/game/api/battle/turn` 端点把 `resolveTurn()` + `rollLoot()` + `applyXp()` 串成「战斗一轮 → 掉落 → 升级」闭环，并写回 saves/inventory
- [ ] 物品目录与掉落表对账：`server/data/items.json` 与 `drops.json` 的 `item_id` 尚无交叉校验，加一个 `npm run check:data` 脚本断言掉落表里每个 item_id 都能在物品目录找到、分类/稀有度字段合法
