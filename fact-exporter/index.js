/**
 * fact-exporter/index.js
 *
 * 将 facts.db 导出为人类可读的 Markdown 文件。
 *
 * 职责：
 * 1. 初始化导出目录
 * 2. 提供 export-facts 工具供 agent 主动调用
 * 3. 后台监控 facts.db 变化，自动重新导出（实时更新）
 */
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";

export default class FactExporterPlugin {
  #log = null;
  #outputDir = "";
  #watchTimer = null;
  #lastMtime = 0;
  #factsDbPath = "";

  async onload() {
    this.#log = this.ctx.log;
    this.#log.info("📄 Fact Exporter loading...");

    const config = this.ctx.config;
    this.#outputDir = config?.get?.("outputDir") || "";

    if (this.#outputDir) {
      mkdirSync(this.#outputDir, { recursive: true });
    }

    // 确定 facts.db 路径
    const hanaHome = process.env.HANA_HOME || "";
    const hanaMemoryDir = path.resolve(hanaHome, "agents", "hanako", "memory");
    this.#factsDbPath = path.join(hanaMemoryDir, "facts.db");

    // 记录初始 mtime
    if (existsSync(this.#factsDbPath)) {
      try {
        const st = statSync(this.#factsDbPath);
        this.#lastMtime = st.mtimeMs;
      } catch {
        this.#lastMtime = 0;
      }
    }

    // 启动后台监控：每 120 秒检查一次 facts.db 是否更新
    this.#watchTimer = setInterval(() => {
      this.#checkAndExport().catch((e) => {
        this.#log.warn("fact-exporter auto-export error:", e.message);
      });
    }, 120_000);

    // 插件启动时自动导出一次
    setTimeout(() => {
      this.#checkAndExport(true).catch((e) => {
        this.#log.warn("fact-exporter initial export error:", e.message);
      });
    }, 5_000);

    this.#log.info("📄 Fact Exporter ready — auto-export every 120s");
  }

  async onunload() {
    if (this.#watchTimer) {
      clearInterval(this.#watchTimer);
      this.#watchTimer = null;
    }
    this.#log.info("📄 Fact Exporter unloaded.");
  }

  getOutputDir() {
    return this.#outputDir;
  }

  /**
   * 检查 facts.db 是否有变化，有则重新导出。
   */
  async #checkAndExport(force = false) {
    if (!existsSync(this.#factsDbPath)) return;

    let currentMtime;
    try {
      const st = statSync(this.#factsDbPath);
      currentMtime = st.mtimeMs;
    } catch {
      return;
    }

    if (!force && currentMtime <= this.#lastMtime) return;

    this.#lastMtime = currentMtime;
    this.#log.info("facts.db changed, auto-exporting...");

    try {
      const result = await this.#doExport();
      this.#log.info(`auto-export done: ${result.path} (${result.count} facts)`);
    } catch (e) {
      this.#log.warn("auto-export failed:", e.message);
    }
  }

  /**
   * 执行导出，返回 { path, count, chars }
   */
  async #doExport() {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(this.#factsDbPath, { readonly: true, fileMustExist: true });
    const allFacts = db.prepare("SELECT * FROM facts ORDER BY id").all();
    db.close();

    if (allFacts.length === 0) {
      return { path: "", count: 0, chars: 0 };
    }

    // 确定输出路径
    const config = this.ctx.config;
    const hanaHome = process.env.HANA_HOME || "";
    let outputPath = this.#outputDir
      ? path.join(this.#outputDir, "facts-export.md")
      : "";

    if (!outputPath) {
      const workspaceDir =
        config?.get?.("workspaceDir") ||
        path.resolve(hanaHome, "..", "..", "Documents", "Hanako");
      outputPath = path.join(workspaceDir, "facts-export.md");
    }

    const content = buildMarkdown(allFacts);
    writeFileSync(outputPath, content, "utf-8");

    return { path: outputPath, count: allFacts.length, chars: content.length };
  }
}

// ── Markdown 生成（与 export-facts tool 共享逻辑）────────────────────

function parseTags(raw) {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export function buildMarkdown(allFacts) {
  const parsed = allFacts.map((r) => ({ ...r, tags: parseTags(r.tags) }));

  // 按标签分组
  const tagGroups = {};
  for (const r of parsed) {
    for (const tag of r.tags) {
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(r);
    }
  }

  const sortedTags = Object.entries(tagGroups).sort(
    (a, b) => b[1].length - a[1].length
  );

  const timedFacts = parsed
    .filter((r) => r.time)
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  const lines = [];

  // 标题和元信息
  lines.push("# 事实库快照\n");
  lines.push(`> **自动生成** · ${now}  `);
  lines.push(`> 事实总数: **${parsed.length}** · 标签种类: **${sortedTags.length}** · 有时间戳: **${timedFacts.length}**\n`);
  lines.push("---\n");

  // 标签快速导航
  if (sortedTags.length > 0) {
    lines.push("## 🏷️ 标签导航\n");
    const navLinks = sortedTags.map(
      ([tag]) => `[\`${tag}\`](#${tag.replace(/\s+/g, "-")})`
    );
    // 分组展示，每行 8 个
    for (let i = 0; i < navLinks.length; i += 8) {
      lines.push(navLinks.slice(i, i + 8).join(" · "));
    }
    lines.push("\n---\n");
  }

  // 按标签浏览
  lines.push("## 🏷️ 按标签浏览\n");

  for (const [tag, facts] of sortedTags) {
    lines.push(`### \`${tag}\` (${facts.length}条)\n`);

    for (const f of facts) {
      const timeStr = f.time ? ` — ${f.time}` : "";
      const otherTags = f.tags
        .filter((t) => t !== tag)
        .map((t) => `\`${t}\``)
        .join(" ");
      const extra = [timeStr, otherTags].filter(Boolean).join(" | ");
      lines.push(`- ${f.fact}${extra ? ` _（${extra}）_` : ""}`);
    }
    lines.push("");
  }

  // 全部事实表格
  lines.push("---\n");
  lines.push("## 📋 全部事实列表\n");
  lines.push("| # | 事实 | 标签 | 来源 | 时间 |");
  lines.push("|---|------|------|------|------|");

  for (const r of parsed) {
    const tagsDisplay = r.tags.join(", ");
    const sessionShort = r.session_id
      ? r.session_id.substring(0, 16) + "…"
      : "-";
    const timeDisplay = r.time || "-";
    const factSafe = (r.fact || "").replace(/\|/g, "\\|");
    lines.push(`| ${r.id} | ${factSafe} | ${tagsDisplay} | ${sessionShort} | ${timeDisplay} |`);
  }
  lines.push("");

  // 时间线
  if (timedFacts.length > 0) {
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

  // 统计
  lines.push("---\n");
  lines.push("## 📊 统计\n");
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 事实总数 | ${parsed.length} |`);
  lines.push(`| 标签种类 | ${sortedTags.length} |`);
  lines.push(`| 有时间戳的事件 | ${timedFacts.length} |`);

  if (parsed.length > 0) {
    const byCreated = [...parsed]
      .filter((r) => r.created_at)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (byCreated.length > 0) {
      lines.push(`| 最新录入 | ${byCreated[0].created_at.substring(0, 10)} |`);
      lines.push(
        `| 最新事实 | ${byCreated[0].fact.substring(0, 50)} |`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}
