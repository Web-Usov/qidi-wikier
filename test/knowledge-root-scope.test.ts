import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeClusters, type ClusterableEvidenceCandidate } from "../src/knowledge.ts";

function evidence(id: string, rootText: string, replyText: string, entities: ClusterableEvidenceCandidate["entities"]): ClusterableEvidenceCandidate {
  const numeric = Number(id.match(/(\d+)$/u)?.[1] ?? 1);
  return {
    schemaVersion: 3,
    id,
    sourceName: numeric % 2 ? "qidi_common_chat" : "qidi_q2_chat",
    threadId: `THREAD-ROOT-${numeric}`,
    rootId: numeric,
    topic: "general",
    title: rootText,
    messageIds: [numeric, numeric + 1000],
    authors: [`Root ${numeric}`, `Reply ${numeric}`],
    dateStart: "2026-01-01T12:00:00.000Z",
    dateEnd: "2026-01-01T12:01:00.000Z",
    kinds: ["question", "observation", "answer"],
    status: "ready",
    provisionalReliability: "D",
    knowledgeValue: 0.8,
    technicalScore: 8,
    entities,
    parameters: [],
    flags: ["needs-editorial-verification", "answer-not-validated"],
    sourceMessages: [
      { id: numeric, author: `Root ${numeric}`, authorId: `root-${numeric}`, date: "2026-01-01T12:00:00.000Z", text: rootText, hasMedia: false },
      { id: numeric + 1000, author: `Reply ${numeric}`, authorId: `reply-${numeric}`, date: "2026-01-01T12:01:00.000Z", replyTo: numeric, text: replyText, hasMedia: false },
    ],
    sourceExcerpt: `[${numeric}] ${rootText}\n[${numeric + 1000}] ${replyText}`,
  };
}

test("does not let a drifting reply change the root failure mode", () => {
  const aggregatedEntities = {
    materials: ["PETG"],
    materialFamilies: ["PETG"],
    primaryMaterialFamilies: ["PETG"],
    printers: ["QIDI-Q2"],
    components: ["bed"],
    brands: [],
  };
  const first = evidence(
    "EVIDENCE-1",
    "Оторвал Wi-Fi антенну на QIDI Q2. Чем заменить?",
    "Для PETG на стол используй клей, тогда первый слой липнет.",
    aggregatedEntities,
  );
  const second = evidence(
    "EVIDENCE-2",
    "Как подключить другую Wi-Fi антенну к QIDI Q2?",
    "Заодно PETG лучше печатать с адгезивом на столе.",
    aggregatedEntities,
  );
  const clusters = buildKnowledgeClusters([first, second]);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((cluster) => !cluster.focusTags.includes("bed-adhesion")));
  assert.ok(clusters.every((cluster) => cluster.scope.materials.length === 0));
});

test("uses root material instead of incidental reply material", () => {
  const entities = {
    materials: ["ASA", "PETG"],
    materialFamilies: ["ASA", "PETG"],
    primaryMaterialFamilies: [],
    printers: ["QIDI-Q2"],
    components: ["layer-adhesion"],
    brands: [],
  };
  const first = evidence(
    "EVIDENCE-1",
    "ASA на QIDI Q2 расслаивается по слоям. Что проверить?",
    "На PETG у меня похожего не было.",
    entities,
  );
  const second = evidence(
    "EVIDENCE-2",
    "ASA на QIDI Q2 легко ломается по слоям.",
    "PETG здесь ни при чём.",
    entities,
  );
  const [cluster] = buildKnowledgeClusters([first, second]);
  assert.ok(cluster);
  assert.deepEqual(cluster.scope.materials, ["ASA"]);
  assert.deepEqual(cluster.focusTags, ["layer-adhesion"]);
});

test("does not interpret PA material as pressure advance", () => {
  const entities = {
    materials: ["ABS/PA"],
    materialFamilies: ["ABS", "PA"],
    primaryMaterialFamilies: ["PA"],
    printers: [],
    components: [],
    brands: [],
  };
  const first = evidence("EVIDENCE-1", "Чем ABS/PA отличается от обычного ABS?", "Материал более пластичный.", entities);
  const second = evidence("EVIDENCE-2", "Кто печатал PA, какие свойства?", "Нейлон хорошо держит удар.", entities);
  const clusters = buildKnowledgeClusters([first, second]);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((cluster) => !cluster.focusTags.includes("pressure-advance")));
});
