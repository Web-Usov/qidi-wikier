import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  renderChunkHeader,
  renderContextReview,
  renderThread,
  type ContextLinkReviewRecord,
  type Thread,
} from "./render.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface SkipRecord {
  id: number;
  reason: string;
  text?: string;
}

export function buildReviewRecords(threads: Thread[]): ContextLinkReviewRecord[] {
  const records: ContextLinkReviewRecord[] = [];
  for (const thread of threads) {
    const messageById = new Map(thread.messages.map((message) => [message.id, message]));
    for (const link of thread.inferredLinks) {
      const previous = messageById.get(link.linkedTo);
      const current = messageById.get(link.messageId);
      if (!previous || !current) continue;
      records.push({
        threadId: thread.id,
        topic: thread.topic,
        messageId: link.messageId,
        linkedTo: link.linkedTo,
        score: link.score,
        reasons: link.reasons,
        previousText: previous.text,
        currentText: current.text,
      });
    }
  }
  return records.sort((a, b) => a.score - b.score || a.messageId - b.messageId);
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
  chunksDir: string;
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
  await Promise.all([
    writeFile(join(options.output, "manifest.json"), `${JSON.stringify({ schemaVersion: 2, sourceName: options.sourceName, inputFile: basename(options.inputFile), generatedAt: new Date().toISOString(), chunks: options.chunkFiles }, null, 2)}\n`, "utf8"),
    writeFile(join(options.output, "statistics.json"), `${JSON.stringify(options.statistics, null, 2)}\n`, "utf8"),
    writeFile(join(options.quarantineDir, "uncertain_messages.jsonl"), options.quarantined.map((message) => JSON.stringify(message)).join("\n") + (options.quarantined.length ? "\n" : ""), "utf8"),
    writeFile(join(options.skippedDir, "removal_report.json"), `${JSON.stringify(options.skipped, null, 2)}\n`, "utf8"),
    writeFile(join(options.reviewDir, "context_links.jsonl"), options.reviewRecords.map((record) => JSON.stringify(record)).join("\n") + (options.reviewRecords.length ? "\n" : ""), "utf8"),
    writeFile(join(options.reviewDir, "context_links_sample.md"), renderContextReview(options.reviewRecords.slice(0, options.reviewSampleSize), options.sourceName), "utf8"),
  ]);
}
