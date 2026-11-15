# Solo Leveling 文字 RPG — 产品与技术 SPEC

> 版本 v0.2 ｜ 单机文字网游 ｜ 中文 ｜ 自用（不对外分发，仅服务器私域访问）
> 入口：`https://openfolio.uk/game`

---

## 1. 产品定位

把《Solo Leveling（我独自升级）》做成可自由行动的文字 RPG：**界面以「面板 + 按钮」为主**（像正经 RPG 客户端），AI 输入框只是「自由动作」的补充入口，用于处理面板覆盖不到的花式操作。

**三条设计红线**
1. **按钮优先**：常用操作（探索、攻击、背包、技能、休息、地图、存档）必须是可视按钮，一键完成，不依赖 AI、不消耗 token。
2. **AI 是增强不是唯一通道**：输入「我想撬开石棺看看里面有没有东西」才走 AI；每一步都靠打字说是不合格的交互。
3. **数值归引擎，叙述归 AI**：战斗/掉落/经验由确定性引擎算，AI 只负责理解意图与生成文本。

**明确不做**：多人联机、付费、公开分发、原作美术与商标资源。

---

## 2. 界面结构（重点）

### 2.1 主界面三栏（桌面）/ 纵向三段（移动端）

```
┌─────────────────────────────────────────────┐
│ ① 状态栏：姓名 | 等级 | 猎人等级 E..S | 章节  │
│    HP ▓▓▓▓▓░░ 320/400  MP ▓▓▓░░ 90/150      │
│    力 敏 体 智 感 | 金币 | 影子数            │
├──────────────────────────┬──────────────────┤
│ ② 主舞台                  │ ③ 侧栏（可折叠）  │
│   - 场景描述（旁白）       │  - 背包          │
│   - 实体列表（敌人/NPC）   │  - 技能          │
│   - 系统播报（蓝框）       │  - 任务/章节     │
│   - 战斗面板（有战斗时）   │  - 属性详情      │
├──────────────────────────┴──────────────────┤
│ ④ 操作区：按钮行 + AI 输入框（次要入口）      │
└─────────────────────────────────────────────┘
```

### 2.2 操作区按钮（必须有，分组）

- **行动**：`探索前进` `环顾四周` `潜行` `休息`
- **战斗**：`攻击` `技能` `防御` `道具` `逃跑`（仅战斗中出现）
- **系统**：`背包` `技能` `属性` `地图` `任务` `存档` `读档`
- **快捷**：`重复上次行动`
- **自由动作**（输入框，占一位）：`做点别的…` → 走 AI

### 2.3 面板要求
- **背包**：分类（武器/防具/消耗品/材料）、稀有度颜色、使用/装备/丢弃按钮、排序
- **技能**：已学技能、消耗 MP、冷却、可用状态（灰/亮）
- **属性**：五项属性、剩余自由属性点、加点按钮、经验条
- **地图/章节**：章节列表、已解锁场景节点、当前位置高亮、未解锁灰显
- **任务**：主线/每日任务、进度、奖励、剩余时间（每日任务有惩罚倒计时）
- **战斗**：双方血条、回合数、日志、行动按钮、简易伤害飘字

### 2.4 交互体验
- 所有按钮点击后 ≤300ms 有反馈（loading/禁用态），失败弹系统提示
- 键位：数字键 1-9 对应按钮，Enter 发送自由输入，Esc 关面板
- 移动端：底部固定操作栏，侧栏改为抽屉

### 2.5 UI 设计规范（强制）

前端设计必须遵循 Anthropic 开源的 `frontend-design` skill（本地：`/www/hermes-home/skills/frontend-design/SKILL.md`）。要点：

- 先出**设计计划**（4–6 个具名 hex 色板、字体与角色分工、布局概念 + ASCII 线框、设计原则），再写代码
- 每个视觉选择必须**为该题材服务**，不能是通用模板默认值。明确禁止下列「AI 味」特征：奶油底 + 衬线大标题 + 陶土色强调(#D97757)；纯黑底 + 单一荧光绿/朱红；SaaS 卡片套件（所有内容切成同款圆角卡片 + 同一层柔光阴影）；全大写 eyebrow 标签；`A · B · C` middot 元信息；按钮尾巴加 `→`
- 配色与字体要来自题材本身：《Solo Leveling》是韩式猎人协会 + 系统蓝窗 + 地下城传送门，视觉语言应是「冷冽的军事化界面 + 全息系统窗口」，而非通用暗色 SaaS
- 一次只豪赌一个视觉记忆点，其余克制安静
- 硬性质量地板：移动端响应式、键盘可见焦点、`prefers-reduced-motion` 生效、色彩对比度可读
- 文案准则：动词开头、说清楚点下去会发生什么、同一动作全流程同名、错误信息说清原因和修法

---

## 3. 系统架构

```
浏览器 (React + Vite, base=/game/)
        │  https://openfolio.uk/game
        ▼
portfolio-proxy.js  (/game/* → 127.0.0.1:3020，不重写路径)
        ▼
solo-leveling (Express, 127.0.0.1:3020)
   ├─ /game/api/*   REST
   ├─ 静态托管 dist（base=/game/）
   ├─ engine/  确定性战斗、属性、掉落、经验（纯函数 + seed RNG）
   ├─ ai/      OpenCode Go（deepseek-v4.1-flash）意图解析 + 叙述生成
   └─ SQLite  /www/Solo-Leveling/data/game.db
```

---

## 4. 数据模型（SQLite）

- `saves`: id, player_name, level, rank, xp, hp, max_hp, mp, max_mp, stats_json, gold, chapter, scene, flags_json, created_at, updated_at
- `inventory`: save_id, item_id, qty, equipped
- `skills`: save_id, skill_id, level, cooldown_until
- `shadows`: save_id, shadow_id, grade, level
- `log`: save_id, role(user/system/narrator/ai), content, meta_json, created_at
- `runs`: save_id, gate_id, result, turns, seed, created_at（平衡分析用）

---

## 5. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /game/api/health | 健康检查 |
| POST | /game/api/saves | 新建存档 |
| GET | /game/api/saves/:id | 存档全量状态（属性/背包/技能/章节） |
| POST | /game/api/action | **按钮动作**：`{save_id, action:"explore", payload:{}}` |
| POST | /game/api/ai-action | **自由输入**：`{save_id, input:"..."}` → AI 解析 |
| GET | /game/api/saves/:id/log | 日志分页 |
| POST | /game/api/saves/:id/save | 手动存档标记 |

`action` 白名单：`explore` `look` `sneak` `rest` `attack` `skill` `defend` `item` `flee` `open_inventory` `open_skills` `open_stats` `open_map` `open_quests` `arise` `advance_scene`

---

## 6. AI 接入协议

**端点** `POST https://opencode.ai/zen/go/v1/chat/completions`
**模型** `deepseek-v4.1-flash`（key 仅服务端 `OPENCODE_GO_API_KEY`）
**Header** `Authorization: Bearer <key>`、`x-opencode-session: <save_id>-<turn>`

**输出契约（JSON）**
```json
{
  "intent": "explore|attack|talk|use_item|rest|flee|skill|arise|custom",
  "target": "goblin_01",
  "narration": "……",
  "next_hint": "……"
}
```

**服务端硬校验**：intent 不在白名单 → 降级为 `custom`（只叙述不改状态）；数值只由引擎计算；HP/MP 夹紧 [0,max]；超时 20s → 规则解析器兜底 + 系统播报「系统连接不稳定」。
**成本控制**：只发状态摘要 + 最近 6 条日志，不发完整历史。

---

## 7. 战斗与平衡

- 纯函数 `resolveTurn(state, action, seed)` → 新状态 + 事件列表
- 属性：力量→物攻、敏捷→命中/闪避/先手、体力→HP/防御、智力→MP/法伤、感知→暴击/发现
- 猎人等级 E→S 对应副本难度，跨级有压制系数
- 掉落表 JSON 配置化，稀有度：普通/魔法/稀有/史诗/传说
- 平衡：`npm run sim -- --gate <id> --runs 2000`，普通怪胜率目标 70–85%，Boss 40–60%

---

## 8. 剧情章节（还原原作，至蚁王）

| 章 | 场景 | 关键事件 | Boss |
|---|---|---|---|
| Ch1 | 双地下城（Cartenon 神殿） | 石像、命令之律、濒死觉醒「系统」 | 石像守卫 |
| Ch2 | 每日任务 / 惩罚副本 | 强制每日任务、超时惩罚 | 惩罚副本·毒牙蛇 |
| Ch3 | 猎人协会评级 | E→D 重测、与车海印初遇 | 评级用哥布林群 |
| Ch4 | 地下城突袭 | 小队协作、隐藏房间 | 蓝色毒蛇王 |
| Ch5 | 转职任务 | 试炼、暗影提取、转职暗影君主 | 试炼守护者 |
| Ch6 | 红门 | 冰精灵领地、带新人求生 | 冰精灵女王 |
| Ch7 | 恶魔城 | 地狱之犬、恶魔贵族 | 恶魔城城主 |
| Ch8 | 济州岛 | 蚂蚁巢穴、S 级猎人集结 | **蚁王 Beru（最终 Boss）** |

每章 3–6 个场景节点，节点内自由行动，关键节点触发不可跳过的剧情播报。

---

## 9. 部署与运维

- 目录 `/www/Solo-Leveling`（数据盘）；pm2 `solo-leveling`（127.0.0.1:3020），`pm2 save`
- 反代 `/root/Portfolio-Manager/portfolio-proxy.js` 的 `/game` 分支
- DB `/www/Solo-Leveling/data/game.db`（gitignore）
- 闸门 `scripts/ci-deploy.sh`：build → smoke（health + 关键 API）→ pm2 restart → 复检；失败 `scripts/rollback.sh`
- 日志 `/root/logs/solo-leveling-*.log`

---

## 10. 里程碑

- **M0 壳子**（已完成）：/game 可访问，建存档、按钮区、输入框、占位回复
- **M1 界面补全**：状态栏 + 操作按钮组 + 背包/技能/属性/地图/任务面板 + 移动端适配
- **M2 AI 接入**：自由输入走 deepseek，防幻觉校验
- **M3 战斗引擎**：回合制、掉落、经验、升级、模拟验证
- **M4 剧情 Ch1–Ch3**
- **M5 影子系统**
- **M6 剧情 Ch4–Ch7**
- **M7 终章蚁王**

---

## 11. 内容扩展机制（cron 每 5 分钟，双车道并行）

每跳由**调度 agent**（Hermes 主模型）并行开 2–3 个 subagent，分两条车道同时推进：

- **车道 A｜devin CLI**：subagent 写任务文件，调 `devin -p --model swe-2-<effort> --permission-mode dangerous` 干活（免费额度），适合多文件、跨模块的任务
- **车道 B｜OpenCode Go**：subagent 直接用 Hermes 的 `deepseek-v4.1-flash` 读写代码（订阅额度），适合单文件、小改动、文案与数据填充

**并发安全**：两条车道必须做**互不重叠的文件区域**（调度时按 FEATURES 条目判断）；部署统一走 `.deploy.lock`，同一时刻只允许一个部署；git 提交先 `git pull --rebase`，冲突则回滚本次改动并跳过该条。

每条功能：
1. 从未勾选项里挑 1 条（车道 A）+ 1 条（车道 B），区域不冲突
2. 各自实现 + 自测（引擎改动必须附单测或模拟数据）
3. 串行过 `scripts/ci-deploy.sh`（持锁）
4. 各自勾选该条，并在 `docs/SPEC-EXPANSION.md` 追加 1–2 条新待办
5. 用仓库身份提交并 push origin main（先 rebase）

**防跑偏**：一次只做一条；不改本 SPEC 的架构章节；数值改动必须附模拟；剧情文本必须落在大纲范围内。
