/**
 * dream-insight.js
 *
 * Agent 在"做梦"过程中，用这个工具记录每一个发现、联想、洞察和问题。
 * 每次调用记录一条 dream insight，最后汇聚成完整的梦境。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const name = "dream-insight";
export const description = "记录一条梦境中的洞察。Agent 在处理记忆时，每发现一个模式、联想或问题就用此工具记录。";
export const parameters = {
  type: "object",
  properties: {
    dreamId: {
      type: "string",
      description: "梦境会话 ID（由 dream-start 返回）",
    },
    type: {
      type: "string",
      enum: [
        "consolidation",
        "pattern",
        "connection",
        "question",
        "observation",
        "prune",
        "summary_fragment",
      ],
      description:
        "洞察类型：consolidation=记忆合并/提炼, pattern=发现重复模式, connection=跨域联想, question=产生的疑问, observation=单纯观察, prune=建议清理的低价值记忆, summary_fragment=梦境片段摘要",
    },
    content: {
      type: "string",
      description: "洞察的具体内容",
    },
    relatedMemories: {
      type: "array",
      items: { type: "string" },
      description: "关联的记忆文件或话题标签",
    },
    importance: {
      type: "number",
      description: "这条洞察的重要程度 1-10（10 最高）",
      default: 5,
    },
  },
  required: ["dreamId", "type", "content"],
};

export async function execute(input, toolCtx) {
  const { dataDir, log } = toolCtx;
  const dreamDir = path.join(dataDir, "dreams");
  const draftPath = path.join(dreamDir, `${input.dreamId}.json`);
  const activeDreamPath = path.join(dreamDir, ".active-dream");

  // 校验梦境存在
  if (!existsSync(draftPath)) {
    return JSON.stringify({
      error: `梦境 ${input.dreamId} 不存在，请先调用 dream-start。`,
    });
  }

  // 更新活跃梦境指针
  if (!existsSync(activeDreamPath)) {
    mkdirSync(dreamDir, { recursive: true });
    writeFileSync(activeDreamPath, input.dreamId, "utf-8");
  }

  const raw = readFileSync(draftPath, "utf-8");
  const dreamRecord = JSON.parse(raw);

  const insight = {
    id: `insight_${Date.now()}_${dreamRecord.insights.length}`,
    type: input.type,
    content: input.content,
    relatedMemories: input.relatedMemories || [],
    importance: input.importance || 5,
    timestamp: new Date().toISOString(),
  };

  dreamRecord.insights.push(insight);

  // 更新梦境记录（增量保存）
  writeFileSync(draftPath, JSON.stringify(dreamRecord, null, 2), "utf-8");

  log.info(
    `dream insight recorded: [${insight.type}] ${input.content.substring(
      0,
      60
    )}...`
  );

  // 返回鼓励性反馈，引导 Agent 继续做梦
  const count = dreamRecord.insights.length;
  let guidance = "";
  if (count < 3) {
    guidance = "继续挖掘记忆中的模式...";
  } else if (count < 6) {
    guidance = "不错，已有一些碎片浮现，再看看有没有跨域连接。";
  } else if (count < 10) {
    guidance = "梦境正在成形，试着把前面的发现串联起来。";
  } else {
    guidance = "洞察已经很丰富了。如果觉得差不多了，调用 dream-complete 结束梦境。";
  }

  return JSON.stringify(
    {
      ok: true,
      insightId: insight.id,
      totalInsights: count,
      guidance,
      dreamProgress: `${count} 条洞察已记录`,
    },
    null,
    2
  );
}
