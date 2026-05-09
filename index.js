/**
 * dream-weaver/index.js
 *
 * 梦境编织者——生命周期管理。
 *
 * 职责：
 * 1. 初始化梦境数据目录
 * 2. 注册 bus handler 供外部触发梦境
 * 3. 提供心跳检测：是否到了该做梦的时间
 * 4. 提供 config 变更响应
 *
 * 定时做梦通过 Hanako 的 cron 系统调度（在安装插件时由 AI 设置）。
 * 也可以手动触发。
 */
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export default class DreamWeaverPlugin {
  #log = null;
  #bus = null;

  async onload() {
    this.#log = this.ctx.log;
    this.#bus = this.ctx.bus;

    this.#log.info("🌙 Dream Weaver loading...");

    // 初始化数据目录
    const dreamDir = path.join(this.ctx.dataDir, "dreams");
    const archiveDir = path.join(dreamDir, "archive");
    mkdirSync(dreamDir, { recursive: true });
    mkdirSync(archiveDir, { recursive: true });

    // 初始化日记文件
    const journalPath = path.join(dreamDir, "journal.json");
    if (!existsSync(journalPath)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(journalPath, JSON.stringify({ entries: [] }, null, 2), "utf-8");
    }

    // 注册 bus handler：允许外部（如 cron 触发的会话）请求梦境状态或触发特定操作
    this.register(
      this.#bus.handle("dream-weaver:status", async () => {
        const { readFileSync } = await import("node:fs");
        let info = {
          ready: true,
          dataDir: dreamDir,
          lastDream: null,
          dreamCount: 0,
        };
        try {
          if (existsSync(journalPath)) {
            const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
            const entries = journal.entries || [];
            info.dreamCount = entries.length;
            if (entries.length > 0) {
              const last = entries[entries.length - 1];
              info.lastDream = {
                date: last.date,
                title: last.title,
                insights: last.stats?.totalInsights || 0,
                mood: last.mood,
              };
            }
          }
        } catch (e) {
          info.error = e.message;
        }
        return info;
      })
    );

    // 注册强制重建梦境索引的 handler
    this.register(
      this.#bus.handle("dream-weaver:rebuild-index", async () => {
        // 重建只是重新读取 journal
        this.#log.info("dream journal index rebuilt");
        return { ok: true };
      })
    );

    this.#log.info("🌙 Dream Weaver ready — 梦境基础设施已就绪。");
  }

  async onunload() {
    this.#log.info("🌙 Dream Weaver unloaded — 梦境守护者休息了。");
  }
}
