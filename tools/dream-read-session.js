/**
 * dream-read-session.js
 *
 * 在梦境中按需读取某段对话的完整记录。
 * 支持按 session ID 读取摘要或完整对话原文。
 * 用于梦境"深梦"阶段——当 Agent 发现某个摘要值得深入挖掘时。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export const name = "dream-read-session";
export const description = "梦境中按需读取某段对话的完整记录。支持读取 session 摘要、完整 JSONL、或按关键词搜索事实库。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "summary", "full", "search-facts", "search-sessions"],
      description:
        "list=列出可选会话; summary=读某条会话的LLM摘要; full=读完整对话原文; search-facts=按关键词搜索事实库; search-sessions=按关键词搜索会话标题",
    },
    sessionId: {
      type: "string",
      description: "会话ID（summary/full 时必填），如 '2026-05-09T06-12-04-492Z_019e0b5d-4d0c-76b1-a89d-063e8f539b4d'",
    },
    query: {
      type: "string",
      description: "search-facts/search-sessions 时的关键词",
    },
    maxMessages: {
      type: "number",
      description: "full 时最多读取多少条消息（默认 50，设为 0 则不限制）",
      default: 50,
    },
    includeTools: {
      type: "boolean",
      description: "full 时是否包含工具调用记录（默认 false，只保留用户和 AI 对话）",
      default: false,
    },
    maxResults: {
      type: "number",
      description: "search 时的最大返回条数",
      default: 10,
    },
  },
  required: ["action"],
};

export async function execute(input, toolCtx) {
  const { dataDir, log } = toolCtx;
  const agentsDir = path.resolve(dataDir, "..", "..", "agents");
  const hanaMemoryDir = path.join(agentsDir, "hanako", "memory");
  const hanaSessionsDir = path.join(agentsDir, "hanako", "sessions");
  const hanaAgentDir = path.join(agentsDir, "hanako");
  const summariesDir = path.join(hanaMemoryDir, "summaries");

  switch (input.action) {
    // ── list: 列出所有可用的会话 ──────────────────────────────────
    case "list": {
      const summaries = existsSync(summariesDir)
        ? readdirSync(summariesDir).filter(f => f.endsWith(".json"))
        : [];

      // 也 scan session JSONL 目录
      const sessionIds = [];
      for (const sd of [hanaSessionsDir, path.join(hanaSessionsDir, "archived")]) {
        if (!existsSync(sd)) continue;
        for (const f of readdirSync(sd)) {
          if (!f.endsWith(".jsonl")) continue;
          sessionIds.push(f.replace(".jsonl", ""));
        }
      }

      // 对齐 summary 和 session
      const summarySet = new Set(summaries.map(f => f.replace(".json", "")));
      const sessionSet = new Set(sessionIds);
      const allIds = new Set([...summarySet, ...sessionSet]);

      const lines = [`📋 可用的会话 (共 ${allIds.size} 个)\n`];
      lines.push(`  ${summarySet.size} 个有摘要 · ${sessionSet.size} 个有完整记录\n`);

      // 按日期排序，显示最近一批
      const sorted = [...allIds].sort().reverse().slice(0, 30);
      for (const id of sorted) {
        const date = id.substring(0, 19).replace("T", " ");
        const hasSummary = summarySet.has(id) ? "📝" : "  ";
        const hasSession = sessionSet.has(id) ? "🪵" : "  ";
        lines.push(`  ${hasSummary}${hasSession}  ${date}  ${id.substring(20, 36)}...`);
      }
      if (allIds.size > 30) {
        lines.push(`  ... 还有 ${allIds.size - 30} 个`);
      }

      lines.push(`\n💡 用 dream-read-session action=summary&sessionId={id} 读摘要`);
      lines.push(`   用 dream-read-session action=full&sessionId={id} 读完整对话`);
      return lines.join("\n");
    }

    // ── summary: 读某条会话的 LLM 摘要 ─────────────────────────────
    case "summary": {
      if (!input.sessionId) return "请提供 sessionId 参数。";

      // 尝试多种路径
      const candidates = [
        path.join(summariesDir, `${input.sessionId}.json`),
        ...(input.sessionId.endsWith(".json") ? [path.join(summariesDir, input.sessionId)] : []),
        // sessionId 可能已经在文件名里带了 .json
      ];
      // 去掉 .jsonl 后缀
      const cleanId = input.sessionId.replace(/\.jsonl$/, "");
      candidates.push(path.join(summariesDir, `${cleanId}.json`));

      let data = null;
      for (const cp of candidates) {
        if (existsSync(cp)) {
          data = JSON.parse(readFileSync(cp, "utf-8"));
          break;
        }
      }

      if (!data) {
        return `未找到 ${input.sessionId} 的摘要。先调用 list 查看可用的会话 ID。`;
      }

      const lines = [`📝 会话摘要: ${input.sessionId}`];
      lines.push(`  更新时间: ${data.updated_at || "?"}`);
      lines.push(`  消息数: ${data.messageCount || "?"}`);
      lines.push(`  深度处理: ${data.deep_processed_at || "未处理"}`);
      lines.push("");
      lines.push(data.summary || "(无摘要)");

      return lines.join("\n");
    }

    // ── full: 读完整对话原文 ──────────────────────────────────────
    case "full": {
      if (!input.sessionId) return "请提供 sessionId 参数。";

      const cleanId = input.sessionId.replace(/\.jsonl$/, "");
      const maxMessages = input.maxMessages || 50;
      const includeTools = input.includeTools === true;

      // 搜索 session 文件
      const searchPaths = [
        path.join(hanaSessionsDir, `${cleanId}.jsonl`),
        path.join(hanaSessionsDir, input.sessionId),
        path.join(hanaSessionsDir, "archived", `${cleanId}.jsonl`),
        path.join(hanaSessionsDir, "archived", input.sessionId),
      ];

      let sessionPath = null;
      for (const sp of searchPaths) {
        if (existsSync(sp)) { sessionPath = sp; break; }
      }

      if (!sessionPath) {
        return `未找到 ${input.sessionId} 的完整对话文件。`;
      }

      const raw = readFileSync(sessionPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      const totalMessages = lines.length;
      const messageLimit = maxMessages > 0 ? Math.min(maxMessages, totalMessages) : totalMessages;
      const startIdx = Math.max(0, totalMessages - messageLimit);

      const output = [`🪵 完整对话: ${cleanId.substring(0, 30)}...`];
      output.push(`  共 ${totalMessages} 条消息，显示最近 ${messageLimit} 条\n`);

      for (let i = startIdx; i < totalMessages; i++) {
        try {
          const msg = JSON.parse(lines[i]);
          const role = msg.role || msg.type || "?";
          const content = typeof msg.content === "string"
            ? msg.content.substring(0, 300)
            : Array.isArray(msg.content)
            ? msg.content.map(c => typeof c === "string" ? c : c.text || JSON.stringify(c)).join(" ").substring(0, 300)
            : JSON.stringify(msg.content).substring(0, 300);

          // 跳过工具调用详情（除非明确要求）
          if (!includeTools && (role === "tool" || role === "tool_call" || msg.isToolCall)) continue;

          const roleLabel =
            role === "user" ? "👤" :
            role === "assistant" ? "🤖" :
            role === "system" ? "⚙️" : "🔧";

          output.push(`${roleLabel} ${content}`);
        } catch {}
      }

      if (!includeTools) {
        output.push(`\n💡 工具调用已隐藏。用 includeTools=true 查看完整记录。`);
      }

      if (messageLimit < totalMessages) {
        output.push(`\n💡 只显示了最近 ${messageLimit} 条。用 maxMessages=0 看全部。`);
      }

      return output.join("\n");
    }

    // ── search-facts: 按关键词搜索事实库 ──────────────────────────
    case "search-facts": {
      if (!input.query) return "请提供 query 关键词。";
      const factsDbPath = path.join(hanaMemoryDir, "facts.db");
      if (!existsSync(factsDbPath)) return "事实库 (facts.db) 不存在。";

      try {
        const { default: Database } = await import("better-sqlite3");
        const db = new Database(factsDbPath, { readonly: true, fileMustExist: true });
        const maxResults = Math.min(input.maxResults || 10, 30);

        // FTS5 搜索
        const ftsResults = db.prepare(`
          SELECT f.id, f.fact, f.tags
          FROM facts_fts fts JOIN facts f ON fts.rowid = f.id
          WHERE facts_fts MATCH ?
          LIMIT ?
        `).all(input.query, maxResults);

        db.close();

        if (ftsResults.length === 0) {
          return `事实库中未找到与「${input.query}」相关的结果。`;
        }

        const lines = [`💎 事实库搜索结果: "${input.query}" (${ftsResults.length} 条)\n`];
        for (const r of ftsResults) {
          const tags = safeParseTags(r.tags);
          lines.push(`  · ${(r.fact || "").substring(0, 200)}`);
          if (tags.length > 0) lines.push(`    标签: ${tags.join(", ")}`);
          lines.push("");
        }
        return lines.join("\n");
      } catch (e) {
        return `搜索事实库失败: ${e.message}`;
      }
    }

    // ── search-sessions: 按关键词搜索会话标题 ─────────────────────
    case "search-sessions": {
      if (!input.query) return "请提供 query 关键词。";
      const maxResults = Math.min(input.maxResults || 10, 30);

      // 从 continuous-presence 索引搜索
      const cpIndexPath = path.resolve(dataDir, "..", "continuous-presence", "index.json");
      let results = [];

      if (existsSync(cpIndexPath)) {
        try {
          const cpData = JSON.parse(readFileSync(cpIndexPath, "utf-8"));
          const sessions = cpData.sessions || {};
          const q = input.query.toLowerCase();

          for (const [id, s] of Object.entries(sessions)) {
            let score = 0;
            const title = (s.title || "").toLowerCase();
            const topics = (s.userTopics || []).join(" ").toLowerCase();
            const tools = (s.toolsUsed || []).join(" ").toLowerCase();

            if (title.includes(q)) score += 5;
            if (topics.includes(q)) score += 3;
            if (tools.includes(q)) score += 2;

            if (score > 0) {
              results.push({
                id,
                title: s.title || "(无标题)",
                score,
                timestamp: s.timestamp || "",
                exchangeCount: s.exchangeCount || 0,
                tools: (s.toolsUsed || []).slice(0, 5),
              });
            }
          }
        } catch {}
      }

      // 也搜索 summaries 目录
      if (existsSync(summariesDir)) {
        const q = input.query.toLowerCase();
        for (const f of readdirSync(summariesDir)) {
          if (!f.endsWith(".json")) continue;
          const fname = f.toLowerCase();
          if (fname.includes(q)) {
            const id = f.replace(".json", "");
            if (!results.find(r => r.id === id)) {
              results.push({
                id,
                title: f,
                score: 3,
                timestamp: f.split("_")[0] || "",
                exchangeCount: 0,
                tools: [],
                source: "filename_match",
              });
            }
          }
        }
      }

      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, maxResults);

      if (results.length === 0) {
        return `未找到与「${input.query}」相关的会话。`;
      }

      const lines = [`🔍 会话搜索: "${input.query}" (${results.length} 条)\n`];
      for (const r of results) {
        const date = r.timestamp ? r.timestamp.substring(0, 10) : r.id.substring(0, 10);
        lines.push(`  [${r.score}] ${date}  ${r.title}`);
        if (r.exchangeCount > 0) lines.push(`      ${r.exchangeCount} 轮 · 工具: ${r.tools.join(", ")}`);
        lines.push(`      ID: ${r.id.substring(0, 45)}...`);
        lines.push("");
      }
      return lines.join("\n");
    }

    default:
      return "未知 action。可选: list / summary / full / search-facts / search-sessions";
  }
}

function safeParseTags(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
