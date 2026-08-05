import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { classifyTopic, knowledgeValue, removalReason, technicalScore } from "./classify.ts";
import {
  detectTopicAnchors,
  findRootId,
  inferContextGraph,
  type ContextOptions,
  type ThreadDraft,
} from "./context.ts";
import { buildEvidenceCandidates } from "./evidence.ts";
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
  minScoreMargin?: number;
  minEvidenceValue?: number;
  reviewSampleSize?: number;
}

export async function prepareTelegramExport(options: PrepareOptions): Promise<void> {
  const sourceName = options.sourceName || basename(options.input).replace(/\.[^.]+$/, "");
  const contextOptions: ContextOptions = {
    contextWindowMinutes: options.contextWindowMinutes ?? 12,
    sameAuthorWindowMinutes: options.sameAuthorWindowMinutes ?? 45,
    minContextScore: options.minContextScore ?? 4,
    minScoreMargin: options.minScoreMargin ?? 0.75,
  };
  const minEvidenceValue = options.minEvidenceValue ?? 0.6;
  const chunksDir = join(options.output, "chunks");
  const quarantineDir = join(options.output, "quarantine");
  const skippedDir = join(options.output, "skipped");
  const reviewDir = join(options.output, "review");
  const evidenceDir = join(options.output, "evidence");
  await Promise.all([
    mkdir(chunksDir, { recursive: true }),
    mkdir(quarantineDir, { recursive: true }),
    mkdir(skippedDir, { recursive: true }),
    mkdir(reviewDir, { recursive: true }),
    mkdir(evidenceDir, { recursive: true }),
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
  }));

  const preliminaryThreads: Thread[] = [];
  const retainedRootIds = new Set<number>();
  for (const draft of drafts) {
    const score = draft.messages.reduce((sum, message) => sum + technicalScore(message), 0);
    if (score < 2) {
      quarantined.push(...draft.messages);
      continue;
    }
    const combined = draft.messages.map((message) => message.text).join("\n");
    const value = Math.max(...draft.messages.map(knowledgeValue));
    preliminaryThreads.push({
      id: `THREAD-${sourceName.toUpperCase().replace(/[^A-ZА-Я0-9]+/giu, "-")}-${draft.rootId}`,
      rootId: draft.rootId,
      topic: classifyTopic(combined),
      title: threadTitle(draft.messages),
      messages: draft.messages,
      score,
      knowledgeValue: value,
      contextEdges: [],
    });
    retainedRootIds.add(draft.rootId);
  }

  const retainedDrafts = drafts.filter((draft) => retainedRootIds.has(draft.rootId));
  const graph = inferContextGraph(retainedDrafts, topicAnchors, contextOptions);
  const edgesBySourceRoot = new Map<number, typeof graph.edges>();
  for (const edge of graph.edges) {
    const bucket = edgesBySourceRoot.get(edge.sourceRootId) ?? [];
    bucket.push(edge);
    edgesBySourceRoot.set(edge.sourceRootId, bucket);
  }
  for (const thread of preliminaryThreads) thread.contextEdges = edgesBySourceRoot.get(thread.rootId) ?? [];
  preliminaryThreads.sort((a, b) => a.messages[0]!.unixTime - b.messages[0]!.unixTime || a.rootId - b.rootId);

  const reviewRecords = buildReviewRecords(preliminaryThreads, graph.edges);
  const evidenceCandidates = buildEvidenceCandidates(preliminaryThreads, minEvidenceValue);
  const chunkFiles = await writeChunks(preliminaryThreads, chunksDir, sourceName, options.maxChars, topicAnchors);
  const topicCounts = Object.fromEntries(
    [...new Set(preliminaryThreads.map((thread) => thread.topic))].sort().map((topic) => [topic, preliminaryThreads.filter((thread) => thread.topic === topic).length]),
  );
  const removalCounts = Object.fromEntries(
    [...new Set(skipped.map((item) => item.reason))].sort().map((reason) => [reason, skipped.filter((item) => item.reason === reason).length]),
  );
  const knowledgeValueDistribution = {
    low: preliminaryThreads.filter((thread) => thread.knowledgeValue < 0.25).length,
    medium: preliminaryThreads.filter((thread) => thread.knowledgeValue >= 0.25 && thread.knowledgeValue < 0.6).length,
    high: preliminaryThreads.filter((thread) => thread.knowledgeValue >= 0.6).length,
  };
  const evidenceStatusDistribution = {
    ready: evidenceCandidates.filter((candidate) => candidate.status === "ready").length,
    "question-only": evidenceCandidates.filter((candidate) => candidate.status === "question-only").length,
    "needs-context": evidenceCandidates.filter((candidate) => candidate.status === "needs-context").length,
    "reference-only": evidenceCandidates.filter((candidate) => candidate.status === "reference-only").length,
  };
  const evidenceReliabilityDistribution = {
    C: evidenceCandidates.filter((candidate) => candidate.provisionalReliability === "C").length,
    D: evidenceCandidates.filter((candidate) => candidate.provisionalReliability === "D").length,
  };
  const evidenceKindCounts = Object.fromEntries(
    (["question", "observation", "answer", "recommendation", "result", "configuration", "reference"] as const)
      .map((kind) => [kind, evidenceCandidates.filter((candidate) => candidate.kinds.includes(kind)).length]),
  );
  const statistics = {
    schemaVersion: 4,
    rawMessages: rawCount,
    parsedCandidateMessages: candidates.length,
    candidateMessages: effectiveCandidates.length,
    retainedMessages: preliminaryThreads.reduce((sum, thread) => sum + thread.messages.length, 0),
    skippedMessages: skipped.length,
    quarantinedMessages: quarantined.length,
    exactThreads: preliminaryThreads.length,
    inferredContextLinks: reviewRecords.length,
    contextLinkScoreDistribution: {
      low: reviewRecords.filter((record) => record.confidence === "low").length,
      medium: reviewRecords.filter((record) => record.confidence === "medium").length,
      high: reviewRecords.filter((record) => record.confidence === "high").length,
    },
    contextGraphDiagnostics: graph.diagnostics,
    knowledgeValueDistribution,
    evidenceCandidates: evidenceCandidates.length,
    evidenceStatusDistribution,
    evidenceReliabilityDistribution,
    evidenceKindCounts,
    topicCounts,
    removalCounts,
    detectedTopicAnchors: [...topicAnchors].sort((a, b) => a - b),
    contextOptions,
    evidenceOptions: { minKnowledgeValue: minEvidenceValue },
  };

  await writeArtifacts({
    output: options.output,
    sourceName,
    inputFile: options.input,
    quarantineDir,
    skippedDir,
    reviewDir,
    evidenceDir,
    chunkFiles,
    statistics,
    skipped,
    quarantined,
    reviewRecords,
    evidenceCandidates,
    reviewSampleSize: options.reviewSampleSize ?? 120,
  });

  console.log(JSON.stringify({ output: options.output, ...statistics, chunks: chunkFiles.length }, null, 2));
}
