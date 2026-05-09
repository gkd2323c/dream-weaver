/**
 * dream-journal.js
 *
 * 查询梦境日记。可查看历史梦境列表、某次梦境的详细内容、整体统计。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const name = "dream-journal";
export const description = "查询梦境日记——查看历史记录、梦境详情、统计概览。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "detail", "stats", "latest"],
      description:
        "list=列出最近的梦境, detail=查看某次梦境的详情(dreamId参数), stats=总体统计, latest=查看最近一次梦境",
      default: "latest",
    },
    dreamId: {
      type: "string",
      description: "梦境 ID（detail 时必填）",
    },
    limit: {
      type: "number",
      description: "list 时返回的条目数",
      default: 10,
    },
  },
  required: ["action"],
};

export async function execute(input, toolCtx) {
  const { dataDir } = toolCtx;
  const journalPath = path.join(dataDir, "dreams", "journal.json");

  if (!existsSync(journalPath)) {
    return "📭 还没有任何梦境记录。今晚开始做梦吧。";
  }

  const raw = readFileSync(journalPath, "utf-8");
  const journal = JSON.parse(raw);
  const entries = journal.entries || [];

  if (entries.length === 0) {
    return "📭 梦境日记是空的。";
  }

  switch (input.action) {
    case "latest": {
      const latest = entries[entries.length - 1];
      return formatDreamDetail(latest);
    }

    case "list": {
      const limit = Math.min(input.limit || 10, 50);
      const recent = entries.slice(-limit).reverse();
      const lines = ["🌙 梦境日记\n"];
      for (const e of recent) {
        const date = new Date(e.date).toLocaleDateString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
        });
        const icons = [];
        if (e.stats?.highImportanceCount > 0) icons.push("✨");
        if (e.stats?.byType?.connection) icons.push("🔗");
        if (e.stats?.byType?.pattern) icons.push("🔁");
        lines.push(
          `  ${date}  ${e.title} ${icons.join("")}`
        );
        lines.push(
          `       ${e.stats?.totalInsights || 0} 条洞察 · ${e.mood || "-"}`
        );
        lines.push(
          `       ${e.summary?.substring(0, 80) || ""}...`
        );
        lines.push("");
      }
      lines.push(`共 ${entries.length} 次梦境`);
      return lines.join("\n");
    }

    case "detail": {
      if (!input.dreamId) return "请提供 dreamId 参数。";
      const entry = entries.find((e) => e.id === input.dreamId);
      if (!entry) return `未找到梦境 ${input.dreamId}`;
      return formatDreamDetail(entry);
    }

    case "stats": {
      const totalDreams = entries.length;
      const totalInsights = entries.reduce(
        (s, e) => s + (e.stats?.totalInsights || 0),
        0
      );
      const highValue = entries.reduce(
        (s, e) => s + (e.stats?.highImportanceCount || 0),
        0
      );
      const typeAgg = {};
      for (const e of entries) {
        const bt = e.stats?.byType || {};
        for (const [t, c] of Object.entries(bt)) {
          typeAgg[t] = (typeAgg[t] || 0) + c;
        }
      }
      const allTags = new Set();
      entries.forEach((e) => (e.tags || []).forEach((t) => allTags.add(t)));

      const firstDate = entries[0]?.date
        ? new Date(entries[0].date).toLocaleDateString("zh-CN")
        : "-";

      const lines = [
        "🌙 梦境统计\n",
        `  总做梦次数：${totalDreams}`,
        `  总洞察数：${totalInsights}`,
        `  高价值洞察：${highValue}`,
        `  首次做梦：${firstDate}`,
        `  平均每次洞察：${(totalInsights / totalDreams).toFixed(1)} 条`,
        "",
        `  洞察类型分布：`,
      ];

      for (const [t, c] of Object.entries(typeAgg).sort(
        (a, b) => b[1] - a[1]
      )) {
        const pct = ((c / totalInsights) * 100).toFixed(1);
        const label =
          t === "consolidation"
            ? "记忆巩固"
            : t === "pattern"
            ? "模式发现"
            : t === "connection"
            ? "跨域联想"
            : t === "question"
            ? "生成疑问"
            : t === "observation"
            ? "单纯观察"
            : t === "prune"
            ? "记忆清理"
            : t;
        lines.push(`    ${label}: ${c} 条 (${pct}%)`);
      }

      lines.push("");
      lines.push(`  涉及标签 (${allTags.size} 个)：`);
      lines.push(
        `    ${[...allTags].slice(0, 15).join("、")}${
          allTags.size > 15 ? "..." : ""
        }`
      );

      return lines.join("\n");
    }

    default:
      return "未知 action，可选：list / detail / stats / latest";
  }
}

function formatDreamDetail(entry) {
  const date = new Date(entry.date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines = [
    `🌙 ${entry.title}`,
    `  日期：${date}`,
    `  心境：${entry.mood || "平静"}`,
    `  范围：${entry.scope === "full" ? "全量回顾" : "增量巩固"}`,
    "",
    `  ${entry.summary}`,
    "",
    `📊 数据`,
    `  总洞察 ${entry.stats?.totalInsights || 0} 条`,
    `  高价值 ${entry.stats?.highImportanceCount || 0} 条`,
    "",
  ];

  if (entry.highlights?.topInsights?.length > 0) {
    lines.push(`✨ 重要发现`);
    for (const ins of entry.highlights.topInsights) {
      lines.push(`  · ${ins.content}`);
    }
    lines.push("");
  }

  if (entry.highlights?.keyConnections?.length > 0) {
    lines.push(`🔗 跨域连接`);
    for (const c of entry.highlights.keyConnections) {
      lines.push(`  · ${c}`);
    }
    lines.push("");
  }

  if (entry.highlights?.keyPatterns?.length > 0) {
    lines.push(`🔁 新发现模式`);
    for (const p of entry.highlights.keyPatterns) {
      lines.push(`  · ${p}`);
    }
    lines.push("");
  }

  if (entry.tags?.length > 0) {
    lines.push(`🏷️ 标签：${entry.tags.join("、")}`);
  }

  return lines.join("\n");
}
