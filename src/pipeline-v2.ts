import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { classifyTopic, removalReason, technicalScore } from "./classify.ts";
import {
  detectTopicAnchors,
  findRootId,
  mergeContextualSingletons,
  type ContextOptions,
  type ThreadDraft,
} from "./context.ts";
import { buildReviewRecords, writeArtifacts, writeChunks, type SkipRecord } from "./output.ts";
import { threadTitle, type Thread } from "./render.ts";
import { normalizeMessage, streamTelegramMessages, type NormalizedMessage } from "./telegram.ts";

export interface PrepareOptions {
  input: string;
  output: string;
  sourceName?: string;
  maxChars: number;
  contextWindowMinutes?: number;
  sameAuthorWindowMinutes?: number;
  minContextScore?: number;
  reviewSampleSize?: number;
}

export async function prepareTelegramExport(options: PrepareOptions): Promise<void> {
  const sourceName = options.sourceName || basename(options.input).replace(/\.[^.]+$/, "");
  const contextOptions: ContextOptions = {
    contextWindowMinutes: options.contextWindowMinutes ?? 12,
    sameAuthorWindowMinutes: options.sameAuthorWindowMinutes ?? 45,
    minContextScore: options.minContextScore ?? 4.0,
  };
  const chunksDir = join(options.output, "chunks");
  const quarantineDir = join(options.output, "quarantine");
  const skippedDir = join(options.output, "skipped");
  const reviewDir = join(options.output, "review");
  await Promise.all([
    mkdir(chunksDir, { recursive: true }),
    mkdir(quarantineDir, { recursive: true }),
    mkdir(skippedDir, { recursive: true }),
    mkdir(reviewDir, { recursive: true }),
  ]);

  const candidates: NormalizedMessage[] = [];
  const skipped: SkipRecord[] = [];
  const quarantined: NormalizedMessage[] = [];
  const explicitTopicAnchors = new Set<number>();
  let rawCount = 0;

  for await (const raw of streamTelegramMessages(options.input)) {
    rawCount += 1;
    if (raw.type === "service" && raw.action === "topic_created" && Number.isInteger(raw.id)) {
      explicitTopicAnchors.add(raw.id as number);
    }
    const message = normalizeMessage(raw);
    if (!message) {
      skipped.push({ id: -1, reason: "invalid-message" });
      continue;
    }
    const reason = removalReason(message);
    if (reason) {
      skipped.push({ id: message.id, reason, text: message.text.slice(0, 300) });
      continue;
    }
    candidates.push(message);
  }

  const topicAnchors = new Set([...explicitTopicAnchors, ...detectTopicAnchors(candidates)]);
  const effectiveCandidates = candidates.filter((message) => {
    if (message.text.length < 8 && message.replyTo && topicAnchors.has(message.replyTo)) {
      skipped.push({ id: message.id, reason: "too-short-topic-message", text: message.text });
      return false;
    }
    return true;
  });

  const byId = new Map(effectiveCandidates.map((message) => [message.id, message]));
  const grouped = new Map<number, NormalizedMessage[]>();
  for (const message of effectiveCandidates) {
    const rootId = findRootId(message, byId, topicAnchors);
    const group = grouped.get(rootId) ?? [];
    group.push(message);
    grouped.set(rootId, group);
  }

  const drafts: ThreadDraft[] = [...grouped.entries()].map(([rootId, messages]) => ({
    rootId,
    messages: messages.sort((a, b) => a.unixTime - b.unixTime || a.id - b.id),
    inferredLinks: [],
  }));
  const merged = mergeContextualSingletons(drafts, topicAnchors, contextOptions);

  const threads: Thread[] = [];
  for (const draft of merged) {
    const score = draft.messages.reduce((sum, message) => sum + technicalScore(message), 0);
    if (score < 2) {
      quarantined.push(...draft.messages);
      continue;
    }
    const combined = draft.messages.map((message) => message.text).join("\n");
    threads.push({
      id: `THREAD-${sourceName.toUpperCase().replace(/[^A-ZА-Я0-9]+/giu, "-")}-${draft.rootId}`,
      rootId: draft.rootId,
      topic: classifyTopic(combined),
      title: threadTitle(draft.messages),
      messages: draft.messages,
      score,
      inferredLinks: draft.inferredLinks,
    });
  }
  threads.sort((a, b) => a.messages[0]!.unixTime - b.messages[0]!.unixTime || a.rootId - b.rootId);

  const reviewRecords = buildReviewRecords(threads);
  const chunkFiles = await writeChunks(threads, chunksDir, sourceName, options.maxChars, topicAnchors);
  const topicCounts = Object.fromEntries(
    [...new Set(threads.map((thread) => thread.topic))].sort().map((topic) => [topic, threads.filter((thread) => thread.topic === topic).length]),
  );
  const removalCounts = Object.fromEntries(
    [...new Set(skipped.map((item) => item.reason))].sort().map((reason) => [reason, skipped.filter((item) => item.reason === reason).length]),
  );
  const statistics = {
    rawMessages: rawCount,
    parsedCandidateMessages: candidates.length,
    candidateMessages: effectiveCandidates.length,
    retainedMessages: threads.reduce((sum, thread) => sum + thread.messages.length, 0),
    skippedMessages: skipped.length,
    quarantinedMessages: quarantined.length,
    threads: threads.length,
    inferredContextLinks: reviewRecords.length,
    contextLinkScoreDistribution: {
      below4: reviewRecords.filter((record) => record.score < 4).length,
      from4To5: reviewRecords.filter((record) => record.score >= 4 && record.score < 5).length,
      atLeast5: reviewRecords.filter((record) => record.score >= 5).length,
    },
    topicCounts,
    removalCounts,
    detectedTopicAnchors: [...topicAnchors].sort((a, b) => a - b),
    contextOptions,
  };

  await writeArtifacts({
    output: options.output,
    sourceName,
    inputFile: options.input,
    chunksDir,
    quarantineDir,
    skippedDir,
    reviewDir,
    chunkFiles,
    statistics,
    skipped,
    quarantined,
    reviewRecords,
    reviewSampleSize: options.reviewSampleSize ?? 100,
  });

  console.log(JSON.stringify({ output: options.output, ...statistics, chunks: chunkFiles.length }, null, 2));
}
