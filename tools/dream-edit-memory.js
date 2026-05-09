/**
 * dream-edit-memory.js
 *
 * 梦境记忆编辑——做梦后根据洞察强化、整理、遗忘记忆。
 *
 * 安全原则：
 * - 不从框架编译文件（memory.md / today.md / week.md 等），
 *   这些由 memory-ticker 自动管理，直接改会被覆写。
 * - 只操作手动的持久层：pinned.md、MEMORY.md、SOUL.md、facts.db
 * - 所有写操作都是"追加"，不删除不覆盖
 * - prune 只产生建议清单，不自动删除
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const name = "dream-edit-memory";
export const description =
  "根据梦境洞察编辑记忆。支持：pin（写入置顶记忆）、consolidate（写入项目记忆）、add-fact（注入事实库）、update-soul（更新行为准则）、archive-log（归档旧日志）、prune（标记遗忘建议）。所有写操作只追加不覆盖。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "pin",
        "consolidate",
        "add-fact",
        "update-soul",
        "archive-log",
        "prune",
      ],
      description:
        "pin=写入置顶记忆(pinned.md); consolidate=写入项目记忆(MEMORY.md); add-fact=注入事实库(facts.db); update-soul=更新行为准则(SOUL.md); archive-log=归档旧日志; prune=标记遗忘建议",
    },
    content: {
      type: "string",
      description: "要写入的内容（pin/consolidate/update-soul 时必填）",
    },
    section: {
      type: "string",
      description:
        "consolidate 时指定 MEMORY.md 中的章节，如「项目里程碑」「技术笔记」「安全准则」「待跟进」",
      default: "项目里程碑",
    },
    fact: {
      type: "string",
      description: "add-fact 时的元事实内容",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "add-fact 时的标签列表",
      default: [],
    },
    factTime: {
      type: "string",
      description: "add-fact 时的事件时间（ISO 格式或留空）",
    },
    target: {
      type: "string",
      description: "prune/archive-log 时的目标文件名或描述",
    },
    reason: {
      type: "string",
      description: "prune 时的理由",
    },
    preview: {
      type: "boolean",
      description: "预览更改而不实际写入",
      default: false,
    },
  },
  required: ["action"],
};

export async function execute(input, toolCtx) {
  const { dataDir, log } = toolCtx;
  const agentsDir = path.resolve(dataDir, "..", "..", "agents");
  const hanaMemoryDir = path.join(agentsDir, "hanako", "memory");
  const hanaAgentDir = path.join(agentsDir, "hanako");
  const workspaceDir = toolCtx.config?.get?.("workspaceDir") || "";

  const previewOnly = input.preview === true;

  switch (input.action) {
    // ── pin: 写入置顶记忆 ─────────────────────────────────────────
    case "pin": {
      if (!input.content) return "pin 操作需要 content 参数。";

      const pinnedPath = path.join(hanaAgentDir, "pinned.md");
      const current = existsSync(pinnedPath)
        ? readFileSync(pinnedPath, "utf-8")
        : "";

      const newLine = `- ${input.content.trim()}`;

      // 去重检查
      if (current.includes(newLine)) {
        return `⏭️ 这条内容已在 pinned.md 中，跳过。`;
      }

      if (previewOnly) {
        return `📋 预览：将在 pinned.md 末尾追加：
  ${newLine}`;
      }

      const updated = current.trimEnd() + "\n" + newLine + "\n";
      writeFileSync(pinnedPath, updated, "utf-8");
      log.info(`pinned.md: +1 (${input.content.substring(0, 50)}...)`);

      return `✅ 已写入置顶记忆。当前共 ${countLines(updated)} 条。`;
    }

    // ── consolidate: 写入 MEMORY.md ───────────────────────────────
    case "consolidate": {
      if (!input.content) return "consolidate 操作需要 content 参数。";
      if (!workspaceDir) return "⏭️ workspaceDir 未配置，无法写入 MEMORY.md。";

      const memoryPath = path.join(workspaceDir, "MEMORY.md");
      const section = input.section || "项目里程碑";

      const current = existsSync(memoryPath)
        ? readFileSync(memoryPath, "utf-8")
        : "# MEMORY.md\n\n> Hanako 的长期记忆\n\n";

      // 写入格式：在指定 section 下追加
      const dateTag = new Date().toISOString().substring(0, 10);
      const newEntry = `\n### ${dateTag} 梦境提炼\n${input.content.trim()}\n`;

      // 找 section 位置
      const sectionRegex = new RegExp(`(## ${escapeRegex(section)}\\n+)`, "m");
      let updated;
      if (sectionRegex.test(current)) {
        updated = current.replace(
          sectionRegex,
          `$1${newEntry}\n`
        );
      } else {
        // section 不存在，追加到文件末尾
        updated = current.trimEnd() + `\n\n## ${section}\n${newEntry}\n`;
      }

      if (previewOnly) {
        return `📋 预览：将在 MEMORY.md 的「${section}」节追加：
${newEntry.trim()}`;
      }

      writeFileSync(memoryPath, updated, "utf-8");
      log.info(`MEMORY.md: consolidated into [${section}]`);

      return `✅ 已写入 MEMORY.md（${section} 节）。`;
    }

    // ── add-fact: 注入事实库 ──────────────────────────────────────
    case "add-fact": {
      if (!input.fact) return "add-fact 操作需要 fact 参数。";

      const factsDbPath = path.join(hanaMemoryDir, "facts.db");
      if (!existsSync(factsDbPath)) {
        return "❌ facts.db 不存在，无法写入。";
      }

      try {
        const { default: Database } = await import("better-sqlite3");
        const db = new Database(factsDbPath, { fileMustExist: true });

        const fact = input.fact.trim();
        const tags = JSON.stringify(input.tags || []);
        const searchText = buildFactSearchText(fact, input.tags || []);
        const time = input.factTime || null;
        const now = new Date().toISOString();

        db.prepare(
          `INSERT INTO facts (fact, search_text, tags, time, session_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(fact, searchText, tags, time, "dream-weaver", now);

        // 查最新 ID
        const row = db.prepare("SELECT id FROM facts ORDER BY id DESC LIMIT 1").get();
        db.close();

        log.info(`facts.db: +1 (ID=${row?.id}, fact="${fact.substring(0, 60)}...")`);
        return `✅ 已注入事实库。fact ID=${row?.id}，当前共计 ${row?.id || "?"} 条。`;
      } catch (e) {
        return `❌ 写入事实库失败: ${e.message}`;
      }
    }

    // ── update-soul: 更新 SOUL.md ────────────────────────────────
    case "update-soul": {
      if (!input.content) return "update-soul 操作需要 content 参数。";
      if (!workspaceDir) return "⏭️ workspaceDir 未配置，无法写入 SOUL.md。";

      const soulPath = path.join(workspaceDir, "SOUL.md");
      const current = existsSync(soulPath)
        ? readFileSync(soulPath, "utf-8")
        : "";

      const newEntry = `- ${input.content.trim()}`;

      if (current.includes(newEntry)) {
        return `⏭️ 这条内容已在 SOUL.md 中。`;
      }

      if (previewOnly) {
        return `📋 预览：将在 SOUL.md 末尾追加：
  ${newEntry}`;
      }

      const updated = current.trimEnd() + "\n" + newEntry + "\n";
      writeFileSync(soulPath, updated, "utf-8");
      log.info(`SOUL.md: +1`);

      return `✅ 已更新 SOUL.md。`;
    }

    // ── archive-log: 归档旧日志 ──────────────────────────────────
    case "archive-log": {
      if (!input.target) return "archive-log 操作需要 target（文件名）参数。";
      if (!workspaceDir) return "⏭️ workspaceDir 未配置，无法归档。";

      const memoryDir = path.join(workspaceDir, "memory");
      const archiveDir = path.join(memoryDir, "archived");
      const targetPath = path.join(memoryDir, input.target);

      if (!existsSync(targetPath)) {
        return `❌ 文件 ${input.target} 不存在于 memory/ 目录。`;
      }

      if (previewOnly) {
        return `📋 预览：将归档 ${input.target} → memory/archived/${input.target}`;
      }

      mkdirSync(archiveDir, { recursive: true });
      const { renameSync } = await import("node:fs");
      renameSync(targetPath, path.join(archiveDir, input.target));
      log.info(`archived: ${input.target}`);

      return `✅ 已归档 ${input.target} → memory/archived/。`;
    }

    // ── prune: 标记遗忘建议 ──────────────────────────────────────
    case "prune": {
      if (!input.target) return "prune 操作需要 target 参数。";

      const suggestionsDir = path.join(dataDir, "dreams", "prune-suggestions");
      mkdirSync(suggestionsDir, { recursive: true });

      const date = new Date().toISOString().substring(0, 10);
      const suggestion = {
        date,
        target: input.target,
        reason: input.reason || "未说明理由",
        dreamInsight: input.content || null,
      };

      // 追加到当天的遗忘建议文件
      const todayFile = path.join(suggestionsDir, `${date}.json`);
      let suggestions = [];
      if (existsSync(todayFile)) {
        suggestions = JSON.parse(readFileSync(todayFile, "utf-8"));
      }
      suggestions.push(suggestion);
      writeFileSync(todayFile, JSON.stringify(suggestions, null, 2), "utf-8");

      log.info(`prune suggestion: ${input.target}`);
      return `📋 已记录遗忘建议：${input.target}。这些建议不会自动执行，用户可以查看后决定。`;
    }

    default:
      return `未知 action: ${input.action}`;
  }
}

function countLines(text) {
  return text.split("\n").filter((l) => l.trim().startsWith("- ")).length;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFactSearchText(fact, tags) {
  const base = [fact, ...tags].filter(Boolean).join(" ");
  // 简单的中文二元/三元组提取
  const cjk = (base.match(/[\u4e00-\u9fff]+/g) || []).join("");
  const grams = [];
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i <= cjk.length - size; i++) {
      grams.push(cjk.substring(i, i + size));
    }
  }
  const unique = [...new Set([base, ...grams])];
  return unique.join(" ");
}
