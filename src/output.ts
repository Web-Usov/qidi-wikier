import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { extractEntities } from "./entities.ts";
import {
  renderChunkHeader,
  renderContextReview,
  renderThread,
  type ContextLinkReviewRecord,
  type Thread,
} from "./render.ts";
import type { ContextEdge } from "./context.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface SkipRecord {
  id: number;
  reason: string;
  text?: string;
}

export function buildReviewRecords(threads: Thread[], edges: ContextEdge[]): ContextLinkReviewRecord[] {
  const threadByRoot = new Map(threads.map((thread) => [thread.rootId, thread]));
  const messageById = new Map(threads.flatMap((thread) => thread.messages.map((message) => [message.id, message] as const)));
  return edges.flatMap((edge) => {
    const sourceThread = threadByRoot.get(edge.sourceRootId);
    const targetThread = threadByRoot.get(edge.targetRootId);
    const current = messageById.get(edge.messageId);
    const previous = messageById.get(edge.linkedTo);
    if (!sourceThread || !targetThread || !current || !previous) return [];
    return [{
      ...edge,
      sourceThreadId: sourceThread.id,
      targetThreadId: targetThread.id,
      topic: sourceThread.topic,
      previousText: previous.text,
      currentText: current.text,
      previousEntities: extractEntities(previous.text),
      currentEntities: extractEntities(current.text),
    }];
  }).sort((a, b) => a.score - b.score || (a.scoreMargin ?? 999) - (b.scoreMargin ?? 999) || a.messageId - b.messageId);
}

function evenlySample<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return items;
  if (count === 1) return [items[0]!];
  const result: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (items.length - 1)) / (count - 1));
    result.push(items[position]!);
  }
  return result;
}

export function stratifiedReviewSample(records: ContextLinkReviewRecord[], sampleSize: number): ContextLinkReviewRecord[] {
  const bands = (["low", "medium", "high"] as const).map((confidence) => records.filter((record) => record.confidence === confidence));
  const base = Math.floor(sampleSize / 3);
  let remaining = sampleSize - base * 3;
  const sampled: ContextLinkReviewRecord[] = [];
  for (const band of bands) {
    const target = Math.min(band.length, base + (remaining > 0 ? 1 : 0));
    if (remaining > 0) remaining -= 1;
    sampled.push(...evenlySample(band, target));
  }
  if (sampled.length < sampleSize) {
    const selected = new Set(sampled.map((record) => `${record.messageId}:${record.linkedTo}`));
    sampled.push(...records.filter((record) => !selected.has(`${record.messageId}:${record.linkedTo}`)).slice(0, sampleSize - sampled.length));
  }
  return sampled;
}

export async function writeChunks(
  threads: Thread[],
  chunksDir: string,
  sourceName: string,
  maxChars: number,
  topicAnchors: Set<number>,
): Promise<Array<{ file: string; threads: number; chars: number }>> {
  const chunkFiles: Array<{ file: string; threads: number; chars: number }> = [];
  let chunkIndex = 1;
  let body = renderChunkHeader(sourceName, chunkIndex);
  let threadCount = 0;
  const flush = async (): Promise<void> => {
    if (threadCount === 0) return;
    const file = `${sourceName}_${String(chunkIndex).padStart(3, "0")}.md`;
    await writeFile(join(chunksDir, file), body, "utf8");
    chunkFiles.push({ file: `chunks/${file}`, threads: threadCount, chars: body.length });
    chunkIndex += 1;
    body = renderChunkHeader(sourceName, chunkIndex);
    threadCount = 0;
  };
  for (const thread of threads) {
    const rendered = renderThread(thread, sourceName, topicAnchors);
    if (threadCount > 0 && body.length + rendered.length > maxChars) await flush();
    body += `${rendered}\n`;
    threadCount += 1;
  }
  await flush();
  return chunkFiles;
}

export async function writeArtifacts(options: {
  output: string;
  sourceName: string;
  inputFile: string;
  quarantineDir: string;
  skippedDir: string;
  reviewDir: string;
  chunkFiles: Array<{ file: string; threads: number; chars: number }>;
  statistics: Record<string, unknown>;
  skipped: SkipRecord[];
  quarantined: NormalizedMessage[];
  reviewRecords: ContextLinkReviewRecord[];
  reviewSampleSize: number;
}): Promise<void> {
  const sample = stratifiedReviewSample(options.reviewRecords, options.reviewSampleSize);
  const totals = {
    low: options.reviewRecords.filter((record) => record.confidence === "low").length,
    medium: options.reviewRecords.filter((record) => record.confidence === "medium").length,
    high: options.reviewRecords.filter((record) => record.confidence === "high").length,
  };
  await Promise.all([
    writeFile(join(options.output, "manifest.json"), `${JSON.stringify({ schemaVersion: 3, sourceName: options.sourceName, inputFile: basename(options.inputFile), generatedAt: new Date().toISOString(), chunks: options.chunkFiles }, null, 2)}\n`, "utf8"),
    writeFile(join(options.output, "statistics.json"), `${JSON.stringify(options.statistics, null, 2)}\n`, "utf8"),
    writeFile(join(options.quarantineDir, "uncertain_messages.jsonl"), options.quarantined.map((message) => JSON.stringify(message)).join("\n") + (options.quarantined.length ? "\n" : ""), "utf8"),
    writeFile(join(options.skippedDir, "removal_report.json"), `${JSON.stringify(options.skipped, null, 2)}\n`, "utf8"),
    writeFile(join(options.reviewDir, "context_graph.jsonl"), options.reviewRecords.map((record) => JSON.stringify(record)).join("\n") + (options.reviewRecords.length ? "\n" : ""), "utf8"),
    writeFile(join(options.reviewDir, "context_links_sample.md"), renderContextReview(sample, options.sourceName, totals), "utf8"),
  ]);
}
