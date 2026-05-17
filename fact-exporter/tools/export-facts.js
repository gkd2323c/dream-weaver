/**
 * export-facts.js
 *
 * 将 facts.db 导出为人类可读的 Markdown 文件。
 * 按标签分组展示，并包含全部事实表格和时间线。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export const name = "export-facts";
export const description =
  "将 fact-exporter 的事实库 (facts.db) 导出为人类可读的 Markdown 文件。按标签分组展示，包含全部事实表格、按时间排序的时间线和统计概览。适用于人工翻阅、分享、备份。";

export const parameters = {
  type: "object",
  properties: {
    outputPath: {
      type: "string",
      description:
        "输出文件路径。留空则写入工作区根目录下的 facts-export.md。",
    },
    groupBy: {
      type: "string",
      enum: ["tag", "time", "none"],
      description:
        "分组方式。tag=按标签分组展示（默认）；time=按创建时间排序；none=单一大表。",
      default: "tag",
    },
    includeTable: {
      type: "boolean",
      description: "是否包含全部事实的表格（默认 true）",
      default: true,
    },
    includeTimeline: {
      type: "boolean",
      description: "是否包含时间线（默认 true）",
      default: true,
    },
    maxFactsPerTag: {
      type: "number",
      description: "每个标签最多展示多少条事实。0=不限制（默认 0）",
      default: 0,
    },
    tags: {
      type: "string",
      description:
        "按标签过滤，逗号分隔。只导出包含这些标签的事实。留空则导出全部。",
    },
    minFactsPerTag: {
      type: "number",
      description:
        "标签分组展示时，至少包含多少条事实的标签才会单独列出（默认 1，设为 2 可过滤低频标签）",
      default: 1,
    },
  },
};

export async function execute(input, toolCtx) {
  const log = toolCtx.log;
  const config = toolCtx.config;
  const hanaHome = process.env.HANA_HOME || "";

  // 确定 facts.db 路径
  const hanaMemoryDir = path.resolve(hanaHome, "agents", "hanako", "memory");
  const factsDbPath = path.join(hanaMemoryDir, "facts.db");

  if (!existsSync(factsDbPath)) {
    return `❌ facts.db 不存在：${factsDbPath}`;
  }

  // 确定输出路径
  let outputPath = input.outputPath || "";
  if (!outputPath) {
    const workspaceDir =
      config?.get?.("workspaceDir") ||
      path.resolve(hanaHome, "..", "..", "Documents", "Hanako");
    outputPath = path.join(workspaceDir, "facts-export.md");
  }

  // 解析参数
  const groupBy = input.groupBy || "tag";
  const includeTable = input.includeTable !== false;
  const includeTimeline = input.includeTimeline !== false;
  const maxFactsPerTag = input.maxFactsPerTag || 0;
  const minFactsPerTag = input.minFactsPerTag || 1;
  const tagFilter = input.tags
    ? input.tags.split(",").map((t) => t.trim().toLowerCase())
    : null;

  // 导出配置
  const excludeTags = (config?.get?.("excludeTags") || []).map((t) =>
    t.toLowerCase()
  );

  // ── 读取 facts.db ────────────────────────────────────────────────
  let Database;
  try {
    const mod = await import("better-sqlite3");
    Database = mod.default;
  } catch (e) {
    // Fallback: try from dream-weaver's node_modules
    try {
      const fallbackPath = path.resolve(
        import.meta.url,
        "..",
        "..",
        "..",
        "dream-weaver",
        "node_modules",
        "better-sqlite3"
      );
      const mod = await import(fallbackPath);
      Database = mod.default;
    } catch (e2) {
      return `❌ 无法加载 better-sqlite3: ${e.message}. Fallback also failed: ${e2.message}`;
    }
  }

  let allFacts;
  try {
    const db = new Database(factsDbPath, { readonly: true, fileMustExist: true });
    allFacts = db.prepare("SELECT * FROM facts ORDER BY id").all();
    db.close();
  } catch (e) {
    return `❌ 读取 facts.db 失败: ${e.message}`;
  }

  if (allFacts.length === 0) {
    return "事实库为空，未生成导出文件。";
  }

  // ── 解析和分组 ────────────────────────────────────────────────────
  const parsed = allFacts.map((r) => {
    let tags = [];
    try {
      tags = JSON.parse(r.tags || "[]");
    } catch {
      tags = [];
    }
    return { ...r, tags };
  });

  // 标签过滤
  let filtered = parsed;
  if (tagFilter) {
    filtered = parsed.filter((r) =>
      r.tags.some((t) => tagFilter.includes(t.toLowerCase()))
    );
  }

  // 按标签分组
  const tagGroups = {};
  for (const r of filtered) {
    for (const tag of r.tags) {
      const lowTag = tag.toLowerCase();
      if (excludeTags.includes(lowTag)) continue;
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(r);
    }
  }

  // 过滤低频标签
  for (const [tag, facts] of Object.entries(tagGroups)) {
    if (facts.length < minFactsPerTag) {
      delete tagGroups[tag];
    }
  }

  // 按标签频次排序
  const sortedTags = Object.entries(tagGroups).sort(
    (a, b) => b[1].length - a[1].length
  );

  // 有时间戳的事实（用于时间线）
  const timedFacts = filtered.filter((r) => r.time).sort((a, b) => {
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
    return 0;
  });

  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  // ── 生成 Markdown ────────────────────────────────────────────────
  const lines = [];

  // 标题和元信息
  lines.push("# 事实库快照\n");
  lines.push(`> 生成时间: ${now}\n`);
  lines.push(`> 事实总数: **${filtered.length}**`);
  if (tagFilter) {
    const tagList = tagFilter.join(", ");
    lines.push(`> 标签过滤: \`${tagList}\``);
  } else {
    lines.push(`> 标签种类: **${sortedTags.length}**`);
  }
  lines.push(`> 有时间戳的事件: **${timedFacts.length}**\n`);
  lines.push("---\n");

  // 目录
  lines.push("## 📑 目录\n");
  lines.push("- [按标签浏览](#-按标签浏览)");
  if (includeTable) lines.push("- [全部事实列表](#-全部事实列表)");
  if (includeTimeline) lines.push("- [时间线](#-时间线)");
  lines.push("");

  // ── 按标签浏览 ──────────────────────────────────────────────────
  lines.push("---\n");
  lines.push("## 🏷️ 按标签浏览\n");

  if (sortedTags.length === 0) {
    lines.push("_（无标签分组）_\n");
  } else {
    // 标签快速导航
    lines.push("**标签导航：** ");
    const navLinks = sortedTags.map(
      ([tag]) => `[\`${tag}\`](#${tag.replace(/\s+/g, "-")})`
    );
    lines.push(navLinks.join(" · "));
    lines.push("\n");

    for (const [tag, facts] of sortedTags) {
      lines.push(`### \`${tag}\` (${facts.length}条)\n`);

      const displayFacts =
        maxFactsPerTag > 0 ? facts.slice(0, maxFactsPerTag) : facts;

      for (const f of displayFacts) {
        const timeStr = f.time ? ` — ${f.time}` : "";
        const tagsDisplay = f.tags
          .filter((t) => t !== tag)
          .map((t) => `\`${t}\``)
          .join(" ");
        const extra = [timeStr, tagsDisplay].filter(Boolean).join(" | ");
        lines.push(`- ${f.fact}${extra ? ` _（${extra}）_` : ""}`);
      }

      if (maxFactsPerTag > 0 && facts.length > maxFactsPerTag) {
        lines.push(
          `- _...及另外 ${facts.length - maxFactsPerTag} 条_`
        );
      }
      lines.push("");
    }
  }

  // ── 全部事实列表 ────────────────────────────────────────────────
  if (includeTable) {
    lines.push("---\n");
    lines.push("## 📋 全部事实列表\n");
    lines.push(
      "| # | 事实 | 标签 | 来源会话 |"
    );
    lines.push(
      "|---|------|------|----------|"
    );

    for (const r of filtered) {
      const tagsDisplay = r.tags.join(", ");
      const sessionShort = r.session_id
        ? r.session_id.substring(0, 20) + "..."
        : "-";
      // Escape pipes in fact content
      const factSafe = (r.fact || "").replace(/\|/g, "\\|");
      lines.push(
        `| ${r.id} | ${factSafe} | ${tagsDisplay} | ${sessionShort} |`
      );
    }
    lines.push("");
  }

  // ── 时间线 ──────────────────────────────────────────────────────
  if (includeTimeline && timedFacts.length > 0) {
    lines.push("---\n");
    lines.push("## 📅 时间线\n");
    lines.push("| 时间 | 事实 | 标签 |");
    lines.push("|------|------|------|");

    for (const r of timedFacts) {
      const timeStr = r.time || "-";
      const factSafe = (r.fact || "").replace(/\|/g, "\\|");
      const tagsDisplay = r.tags.join(", ");
      lines.push(`| ${timeStr} | ${factSafe} | ${tagsDisplay} |`);
    }
    lines.push("");
  }

  // ── 统计信息 ────────────────────────────────────────────────────
  lines.push("---\n");
  lines.push("## 📊 统计\n");
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 事实总数 | ${filtered.length} |`);
  lines.push(`| 标签种类 | ${sortedTags.length} |`);
  lines.push(`| 有时间戳的事件 | ${timedFacts.length} |`);
  const recent = filtered
    .filter((r) => r.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);
  if (recent.length > 0) {
    lines.push(`| 最新事实 | ${recent[0].fact.substring(0, 60)} |`);
    lines.push(`| 最旧事实 | ${recent[recent.length - 1].fact.substring(0, 60)} |`);
  }
  lines.push("");

  const content = lines.join("\n");

  // ── 写入文件 ────────────────────────────────────────────────────
  try {
    writeFileSync(outputPath, content, "utf-8");
    log.info(`facts exported to ${outputPath} (${content.length} chars, ${filtered.length} facts)`);
  } catch (e) {
    return `❌ 写入文件失败: ${e.message}`;
  }

  // ── 返回摘要 ────────────────────────────────────────────────────
  const tagSummary = sortedTags
    .slice(0, 10)
    .map(([tag, facts]) => `${tag}(${facts.length})`)
    .join(", ");

  return [
    `✅ 事实库已导出至 \`${outputPath}\``,
    "",
    `**概览:**`,
    `- 事实总数: ${filtered.length}`,
    `- 标签种类: ${sortedTags.length}`,
    ...(tagSummary ? [`- 热门标签: ${tagSummary}${sortedTags.length > 10 ? "..." : ""}`] : []),
    `- 文件大小: ${(content.length / 1024).toFixed(1)} KB`,
    "",
    `**使用方法:** 打开 \`${outputPath}\` 即可阅读。`,
  ].join("\n");
}
