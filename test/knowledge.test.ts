import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeClusters, type ClusterableEvidenceCandidate } from "../src/knowledge.ts";

function candidate(
  id: string,
  overrides: Partial<ClusterableEvidenceCandidate> = {},
): ClusterableEvidenceCandidate {
  const sourceName = overrides.sourceName ?? "qidi_common_chat";
  const numeric = Number(id.match(/(\d+)$/u)?.[1] ?? 1);
  return {
    schemaVersion: 2,
    id,
    threadId: `THREAD-${sourceName.toUpperCase().replace(/_/g, "-")}-${numeric}`,
    rootId: numeric,
    topic: "print-defects",
    title: "PETG на QIDI Q2 расслаивается по слоям",
    messageIds: [numeric],
    authors: [`Author ${numeric}`],
    dateStart: "2026-01-01T12:00:00.000Z",
    dateEnd: "2026-01-01T12:00:00.000Z",
    kinds: ["observation", "answer", "recommendation"],
    status: "ready",
    provisionalReliability: "D",
    knowledgeValue: 0.8,
    technicalScore: 8,
    entities: {
      materials: ["PETG"],
      materialFamilies: ["PETG"],
      primaryMaterialFamilies: ["PETG"],
      printers: ["QIDI-Q2"],
      components: ["layer-adhesion", "temperature"],
      brands: [],
    },
    parameters: [{ kind: "temperature", value: "255 C", messageId: numeric }],
    flags: ["needs-editorial-verification", "answer-not-validated"],
    sourceExcerpt: `[${numeric}] PETG на QIDI Q2 расслаивается. Поднял температуру до 255 C.`,
    sourceName,
    sourceMessages: [{
      id: numeric,
      author: `Author ${numeric}`,
      authorId: `user-${numeric}`,
      date: "2026-01-01T12:00:00.000Z",
      text: "PETG на QIDI Q2 расслаивается по слоям",
      hasMedia: false,
    }],
    ...overrides,
  };
}

test("builds deterministic clusters independent of input order", () => {
  const first = candidate("EVIDENCE-A-1");
  const second = candidate("EVIDENCE-B-2", { sourceName: "qidi_q2_chat" });
  assert.deepEqual(buildKnowledgeClusters([first, second]), buildKnowledgeClusters([second, first]));
});

test("never merges conflicting material or printer scopes", () => {
  const petg = candidate("EVIDENCE-A-1");
  const asa = candidate("EVIDENCE-A-2", {
    entities: {
      materials: ["ASA"],
      materialFamilies: ["ASA"],
      primaryMaterialFamilies: ["ASA"],
      printers: ["QIDI-Q2"],
      components: ["layer-adhesion"],
      brands: [],
    },
  });
  const otherPrinter = candidate("EVIDENCE-A-3", {
    entities: {
      materials: ["PETG"],
      materialFamilies: ["PETG"],
      primaryMaterialFamilies: ["PETG"],
      printers: ["QIDI-PLUS4"],
      components: ["layer-adhesion"],
      brands: [],
    },
  });

  const clusters = buildKnowledgeClusters([petg, asa, otherPrinter]);
  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters.map((cluster) => cluster.scope.materials), [["ASA"], ["PETG"], ["PETG"]]);
});

test("separates support, caution and unresolved evidence", () => {
  const support = candidate("EVIDENCE-A-1");
  const caution = candidate("EVIDENCE-A-2", {
    flags: ["needs-editorial-verification", "ai-generated-or-copied-claim"],
  });
  const unresolved = candidate("EVIDENCE-A-3", {
    kinds: ["question", "observation"],
    status: "question-only",
    flags: ["needs-editorial-verification", "missing-answer"],
  });

  const [cluster] = buildKnowledgeClusters([support, caution, unresolved]);
  assert.ok(cluster);
  assert.deepEqual(cluster.supportEvidenceIds, [support.id]);
  assert.deepEqual(cluster.cautionEvidenceIds, [caution.id]);
  assert.deepEqual(cluster.unresolvedEvidenceIds, [unresolved.id]);
  assert.ok(cluster.flags.includes("contains-cautions"));
  assert.ok(cluster.flags.includes("contains-unresolved-evidence"));
});

test("marks cross-source multi-author support as high review priority without assigning reliability", () => {
  const common = candidate("EVIDENCE-A-1", { sourceName: "qidi_common_chat" });
  const q2 = candidate("EVIDENCE-B-2", {
    sourceName: "qidi_q2_chat",
    sourceMessages: [{
      id: 2,
      author: "Second Author",
      authorId: "user-second",
      date: "2026-01-02T12:00:00.000Z",
      text: "PETG на QIDI Q2: межслойка улучшилась при 255 C",
      hasMedia: false,
    }],
  });

  const [cluster] = buildKnowledgeClusters([common, q2]);
  assert.ok(cluster);
  assert.equal(cluster.reviewPriority, "high");
  assert.equal(cluster.status, "review-required");
  assert.equal(cluster.automatedReliability, "unrated");
  assert.ok(cluster.flags.includes("multi-source"));
  assert.ok(cluster.flags.includes("multi-author-support"));
  assert.equal(cluster.independentAuthors.length, 2);
});

test("preserves parameter provenance by evidence role", () => {
  const support = candidate("EVIDENCE-A-1");
  const caution = candidate("EVIDENCE-A-2", {
    flags: ["needs-editorial-verification", "external-attributed-claim"],
  });
  const [cluster] = buildKnowledgeClusters([support, caution]);
  const variant = cluster?.parameterVariants.find((item) => item.value === "255 C");
  assert.ok(variant);
  assert.deepEqual(variant.supportEvidenceIds, [support.id]);
  assert.deepEqual(variant.cautionEvidenceIds, [caution.id]);
  assert.ok(cluster?.sourceThreadIds.length);
  assert.ok(cluster?.sourceMessageIds.length);
});

test("keeps unanchored candidates isolated", () => {
  const first = candidate("EVIDENCE-A-1", {
    title: "Неуточнённый случай",
    sourceExcerpt: "Техническое наблюдение без извлечённых сущностей.",
    entities: { materials: [], materialFamilies: [], primaryMaterialFamilies: [], printers: [], components: [], brands: [] },
  });
  const second = candidate("EVIDENCE-A-2", {
    title: "Другое неуточнённое наблюдение",
    sourceExcerpt: "Ещё один технический случай без сущностей.",
    entities: { materials: [], materialFamilies: [], primaryMaterialFamilies: [], printers: [], components: [], brands: [] },
  });
  assert.equal(buildKnowledgeClusters([first, second]).length, 2);
});
