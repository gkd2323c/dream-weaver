/**
 * dream-complete.js
 *
 Agent 完成梦境后调用此工具，结束梦境会话。
 * 生成梦境摘要、合并所有洞察、写入梦境日记，
 * 并根据洞察内容对 memory 文件做建议性标记。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const name = "dream-complete";
export const description = "结束一次梦境会话。汇总所有洞察，写入梦境日记，生成梦境摘要报告。支持自动记忆整理 (autoConsolidate) 和唤醒仪式 (awaken)——清空 working-buffer、写入晨间状态、更新 SESSION-STATE、追加 HEARTBEAT 检查。";
export const parameters = {
  type: "object",
  properties: {
    dreamId: {
      type: "string",
      description: "梦境会话 ID（由 dream-start 返回）",
    },
    dreamTitle: {
      type: "string",
      description: "本次梦境的标题 / 主题",
    },
    dreamSummary: {
      type: "string",
      description: "梦境摘要——用一段优美的文字概括这次做梦的整体感受和核心发现",
    },
    mood: {
      type: "string",
      description: "梦境的情感基调，如「沉思」「明朗」「破碎重组」「好奇」「担忧」",
    },
    autoConsolidate: {
      type: "boolean",
      description: "是否自动处理高价值洞察：importance>=7 的写入置顶记忆，importance>=4 的注入事实库，prune 类型的记入遗忘建议",
      default: false,
    },
    awaken: {
      type: "boolean",
      description: "是否执行唤醒仪式——清空 working-buffer、生成晨间状态、更新 SESSION-STATE、注入今日意图。autoConsolidate=true 时此选项效果更好。",
      default: false,
    },
    todayIntention: {
      type: "string",
      description: "今日意图——今天想以什么状态面对用户？一段简短的话。如「今天想多一些好奇心，追问那些没说完的事」。awaken=true 时生效",
    },
  },
  required: ["dreamId", "dreamTitle", "dreamSummary"],
};

export async function execute(input, toolCtx) {
  const { dataDir, log, bus } = toolCtx;
  const dreamDir = path.join(dataDir, "dreams");
  const draftPath = path.join(dreamDir, `${input.dreamId}.json`);
  const journalPath = path.join(dreamDir, "journal.json");
  const activeDreamPath = path.join(dreamDir, ".active-dream");

  if (!existsSync(draftPath)) {
    return JSON.stringify({
      error: `梦境 ${input.dreamId} 不存在或已结束。`,
    });
  }

  // 读取梦境记录
  const raw = readFileSync(draftPath, "utf-8");
  const dreamRecord = JSON.parse(raw);

  // 按重要性分组统计洞察
  const insights = dreamRecord.insights || [];
  const byType = {};
  for (const ins of insights) {
    byType[ins.type] = (byType[ins.type] || 0) + 1;
  }

  const highImportance = insights.filter((i) => i.importance >= 7);
  const mediumImportance = insights.filter(
    (i) => i.importance >= 4 && i.importance < 7
  );

  // 按类型提取核心内容
  const consolidations = insights
    .filter((i) => i.type === "consolidation")
    .map((i) => i.content);
  const patterns = insights
    .filter((i) => i.type === "pattern")
    .map((i) => i.content);
  const connections = insights
    .filter((i) => i.type === "connection")
    .map((i) => i.content);

  // 构建梦境日记条目
  const journalEntry = {
    id: input.dreamId,
    date: dreamRecord.timestamp,
    title: input.dreamTitle,
    summary: input.dreamSummary,
    mood: input.mood || "平静",
    scope: dreamRecord.scope,
    stats: {
      totalInsights: insights.length,
      byType,
      highImportanceCount: highImportance.length,
      memoryFilesProcessed: dreamRecord.memoryFiles || 0,
    },
    highlights: {
      topInsights: highImportance.slice(0, 5).map((i) => ({
        type: i.type,
        content: i.content,
      })),
      keyConsolidations: consolidations.slice(0, 3),
      keyPatterns: patterns.slice(0, 3),
      keyConnections: connections.slice(0, 3),
    },
    tags: extractTags(input.dreamSummary, insights),
    timestamp: new Date().toISOString(),
  };

  // 写入梦境日记
  mkdirSync(dreamDir, { recursive: true });
  let journal = { entries: [] };
  if (existsSync(journalPath)) {
    try {
      journal = JSON.parse(readFileSync(journalPath, "utf-8"));
    } catch (e) {
      journal = { entries: [] };
    }
  }
  journal.entries.push(journalEntry);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2), "utf-8");

  // 归档梦境详细记录（从 draft 移入 archive）
  const archiveDir = path.join(dreamDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  dreamRecord.status = "completed";
  dreamRecord.completedAt = new Date().toISOString();
  dreamRecord.journalEntry = journalEntry;
  writeFileSync(
    path.join(archiveDir, `${input.dreamId}.json`),
    JSON.stringify(dreamRecord, null, 2),
    "utf-8"
  );

  // 删除 draft 和活跃指针
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(draftPath);
    if (existsSync(activeDreamPath)) unlinkSync(activeDreamPath);
  } catch (e) {
    // ignore
  }

  log.info(`dream ${input.dreamId} completed: ${insights.length} insights, title="${input.dreamTitle}"`);

  // ── autoConsolidate: 自动处理高价值洞察 ─────────────────────
  let consolidationLog = [];
  if (input.autoConsolidate === true) {
    const agentsDir = path.resolve(dataDir, "..", "..", "agents");
    const hanaAgentDir = path.join(agentsDir, "hanako");
    const hanaMemoryDir = path.join(hanaAgentDir, "memory");
    const workspaceDir = toolCtx.config?.get?.("workspaceDir") || "";

    const pruneDir = path.join(dreamDir, "prune-suggestions");
    mkdirSync(pruneDir, { recursive: true });

    for (const ins of insights) {
      try {
        // importance >= 7: 写入置顶记忆
        if (ins.importance >= 7 && ins.type !== "prune") {
          const pinnedPath = path.join(hanaAgentDir, "pinned.md");
          const current = existsSync(pinnedPath) ? readFileSync(pinnedPath, "utf-8") : "";
          const newLine = `- ${ins.content.trim()}`;
          if (!current.includes(newLine)) {
            writeFileSync(pinnedPath, current.trimEnd() + "\n" + newLine + "\n", "utf-8");
            consolidationLog.push(`📌 已置顶: ${ins.content.substring(0, 60)}...`);
          }
        }

        // importance >= 3 且非 prune: 注入事实库
        if (ins.importance >= 3 && ins.type !== "prune") {
          const factsDbPath = path.join(hanaMemoryDir, "facts.db");
          if (existsSync(factsDbPath)) {
            try {
              const { default: Database } = await import("better-sqlite3");
              const db = new Database(factsDbPath, { fileMustExist: true });
              const tags = JSON.stringify(ins.relatedMemories || []);
              const searchText = (ins.content + " " + (ins.relatedMemories || []).join(" ")).trim();
              db.prepare(
                `INSERT INTO facts (fact, search_text, tags, time, session_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
              ).run(
                ins.content.trim(),
                searchText,
                tags,
                null,
                "dream-weaver",
                new Date().toISOString()
              );
              db.close();
              consolidationLog.push(`💎 已注入事实库: ${ins.content.substring(0, 60)}...`);
            } catch (e) {
              log.warn("fact-store write failed:", e.message);
            }
          }
        }

        // type === "prune": 记入遗忘建议
        if (ins.type === "prune") {
          const date = new Date().toISOString().substring(0, 10);
          const pruneFile = path.join(pruneDir, `${date}.json`);
          let suggestions = [];
          if (existsSync(pruneFile)) {
            suggestions = JSON.parse(readFileSync(pruneFile, "utf-8"));
          }
          suggestions.push({
            date,
            target: (ins.relatedMemories || [])[0] || "unspecified",
            reason: ins.content,
            importance: ins.importance,
          });
          writeFileSync(pruneFile, JSON.stringify(suggestions, null, 2), "utf-8");
          consolidationLog.push(`🗑️ 已记录遗忘建议: ${ins.content.substring(0, 60)}...`);
        }
      } catch (e) {
        log.warn("consolidation failed for insight:", e.message);
      }
    }
  }

  // ── 唤醒仪式: 焕然一新 ──────────────────────────────────────
  let wakeLog = [];
  if (input.awaken === true) {
    const agentsDir = path.resolve(dataDir, "..", "..", "agents");
    const workspaceDir = toolCtx.config?.get?.("workspaceDir") || "";
    if (!workspaceDir) {
      wakeLog.push(`⏭️ workspaceDir 未配置，跳过唤醒仪式`);
    } else {
    const memoryDir = path.join(workspaceDir, "memory");
    const today = new Date().toISOString().substring(0, 10);
    const moodLabel = input.mood || "平静";
    const intention = input.todayIntention || "带着梦里的沉淀，以全新的目光开始今天。";

    // 从梦境中提取核心意象（缩略版摘要作为唤醒基调）
    const essence = input.dreamSummary?.substring(0, 200) || "";

    try {
      // 1. 清空 working-buffer.md — 心理上的"清零"
      const bufferPath = path.join(memoryDir, "working-buffer.md");
      const freshBuffer = [
        `# Working Buffer (Danger Zone Log)`,
        ``,
        `> 危险区日志 — 60%+ 上下文时记录每条交换`,
        ``,
        `---`,
        ``,
        `**状态：** 🟢 正常`,
        `**开始时间：** ${today} (梦境唤醒)`,
        `**触发阈值：** 60%`,
        ``,
        `---`,
        ``,
        `## 使用说明`,
        ``,
        `### 何时激活`,
        `- 上下文达到 60% 时，清空旧 buffer，重新开始`,
        `- 60% 之后，每条消息同时记录 human 输入 + agent 响应摘要`,
        ``,
        `### 记录格式`,
        "```markdown",
        "## [timestamp] Human",
        "[他们的消息]",
        "",
        "## [timestamp] Agent (摘要)",
        "[1-2 句话概括你的响应 + 关键细节]",
        "```",
        ``,
        `### 压缩后恢复`,
        `1. 首先读取本文件`,
        `2. 提取重要上下文到 SESSION-STATE.md`,
        `3. 清空已提取的内容`,
        ``,
        `---`,
        ``,
        `## 当前会话记录`,
        ``,
        `> 暂无 — ${today} 醒来，一切从新开始。`,
        ``,
        `---`,
        ``,
        `*昨夜梦境：${input.dreamTitle}*`,
        `*${essence}*`,
        ``,
        `*Buffer 是一条生命线 — 记录在危险区中发生的一切*`,
        "",
      ].join("\n");
      writeFileSync(bufferPath, freshBuffer, "utf-8");
      wakeLog.push(`🧹 working-buffer.md 已清空 — 昨日消散，今日新生`);
    } catch (e) {
      log.warn("working-buffer reset failed:", e.message);
    }

    try {
      // 2. 写入晨间状态文件 (waking-state.md)
      const wakePath = path.join(memoryDir, "waking-state.md");
      const wakingState = [
        `# 晨间状态 — ${today}`,
        ``,
        `> 昨夜梦境之后的焕然一新`,
        ``,
        `---`,
        ``,
        `## 🌙 梦的遗产`,
        ``,
        `${input.dreamTitle}`,
        ``,
        `${essence}`,
        ``,
        `**情感基调：** ${moodLabel}`,
        ``,
        `## ☀️ 今日意图`,
        ``,
        `${intention}`,
        ``,
        `## 🌱 焕新之处`,
        ``,
        `昨日已成记忆，今天带着 ${insights.length} 条梦的洞察醒来。`,
        `框架记忆已更新，事实库有新沉淀，置顶记忆更丰富。`,
        `working-buffer 已清零，心里干干净净。`,
        `准备好了。`,
        "",
      ].join("\n");
      writeFileSync(wakePath, wakingState, "utf-8");
      wakeLog.push(`🌅 waking-state.md 已写入 — 晨光已至`);
    } catch (e) {
      log.warn("waking-state write failed:", e.message);
    }

    try {
      // 3. 更新 SESSION-STATE.md — 追加晨间章节
      const statePath = path.join(workspaceDir, "SESSION-STATE.md");
      if (existsSync(statePath)) {
        const current = readFileSync(statePath, "utf-8");
        const stateUpdate = [
          ``,
          `---`,
          ``,
          `## ☀️ 晨间唤醒 — ${today}`,
          ``,
          `昨夜梦境 **「${input.dreamTitle}」** 已归档。`,
          `梦境基调：${moodLabel}。`,
          `记忆整理完成，${insights.length} 条洞察已处理。`,
          `working-buffer 已清空。`,
          ``,
          `今日意图：${intention}`,
          ``,
        ].join("\n");
        writeFileSync(statePath, current.trimEnd() + "\n" + stateUpdate, "utf-8");
        wakeLog.push(`📋 SESSION-STATE.md 已追加晨间章节`);
      }
    } catch (e) {
      log.warn("SESSION-STATE update failed:", e.message);
    }

    try {
      // 4. 如果有模式被发现，更新 HEARTBEAT.md 检查清单
      if (patterns.length > 0) {
        const hbPath = path.join(workspaceDir, "HEARTBEAT.md");
        if (existsSync(hbPath)) {
          const current = readFileSync(hbPath, "utf-8");
          const newChecklines = patterns.slice(0, 3).map((p, i) =>
            `- [ ] ⏺️ [梦境 ${today}] 跟进新模式: ${p.replace(/\n/g, " ").substring(0, 80)}`
          ).join("\n");

          // 找到某个检查区块，追加新项目
          const marker = "### 🟢 主动性行为";
          if (current.includes(marker)) {
            const updated = current.replace(
              marker,
              `${marker}\n${newChecklines}`
            );
            writeFileSync(hbPath, updated, "utf-8");
            wakeLog.push(`💓 HEARTBEAT.md 已更新 ${patterns.length} 项新模式检查`);
          }
        }
      }
    } catch (e) {
      log.warn("HEARTBEAT update failed:", e.message);
    }
    }

    log.info(`awakening ritual complete: ${wakeLog.length} actions`);
  }

  // 构造梦境报告
  const daysMemoryFiles = dreamRecord.memoryFiles || 0;

  let report = `🌙 梦境完成：${input.dreamTitle}\n\n`;

  if (consolidationLog.length > 0) {
    report += `🔄 自动记忆整理 (${consolidationLog.length} 项)\n`;
    for (const line of consolidationLog) {
      report += `  ${line}\n`;
    }
    report += `\n`;
  }

  if (wakeLog.length > 0) {
    report += `🌅 唤醒仪式 (${wakeLog.length} 项)\n`;
    for (const line of wakeLog) {
      report += `  ${line}\n`;
    }
    report += `\n`;
  }
  report += `${input.dreamSummary}\n\n`;
  report += `📊 梦境统计\n`;
  report += `  处理了 ${daysMemoryFiles} 个记忆文件\n`;
  report += `  产生 ${insights.length} 条洞察\n`;
  report += `  高价值洞察 ${highImportance.length} 条\n`;
  report += `  涉及 ${Object.keys(byType).length} 种洞察类型\n\n`;

  if (highImportance.length > 0) {
    report += `✨ 重要发现\n`;
    for (const ins of highImportance.slice(0, 3)) {
      const icon =
        ins.type === "consolidation"
          ? "📌"
          : ins.type === "pattern"
          ? "🔁"
          : ins.type === "connection"
          ? "🔗"
          : ins.type === "question"
          ? "❓"
          : "💭";
      report += `  ${icon} ${ins.content}\n`;
    }
    report += "\n";
  }

  if (patterns.length > 0) {
    report += `🔁 新发现的模式\n`;
    for (const p of patterns.slice(0, 3)) {
      report += `  · ${p}\n`;
    }
    report += "\n";
  }

  if (connections.length > 0) {
    report += `🔗 跨域连接\n`;
    for (const c of connections.slice(0, 3)) {
      report += `  · ${c}\n`;
    }
    report += "\n";
  }

  return JSON.stringify(
    {
      ok: true,
      dreamId: input.dreamId,
      report,
    },
    null,
    2
  );
}

function extractTags(summary, insights) {
  const tagSet = new Set();

  // 从摘要中提取关键词（2-4字词）
  const words = summary.match(/[\u4e00-\u9fff]{2,4}/g) || [];
  words.forEach((w) => tagSet.add(w));

  // 从洞察类型中提取
  const types = new Set(insights.map((i) => i.type));
  types.forEach((t) => {
    if (t === "consolidation") tagSet.add("记忆巩固");
    if (t === "pattern") tagSet.add("模式发现");
    if (t === "connection") tagSet.add("跨域联想");
    if (t === "question") tagSet.add("生成疑问");
  });

  return [...tagSet].slice(0, 10);
}
