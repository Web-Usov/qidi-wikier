import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeClusters, type ClusterableEvidenceCandidate } from "../src/knowledge.ts";

function evidence(
  id: string,
  sourceName: string,
  title: string,
  overrides: Partial<ClusterableEvidenceCandidate> = {},
): ClusterableEvidenceCandidate {
  const numeric = Number(id.match(/(\d+)$/u)?.[1] ?? 1);
  const author = overrides.sourceMessages?.[0]?.author ?? `Author ${numeric}`;
  const authorId = overrides.sourceMessages?.[0]?.authorId ?? `user-${numeric}`;
  return {
    schemaVersion: 3,
    id,
    sourceName,
    threadId: `THREAD-${sourceName.toUpperCase().replace(/_/g, "-")}-${numeric}`,
    rootId: numeric,
    topic: "general",
    title,
    messageIds: [numeric],
    authors: [author],
    dateStart: "2026-01-01T12:00:00.000Z",
    dateEnd: "2026-01-01T12:00:00.000Z",
    kinds: ["observation", "answer"],
    status: "ready",
    provisionalReliability: "D",
    knowledgeValue: 0.8,
    technicalScore: 8,
    entities: {
      materials: [],
      materialFamilies: [],
      primaryMaterialFamilies: [],
      printers: [],
      components: [],
      brands: [],
    },
    parameters: [],
    flags: ["needs-editorial-verification", "answer-not-validated"],
    sourceMessages: [{
      id: numeric,
      author,
      authorId,
      date: "2026-01-01T12:00:00.000Z",
      text: title,
      hasMedia: false,
    }],
    sourceExcerpt: `[${numeric}] ${title}`,
    ...overrides,
  };
}

test("keeps printer-only evidence isolated", () => {
  const first = evidence("EVIDENCE-A-1", "qidi_common_chat", "Как выключать QIDI Q2?", {
    entities: { materials: [], materialFamilies: [], primaryMaterialFamilies: [], printers: ["QIDI-Q2"], components: [], brands: [] },
  });
  const second = evidence("EVIDENCE-B-2", "qidi_q2_chat", "Где скачать модель мусорника для QIDI Q2?", {
    entities: { materials: [], materialFamilies: [], primaryMaterialFamilies: [], printers: ["QIDI-Q2"], components: [], brands: [] },
  });
  assert.equal(buildKnowledgeClusters([first, second]).length, 2);
});

test("keeps a failure-mode tag without context isolated", () => {
  const first = evidence("EVIDENCE-A-1", "qidi_common_chat", "На детали появилась паутина между перемещениями");
  const second = evidence("EVIDENCE-B-2", "qidi_q2_chat", "Как убрать stringing на тесте?");
  assert.equal(buildKnowledgeClusters([first, second]).length, 2);
});

test("merges a failure mode only when a material or printer scopes it", () => {
  const entities = {
    materials: ["PETG"],
    materialFamilies: ["PETG"],
    primaryMaterialFamilies: ["PETG"],
    printers: [],
    components: [],
    brands: [],
  };
  const first = evidence("EVIDENCE-A-1", "qidi_common_chat", "PETG оставляет паутину между перемещениями", { entities });
  const second = evidence("EVIDENCE-B-2", "qidi_filament_chat", "На PETG появился stringing", { entities });
  const clusters = buildKnowledgeClusters([first, second]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.reviewPriority, "high");
});

test("does not count repeated automated replies as independent support", () => {
  const entities = {
    materials: [],
    materialFamilies: [],
    primaryMaterialFamilies: [],
    printers: ["QIDI-Q2"],
    components: ["bed-mesh"],
    brands: [],
  };
  const reply = "Чтобы увидеть карту стола, откройте настройки Fluidd.";
  const first = evidence("EVIDENCE-A-1", "qidi_common_chat", "Где карта стола QIDI Q2?", {
    entities,
    sourceMessages: [
      { id: 1, author: "User", authorId: "user-1", date: "2026-01-01", text: "Где карта стола QIDI Q2?", hasMedia: false },
      { id: 11, author: "ChatKeeperBot", authorId: "bot-chatkeeper", date: "2026-01-01", replyTo: 1, text: reply, hasMedia: false },
    ],
    messageIds: [1, 11],
  });
  const second = evidence("EVIDENCE-B-2", "qidi_q2_chat", "Как открыть bed mesh QIDI Q2?", {
    entities,
    sourceMessages: [
      { id: 2, author: "Another", authorId: "user-2", date: "2026-01-02", text: "Как открыть bed mesh QIDI Q2?", hasMedia: false },
      { id: 12, author: "ChatKeeperBot", authorId: "bot-chatkeeper", date: "2026-01-02", replyTo: 2, text: reply, hasMedia: false },
    ],
    messageIds: [2, 12],
  });
  const [cluster] = buildKnowledgeClusters([first, second]);
  assert.ok(cluster);
  assert.equal(cluster.reviewPriority, "low");
  assert.equal(cluster.supportEvidenceIds.length, 0);
  assert.equal(cluster.cautionEvidenceIds.length, 2);
});

test("demotes broad queues and low support density", () => {
  const entities = {
    materials: [],
    materialFamilies: [],
    primaryMaterialFamilies: [],
    printers: ["QIDI-Q2"],
    components: ["z-offset"],
    brands: [],
  };
  const candidates: ClusterableEvidenceCandidate[] = [];
  for (let index = 1; index <= 21; index += 1) {
    const source = index % 2 === 0 ? "qidi_q2_chat" : "qidi_common_chat";
    candidates.push(evidence(`EVIDENCE-${index}`, source, `QIDI Q2 z-offset настройка ${index}`, {
      entities,
      kinds: index <= 15 ? ["question", "observation"] : ["answer", "observation"],
      status: index <= 15 ? "question-only" : "ready",
      flags: index <= 15 ? ["needs-editorial-verification", "missing-answer"] : ["needs-editorial-verification"],
    }));
  }
  const [cluster] = buildKnowledgeClusters(candidates);
  assert.ok(cluster);
  assert.equal(cluster.reviewPriority, "medium");
  assert.ok(cluster.flags.includes("broad-review-queue"));
});

test("requires distinct support wording for high priority", () => {
  const entities = {
    materials: ["PETG"],
    materialFamilies: ["PETG"],
    primaryMaterialFamilies: ["PETG"],
    printers: [],
    components: ["layer-adhesion"],
    brands: [],
  };
  const answer = "Поднял температуру PETG до 255 C, межслойка стала лучше.";
  const first = evidence("EVIDENCE-A-1", "qidi_common_chat", answer, { entities });
  const second = evidence("EVIDENCE-B-2", "qidi_q2_chat", answer, {
    entities,
    sourceMessages: [{ id: 2, author: "Other", authorId: "user-other", date: "2026-01-02", text: answer, hasMedia: false }],
  });
  const [cluster] = buildKnowledgeClusters([first, second]);
  assert.ok(cluster);
  assert.equal(cluster.reviewPriority, "medium");
  assert.ok(cluster.flags.includes("duplicate-support-wording"));
});
