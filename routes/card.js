/**
 * routes/card.js
 *
 * 卡片路由 —— 用于 tool 返回可视化卡片。
 *
 * /card/dream-detail?dreamId=xxx — 单次梦境详细卡片
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";

const route = new Hono();

route.get("/dream-detail", async (c) => {
  const ctx = c.get("pluginCtx");
  const dreamId = c.req.query("dreamId");
  if (!dreamId) {
    return c.html(`<div style="padding:16px;color:#888">需要 dreamId 参数</div>`);
  }

  // 先查 archive，再查 journal
  const archivePath = path.join(ctx.dataDir, "dreams", "archive", `${dreamId}.json`);
  const journalPath = path.join(ctx.dataDir, "dreams", "journal.json");

  let dream = null;

  if (existsSync(archivePath)) {
    try {
      dream = JSON.parse(readFileSync(archivePath, "utf-8"));
    } catch (e) {}
  }

  if (!dream && existsSync(journalPath)) {
    try {
      const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
      dream = (journal.entries || []).find((e) => e.id === dreamId);
    } catch (e) {}
  }

  if (!dream) {
    return c.html(`<div style="padding:16px;color:#888">未找到梦境 ${dreamId}</div>`);
  }

  const date = dream.timestamp || dream.date || "";
  const title = dream.title || dream.journalEntry?.title || "未命名梦境";
  const summary = dream.summary || dream.journalEntry?.summary || "";
  const mood = dream.mood || dream.journalEntry?.mood || "平静";
  const insights = dream.insights || dream.journalEntry?.highlights?.topInsights || [];
  const stats = dream.stats || dream.journalEntry?.stats || {};

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0a0a1a;
      --card: #12122a;
      --border: #2a2a4a;
      --text: #c8c8e0;
      --text-muted: #8888aa;
      --accent: #7c6ff0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 20px;
    }
    .date { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; }
    .title { font-size: 1.3em; font-weight: 500; margin-bottom: 6px; color: var(--accent); }
    .mood { font-size: 0.8em; color: var(--text-muted); margin-bottom: 12px; }
    .summary { line-height: 1.6; color: var(--text); margin-bottom: 16px; }
    .insight { padding: 8px 12px; margin-bottom: 6px; background: var(--card); border-radius: 8px; border: 1px solid var(--border); font-size: 0.9em; }
    .stats-row { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .stat { font-size: 0.8em; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="date">${date ? new Date(date).toLocaleString("zh-CN") : ""}</div>
  <div class="title">🌙 ${title}</div>
  <div class="mood">心境：${mood}</div>
  <div class="stats-row">
    <span class="stat">洞察 ${stats.totalInsights || 0} 条</span>
    <span class="stat">高价值 ${stats.highImportanceCount || 0} 条</span>
  </div>
  <div class="summary">${summary}</div>
  ${insights.slice(0, 5).map(i => `<div class="insight">✦ ${i.content || i}</div>`).join("")}
</body>
</html>`);
});

export default route;
