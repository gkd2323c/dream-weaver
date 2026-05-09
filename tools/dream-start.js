/**
 * dream-start.js (v2)
 *
 * 启动一次梦境会话，扫描框架级记忆源，
 * 返回完整的"梦境素材清单"供 Agent 编织。
 *
 * 扫描来源（按重要程度降序）：
 *   1. memory.md        — 框架编译记忆（facts + today + week + longterm）
 *   2. pinned.md        — 置顶记忆
 *   3. session summaries — 每条对话的滚动摘要
 *   4. session JSONL    — 完整对话原文
 *   5. facts.db         — 元事实存储（SQLite + FTS5）
 *   6. continuous-presence — 会话 metadata 索引
 *   7. workspace memory — MEMORY.md / SOUL.md 等
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const name = "dream-start";
export const description = "启动一次梦境会话，扫描框架级的编译记忆、会话摘要、事实库等全部记忆源，返回完整梦境素材清单。";
export const parameters = {
  type: "object",
  properties: {
    depth: {
      type: "string",
      enum: ["quick", "normal", "deep"],
      description:
        "梦境深度：quick=只看 memory.md 和 pinned.md（最轻量）；normal=增加 summaries 和 facts 统计量（默认）；deep=额外扫描 session 文件头和 fact-store 样例",
      default: "normal",
    },
    focus: {
      type: "string",
      description: "可选关注点，如「MCP 配置」「插件开发」——限制梦境只扫描相关领域",
    },
  },
};

export async function execute(input, toolCtx) {
  const { dataDir, log } = toolCtx;
  const dreamDir = path.join(dataDir, "dreams");
  const agentsDir = path.resolve(dataDir, "..", "..", "agents");
  const hanaMemoryDir = path.join(agentsDir, "hanako", "memory");
  const hanaSessionsDir = path.join(agentsDir, "hanako", "sessions");
  const hanaAgentDir = path.join(agentsDir, "hanako");

  // ── 1. 读取 compiled memory.md ──────────────────────────────────────
  let memoryMd = "";
  let memorySections = {};
  if (existsSync(path.join(hanaMemoryDir, "memory.md"))) {
    memoryMd = readFileSync(path.join(hanaMemoryDir, "memory.md"), "utf-8");
    // 按 ## 标题拆成小节
    const secs = memoryMd.split(/(?=^## )/m);
    for (const s of secs) {
      const titleMatch = s.match(/^## (.+)/m);
      if (titleMatch) {
        memorySections[titleMatch[1].trim()] = s.replace(/^## .+\n*/, "").trim();
      }
    }
  }

  // ── 2. 读取 pinned.md ───────────────────────────────────────────────
  let pinnedCount = 0;
  let pinnedContent = "";
  const pinnedPath = path.join(hanaAgentDir, "pinned.md");
  if (existsSync(pinnedPath)) {
    pinnedContent = readFileSync(pinnedPath, "utf-8").trim();
    pinnedCount = pinnedContent ? pinnedContent.split("\n").filter(l => l.trim().startsWith("- ")).length : 0;
  }

  // ── 3. session summaries 概览 ──────────────────────────────────────
  const summariesDir = path.join(hanaMemoryDir, "summaries");
  const summaryFiles = existsSync(summariesDir)
    ? readdirSync(summariesDir).filter(f => f.endsWith(".json"))
    : [];

  // 取最新几条 summary 的日期范围
  let summaryDateRange = { oldest: null, newest: null };
  const summaryDates = summaryFiles.map(f => f.split("_")[0]).filter(Boolean).sort();
  if (summaryDates.length > 0) {
    summaryDateRange.oldest = summaryDates[0];
    summaryDateRange.newest = summaryDates[summaryDates.length - 1];
  }

  // 读最近 3 条 summary 的标题/话题（仅读 JSON 元的摘要首行）
  const recentSummaries = [];
  const sortedSummaries = [...summaryFiles].sort().reverse().slice(0, 3);
  for (const sf of sortedSummaries) {
    try {
      const data = JSON.parse(readFileSync(path.join(summariesDir, sf), "utf-8"));
      const summary = data.summary || "";
      // 取第一行非空做摘要标题
      const firstLine = summary.split("\n").find(l => l.trim())?.substring(0, 100) || "";
      recentSummaries.push({
        id: data.session_id || sf.replace(".json", ""),
        updatedAt: data.updated_at || null,
        messageCount: data.messageCount || 0,
        preview: firstLine,
      });
    } catch {}
  }

  // ── 4. session JSONL 概览 ──────────────────────────────────────────
  const sessionFiles = [];
  const sessionDirs = [hanaSessionsDir];
  const archivedDir = path.join(hanaSessionsDir, "archived");
  if (existsSync(archivedDir)) sessionDirs.push(archivedDir);

  for (const sd of sessionDirs) {
    if (!existsSync(sd)) continue;
    for (const f of readdirSync(sd)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(sd, f);
      const st = statSync(fp);
      sessionFiles.push({
        name: f,
        size: st.size,
        mtime: st.mtime.toISOString(),
        archived: sd === archivedDir,
      });
    }
  }
  sessionFiles.sort((a, b) => (a.mtime > b.mtime ? -1 : 1));

  const totalSessionSize = sessionFiles.reduce((s, f) => s + f.size, 0);

  // ── 5. fact-store 概览 ─────────────────────────────────────────────
  let factCount = 0;
  let factTags = [];
  let factSamples = [];
  const factsDbPath = path.join(hanaMemoryDir, "facts.db");
  if (existsSync(factsDbPath)) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(factsDbPath, { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT COUNT(*) AS cnt FROM facts").get();
      factCount = row?.cnt || 0;

      if (input.depth === "deep" && factCount > 0) {
        const samples = db.prepare("SELECT id, fact, tags FROM facts ORDER BY id DESC LIMIT 5").all();
        factSamples = samples.map(s => ({
          id: s.id,
          fact: (s.fact || "").substring(0, 120),
          tags: safeParseTags(s.tags),
        }));

        // 提取所有 tag 的词频
        const allTags = db.prepare("SELECT tags FROM facts").all();
        const tagFreq = {};
        for (const row of allTags) {
          for (const t of safeParseTags(row.tags)) {
            tagFreq[t] = (tagFreq[t] || 0) + 1;
          }
        }
        factTags = Object.entries(tagFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([tag, count]) => ({ tag, count }));
      }
      db.close();
    } catch (e) {
      log.warn("fact-store scan skipped:", e.message);
    }
  }

  // ── 6. continuous-presence 索引概览 ───────────────────────────────
  let cpSessions = 0;
  let cpPatterns = 0;
  let cpTools = [];
  let cpRecentTitles = [];
  const cpIndexPath = path.resolve(dataDir, "..", "continuous-presence", "index.json");
  if (existsSync(cpIndexPath)) {
    try {
      const cpData = JSON.parse(readFileSync(cpIndexPath, "utf-8"));
      const sessions = cpData.sessions || {};
      cpSessions = Object.keys(sessions).length;
      cpPatterns = (cpData.patterns || []).length;

      // 提取所有使用过的工具
      const toolSet = new Set();
      for (const s of Object.values(sessions)) {
        for (const t of (s.toolsUsed || [])) toolSet.add(t);
      }
      cpTools = [...toolSet].sort();

      // 最近会话标题
      const asList = Object.entries(sessions).map(([id, s]) => ({
        id,
        title: s.title || "",
        timestamp: s.timestamp || "",
      }));
      asList.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
      cpRecentTitles = asList.slice(0, 8).map(s => s.title);
    } catch (e) {
      log.warn("continuous-presence index scan skipped:", e.message);
    }
  }

  // ── 7. workspace memory 文件（可选）───────────────────────────────
  const workspaceDir = toolCtx.config?.get?.("workspaceDir") || "";
  const workspaceMemory = [];
  const wsMemoryDir = path.join(workspaceDir, "memory");
  if (existsSync(wsMemoryDir)) {
    for (const f of readdirSync(wsMemoryDir)) {
      if (f.endsWith(".md") && f !== "working-buffer.md") {
        const fp = path.join(wsMemoryDir, f);
        const st = statSync(fp);
        workspaceMemory.push({ name: f, mtime: st.mtime.toISOString(), size: st.size });
      }
    }
  }

  // workspace MEMORY.md / SOUL.md / USER.md / HEARTBEAT.md
  const wsFiles = ["MEMORY.md", "SOUL.md", "USER.md", "HEARTBEAT.md"];
  const wsStatus = {};
  for (const f of wsFiles) {
    const fp = path.join(workspaceDir, f);
    if (existsSync(fp)) {
      const st = statSync(fp);
      wsStatus[f] = { size: st.size, mtime: st.mtime.toISOString() };
    }
  }

  // ── 上次做梦记录 ──────────────────────────────────────────────────
  const journalPath = path.join(dreamDir, "journal.json");
  let lastDream = null;
  let dreamCount = 0;
  if (existsSync(journalPath)) {
    try {
      const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
      const entries = journal.entries || [];
      dreamCount = entries.length;
      if (entries.length > 0) lastDream = entries[entries.length - 1];
    } catch {}
  }

  // ── 生成梦境素材清单 ─────────────────────────────────────────────
  const dreamId = `dream_${Date.now()}`;
  const scope = input.depth || "normal";
  const focus = input.focus || null;

  const inventory = {
    compiledMemory: {
      exists: !!memoryMd,
      totalChars: memoryMd.length,
      sections: Object.keys(memorySections).map(k => ({
        name: k,
        chars: (memorySections[k] || "").length,
        isEmpty: !memorySections[k] || memorySections[k] === "（暂无）" || memorySections[k] === "(none)",
      })),
    },
    pinned: { count: pinnedCount },
    summaries: {
      total: summaryFiles.length,
      dateRange: summaryDateRange,
      recentPreviews: recentSummaries,
    },
    sessions: {
      total: sessionFiles.length,
      archivedCount: sessionFiles.filter(f => f.archived).length,
      activeCount: sessionFiles.filter(f => !f.archived).length,
      totalSizeKB: Math.round(totalSessionSize / 1024),
      dateRange: sessionFiles.length > 0
        ? { oldest: sessionFiles[sessionFiles.length - 1]?.mtime, newest: sessionFiles[0]?.mtime }
        : null,
    },
    facts: {
      total: factCount,
      sampleInsights: factSamples,
      topTags: factTags,
    },
    continuousPresence: {
      sessionsIndexed: cpSessions,
      patternsFound: cpPatterns,
      toolsUsed: cpTools.length,
      recentTitles: cpRecentTitles,
    },
    workspaceMemory: {
      dailyLogs: workspaceMemory.length,
      files: workspaceMemory,
      knowledgeFiles: wsStatus,
    },
    dreamHistory: {
      totalDreams: dreamCount,
      lastDreamDate: lastDream?.date || null,
      lastDreamTitle: lastDream?.title || null,
    },
  };

  // ── 保存梦境记录 ──────────────────────────────────────────────────
  mkdirSync(dreamDir, { recursive: true });
  const dreamRecord = {
    id: dreamId,
    timestamp: new Date().toISOString(),
    scope,
    focus,
    status: "dreaming",
    inventory,
    insights: [],
    summary: null,
  };
  writeFileSync(path.join(dreamDir, `${dreamId}.json`), JSON.stringify(dreamRecord, null, 2), "utf-8");
  writeFileSync(path.join(dreamDir, ".active-dream"), dreamId, "utf-8");
  log.info(`dream ${dreamId} started, scope=${scope}, focus=${focus || "(all)"}`);

  // ── 生成人类可读的报告 ──────────────────────────────────────────
  const daysSinceLast = lastDream
    ? Math.round((Date.now() - new Date(lastDream.date).getTime()) / 86400000)
    : null;

  const lines = [];
  lines.push(`🌙 梦境准备就绪 — ${dreamId}`);
  lines.push(`   深度: ${scope === "quick" ? "轻量" : scope === "deep" ? "深度" : "标准"}${focus ? ` · 聚焦: ${focus}` : ""}\n`);

  // Compiled memory
  lines.push(`📖 框架编译记忆 (memory.md)`);
  if (memoryMd) {
    for (const s of inventory.compiledMemory.sections) {
      const icon = s.isEmpty ? "—" : "✓";
      lines.push(`  ${icon} ${s.name} (${s.chars} 字符)`);
    }
  } else {
    lines.push(`  — 不存在`);
  }

  // Summaries
  lines.push(`\n📝 对话摘要 (summaries/)`);
  lines.push(`  共 ${summaryFiles.length} 条`);
  if (summaryDateRange.newest) lines.push(`  范围: ${summaryDateRange.oldest?.substring(0,10)} ~ ${summaryDateRange.newest?.substring(0,10)}`);
  if (recentSummaries.length > 0) {
    lines.push(`  最近几条:`);
    for (const rs of recentSummaries) {
      lines.push(`    · ${rs.preview?.substring(0, 80) || "(空)"}`);
    }
  }

  // Sessions
  lines.push(`\n🪵 完整对话记录 (sessions/*.jsonl)`);
  lines.push(`  共 ${sessionFiles.length} 个文件 (${inventory.sessions.totalSizeKB} KB)`);
  lines.push(`  ${inventory.sessions.activeCount} 个活跃 + ${inventory.sessions.archivedCount} 个归档`);

  // Facts
  lines.push(`\n💎 元事实库 (facts.db)`);
  lines.push(`  共 ${factCount} 条`);
  if (factTags.length > 0) {
    lines.push(`  高频标签: ${factTags.slice(0, 8).map(t => `${t.tag}(${t.count})`).join(" · ")}`);
  }

  // Continuous presence
  lines.push(`\n🔍 会话元数据索引 (continuous-presence)`);
  lines.push(`  索引了 ${cpSessions} 条会话`);
  if (cpPatterns > 0) lines.push(`  发现 ${cpPatterns} 个工作流模式`);
  lines.push(`  涉及 ${cpTools.length} 种工具`);
  if (cpRecentTitles.length > 0) {
    lines.push(`  最近话题:`);
    for (const t of cpRecentTitles) {
      lines.push(`    · ${t}`);
    }
  }

  // Workspace memory
  lines.push(`\n📓 Workspace 层记忆`);
  const wsItems = [...workspaceMemory.map(f => f.name), ...Object.keys(wsStatus)];
  if (wsItems.length > 0) {
    lines.push(`  ${wsItems.join("、")}`);
  }

  // Dream history
  lines.push(`\n📜 梦境历史`);
  lines.push(`  共做过 ${dreamCount} 次梦`);
  if (lastDream) {
    lines.push(`  上次做梦: ${lastDream.title} (${new Date(lastDream.date).toLocaleDateString("zh-CN")})`);
  }

  // 引导词
  lines.push(`\n${focus ? `🎯 本次梦境聚焦「${focus}」，优先阅读 memory.md 中相关内容，再深入 summaries/ 或 session 文件。` : ""}`);
  lines.push(`\n💭 梦境协议指引:`);
  lines.push(`  1. 先读 memory.md — 了解全局记忆快照`);
  lines.push(`  2. 浏览 summaries/ 中的对话摘要，找出值得深入的话题`);
  if (scope === "deep") {
    lines.push(`  3. 用 dream-read-session 阅读感兴趣的完整对话原文`);
    lines.push(`  4. 浏览 facts.db 中的元事实，查漏补缺`);
  } else {
    lines.push(`  3. 必要时用 dream-read-session 查阅完整对话`);
  }
  lines.push(`  4. 每发现一条洞察用 dream-insight 记录`);
  lines.push(`  5. 完成后用 dream-complete 结束梦境`);

  return lines.join("\n");
}

function safeParseTags(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
