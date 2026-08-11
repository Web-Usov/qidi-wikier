import assert from "node:assert/strict";
import test from "node:test";
import { buildChatReadyExport } from "../src/chat-ready.ts";
import type { EvidenceCandidate } from "../src/evidence.ts";
import type { KnowledgeCluster, KnowledgeReviewPriority } from "../src/knowledge.ts";

const entities = {
  materials: ["PETG"],
  materialFamilies: ["PETG"],
  primaryMaterialFamilies: ["PETG"],
  printers: ["QIDI-Q2"],
  components: ["z-offset"],
  brands: [],
};

function evidence(id: string, author = "Real Name"): EvidenceCandidate {
  return {
    schemaVersion: 3,
    id,
    sourceName: "qidi_q2_chat",
    threadId: `THREAD-${id}`,
    rootId: 1,
    topic: "print-defects",
    title: "PETG test",
    messageIds: [1, 2],
    authors: [author, "Helper"],
    dateStart: "2026-01-01T12:00:00.000Z",
    dateEnd: "2026-01-01T12:01:00.000Z",
    kinds: ["question", "answer"],
    status: "ready",
    provisionalReliability: "D",
    knowledgeValue: 0.8,
    technicalScore: 8,
    entities,
    parameters: [{ kind: "temperature", value: "250 C", messageId: 2 }],
    flags: ["needs-editorial-verification"],
    sourceMessages: [
      {
        id: 1,
        author,
        authorId: "123",
        date: "2026-01-01T12:00:00.000Z",
        text: "PETG слои расходятся",
        hasMedia: false,
      },
      {
        id: 2,
        author: "Helper",
        authorId: "456",
        date: "2026-01-01T12:01:00.000Z",
        replyTo: 1,
        text: "Подними температуру до 250 C",
        hasMedia: false,
      },
    ],
    sourceExcerpt: "PETG слои расходятся",
  };
}

function cluster(
  id: string,
  evidenceId: string,
  reviewPriority: KnowledgeReviewPriority = "high",
): KnowledgeCluster {
  return {
    schemaVersion: 2,
    id,
    key: id,
    title: "print-defects: PETG · QIDI-Q2 · layer-adhesion",
    topic: "print-defects",
    focusTags: ["layer-adhesion"],
    scope: entities,
    status: "review-required",
    automatedReliability: "unrated",
    reviewPriority,
    evidenceIds: [evidenceId],
    supportEvidenceIds: [evidenceId],
    cautionEvidenceIds: [],
    unresolvedEvidenceIds: [],
    sourceNames: ["qidi_q2_chat"],
    sourceThreadIds: [`THREAD-${evidenceId}`],
    sourceMessageIds: [1, 2],
    independentAuthors: ["123", "456"],
    independentSupportAuthors: ["123", "456"],
    supportFingerprints: ["fingerprint"],
    parameterVariants: [],
    flags: [],
  };
}

test("exports a searchable package and anonymizes author metadata", () => {
  const result = buildChatReadyExport([cluster("K1", "E1")], [evidence("E1")]);
  assert.equal(result.manifest.clusters, 1);
  assert.equal(result.manifest.evidenceCandidates, 1);
  const topic = result.files.find((file) => file.path.startsWith("topics/"));
  assert.ok(topic);
  assert.match(topic.content, /PETG слои расходятся/u);
  assert.match(topic.content, /participant-[0-9a-f]{8}/u);
  assert.doesNotMatch(topic.content, /Real Name/u);
  assert.match(topic.content, /Cluster ID: `K1`/u);
  assert.match(topic.content, /msg 2, reply→1/u);
});

test("keeps support, caution and unresolved labels distinct", () => {
  const support = evidence("E-SUPPORT");
  const caution = evidence("E-CAUTION");
  caution.flags.push("media-not-inspected");
  const unresolved = evidence("E-UNRESOLVED");
  unresolved.status = "question-only";
  const item = cluster("K1", support.id);
  item.evidenceIds = [support.id, caution.id, unresolved.id];
  item.supportEvidenceIds = [support.id];
  item.cautionEvidenceIds = [caution.id];
  item.unresolvedEvidenceIds = [unresolved.id];
  const result = buildChatReadyExport([item], [support, caution, unresolved]);
  const content = result.files.find((file) => file.path.startsWith("topics/"))!.content;
  assert.match(content, /Поддерживающие сообщения сообщества/u);
  assert.match(content, /Предостережения и непроверенные сообщения/u);
  assert.match(content, /Нерешённые вопросы и незавершённые наблюдения/u);
  assert.deepEqual(result.manifest.roleDistribution, { support: 1, caution: 1, unresolved: 1 });
});

test("fails when a cluster references missing evidence", () => {
  assert.throws(
    () => buildChatReadyExport([cluster("K1", "E1")], []),
    /Missing 1 referenced evidence candidates/u,
  );
});

test("catalog maps every cluster to its thematic file", () => {
  const result = buildChatReadyExport(
    [cluster("K1", "E1"), cluster("K2", "E2", "low")],
    [evidence("E1"), evidence("E2")],
  );
  const rows = result.files.find((file) => file.path === "catalog.jsonl")!.content.trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.id), ["K1", "K2"]);
  assert.ok(rows.every((row) => row.file.startsWith("topics/print-defects")));
});

test("splits oversized topics without dropping clusters", () => {
  const clusters: KnowledgeCluster[] = [];
  const candidates: EvidenceCandidate[] = [];
  for (let index = 0; index < 8; index += 1) {
    const candidate = evidence(`E${index}`);
    candidate.sourceMessages[0]!.text = "x".repeat(12_000);
    candidates.push(candidate);
    clusters.push(cluster(`K${index}`, candidate.id, index === 0 ? "high" : "low"));
  }
  const result = buildChatReadyExport(clusters, candidates, {
    maxFileChars: 50_000,
    maxEvidenceChars: 12_000,
  });
  const topicFiles = result.files.filter((file) => file.path.startsWith("topics/"));
  assert.ok(topicFiles.length > 1);
  assert.equal(new Set(topicFiles.flatMap((file) => file.clusterIds)).size, 8);
  assert.ok(topicFiles.every((file) => file.path.match(/-\d{2}\.md$/u)));
});
