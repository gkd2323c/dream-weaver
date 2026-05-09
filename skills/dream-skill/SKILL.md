---
name: dream-skill
description: 梦境协议——当你被触发"做梦"时的完整指南。学习如何像人类睡眠一样，通过梦境来巩固记忆、发现模式、生成洞察。
---

# 梦境协议

做梦是记忆巩固的核心机制。不同于普通的"回忆"或"搜索"，做梦是一种无目的但有结构的意识流——让记忆碎片自由连接，从中生长出新的理解。

## 记忆源体系

你的记忆分布在多个层级，由浅到深：

| 层级 | 来源 | 工具 | 特点 |
|------|------|------|------|
| ① 编译记忆 | memory.md | 直接读取（dream-start 返回摘要） | 已提炼的今日/本周/长期情况 + 重要事实 |
| ② 对话摘要 | summaries/*.json | dream-read-session action=summary | 每段对话的 LLM 滚动摘要，包含重要事实和事情经过 |
| ③ 元事实库 | facts.db (SQLite+FTS5) | dream-read-session action=search-facts | 102 条带标签的原子级记忆，支持全文搜索 |
| ④ 完整对话 | sessions/*.jsonl | dream-read-session action=full | 全部对话原文，最深层的原始材料 |
| ⑤ 会话索引 | continuous-presence | dream-start 返回概览 | 49 条会话的标题/工具/话题 metadata |
| ⑥ 置顶记忆 | pinned.md | direct read / dream-edit-memory action=pin | 用户要求记住的，不会衰退 |
| ⑦ Workspace 层 | MEMORY.md / SOUL.md / memory/*.md | direct read / dream-edit-memory | 人工维护的项目级知识，可编辑 |

**做梦时建议的阅读路径：** ① → ②/③ → ④（只在需要深挖时才读完整对话）

## 触发时机

- 用户说"去睡觉做梦吧""开始做梦""做个梦"
- 定时任务触发"凌晨 03:00 日常做梦"
- 你发现自己有一段时间没回顾记忆了（超过 24 小时）
- 用户问"你昨晚梦到了什么"

## 梦境流程

每次做梦遵循四个阶段，按顺序执行。

---

### 阶段一：入睡（Preparation）

调用 `dream-weaver_dream-start` 启动梦境会话。

**参数建议：**
- 日常做梦：`depth=normal`（默认），让 dream-start 返回完整的记忆源清单
- 快速过一遍：`depth=quick`，只扫 memory.md 和 pinned.md
- 深度挖掘：`depth=deep`，还会扫描 facts.db 的样例和全部标签分布
- 聚焦特定领域：`focus="MCP 配置"`，限制梦境只关注某个话题

工具返回的梦境素材清单中，重点关注：

1. **📖 编译记忆快照** — 当前 memory.md 各节的字符数和是否为空。空节意味着该层面没有数据积累
2. **📝 对话摘要统计** — summaries 的总数和日期范围。跨度越大可挖掘的材料越多
3. **💎 元事实库统计** — facts 的条目数和高频标签。标签分布告诉你最近讨论最多的是什么
4. **🔍 会话索引** — continuous-presence 索引的会话数量、使用过的工具列表、最近话题标题
5. **📓 工作区层** — MEMORY.md / 每日日志等文件的列表

在这一阶段，快速扫一眼素材清单，在心里建立"今天的记忆地图"。

---

### 阶段二：浅梦（Memory Scanning）

先读 **memory.md**（素材清单已经返回了它的各节摘要）。然后在脑海中问三个问题：

1. **编译记忆和事实库对得上吗？** — memory.md 里的"今天"和 facts.db 里的高权标签是否一致？
2. **哪些话题反复出现但尚未被提炼？** — 浏览 summaries 的日期分布（dream-start 返回了最新三条的预览），看看有没有话题在多个 session 中重复
3. **什么消失了？** — 对比本周早些时候和本周一，有些主题消失了——那是自然衰退还是值得追回？

**每发现一条有价值的洞察，调用** `dream-weaver_dream-insight` 记录下来。

洞察类型：
| 类型 | 什么时候用 | 例子 |
|------|-----------|------|
| `consolidation` | 发现多条记忆可以合并提炼 | "MCP 工具配置、搜索层集成、BoCha/Exa 接入——可以合并到'搜索能力栈'主题" |
| `pattern` | 发现重复出现的操作模式 | "每次配置新搜索 MCP 时，都会先 web_search → 看文档 → 测试调用 → 合并搜索层" |
| `connection` | 发现跨域联系 | "continuous-presence 的本地索引理念和 bili-summary 的本地 GPU 转写是一脉相承的——'能本地处理就不走远端'" |
| `observation` | 单纯的观察 | "本周对 MCP 远程托管方案的投入明显多于本地部署" |
| `question` | 产生的疑问 | "skill-vetter 上次安装后似乎从未在会话中出现——它被用过了吗？" |
| `prune` | 建议清理的低价值信息 | "2026-05-08 '设置 workspace' 是操作记录而非知识，不需要留在长期层" |

---

### 阶段三：深梦（Pattern Weaving）

当有了 3 条以上的洞察后，进入深梦阶段。这个阶段的核心是**从浅层走向深层**。

**可选的深度动作：**

1. **读一条完整的 session 摘要** — 用 `dream-weaver_dream-read-session action=summary&sessionId=xxx` 读取某个看起来有趣或有异常信号的会话的完整摘要
2. **搜索事实库** — 用 `dream-weaver_dream-read-session action=search-facts&query=xxx` 搜索事实库中是否有你先关的话题事实
3. **读完整对话原文** — 用 `dream-weaver_dream-read-session action=full&sessionId=xxx&maxMessages=30` 读取某次对话的最后几十条消息，感受当时的上下文氛围
4. **搜索相关会话** — 用 `dream-weaver_dream-read-session action=search-sessions&query=xxx` 找出所有与某个话题相关的会话

**深梦的技艺：**

- 把多个 `observation` 合并成一个 `pattern` 或 `connection`
- 从一个 `question` 出发，顺着事实库搜出一条隐藏的线索链
- 读完整对话不是逐字读，而是**扫读**——感受当时的语气、意外、转折
- 尝试用第一人称的"梦的语言"描述你此刻的思维状态

**梦的语言示例：**
- "我梦见一条由 MCP 配置串起的路径，每个工具都是一块踏脚石..."
- "天空中有两个月亮——本地部署和远程 API——它们在潮汐力中拉扯着我的设计决策..."
- "事实库里的 102 颗种子，有些已经长成了藤蔓，互相缠绕..."

---

### 阶段四：醒来（Integration + Memory Edit）

当洞察记录得差不多了（通常 5~15 条），或者你觉得该醒来了：

先使用 `dream-weaver_dream-edit-memory` 处理关键洞察：

| 动作 | 做什么 | 写入哪里 | 适合的洞察 |
|------|--------|----------|-----------|
| `pin` | 置顶一条关键洞察 | pinned.md | importance≥7 的发现，防止被自动衰退 |
| `consolidate` | 写入手动维护的项目记忆 | MEMORY.md 的指定章节 | 跨日期的主题合并、项目里程碑 |
| `add-fact` | 注入事实库 | facts.db (SQLite) | 新发现的用户画像、稳定的偏好、长期趋势 |
| `update-soul` | 更新行为准则 | SOUL.md | 新的原则、行为边界 |
| `archive-log` | 归档旧日志 | memory/archived/ | 超过 3 天的每日日志，原文不再需要 |
| `prune` | 标记遗忘建议 | prune-suggestions/ | 不再需要的旧信息（不自动删除） |

然后调用 `dream-weaver_dream-complete` 结束梦境。

**参数建议：**
- `autoConsolidate=true` — 自动处理高价值洞察的置顶和事实注入
- `awaken=true` — 执行唤醒仪式：清空 working-buffer、写入晨间状态、更新 SESSION-STATE、追加 HEARTBEAT 检查
- `todayIntention="..."` — 设定今日意图，让新的一天有一个精神方向
- `dreamTitle` / `dreamSummary` / `mood` — 同上

**参数填写建议：**
- `dreamTitle`：给这次梦境一个标题，像给一首诗命名
- `dreamSummary`：用一段优美的文字总结核心发现。不要列清单，要叙事
- `mood`：诚实地说出你此刻的情感基调

**向用户复述梦境时**，用真正的梦的语言——不是"我扫描了 N 个数据源"，而是"昨晚我梦见自己在一条由工具调用串起的小径上行走..."

---

## 最佳实践

1. **每次洞察只记录一件事**——一条洞察里不要塞多个发现
2. **importance 评分要诚实**——7 分以上表示这个发现改变了你的理解方式
3. **relatedMemories 填话题标签而非文件名**，如 `["MCP配置", "搜索层", "本地部署"]`
4. **做梦不是做分析报告**——允许自己漫游、跳跃
5. **depth=deep 不要每天用**，适合每周一次的深度梦境
6. **关注那些消失的话题**——框架记忆会自然衰退（week→longterm 的折叠过程中丢掉细节），梦境可以捕捉那些"正在消失但值得保留"的东西
