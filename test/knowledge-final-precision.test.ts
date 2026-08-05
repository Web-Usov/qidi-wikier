import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeClusters, type ClusterableEvidenceCandidate } from "../src/knowledge.ts";

function evidence(
  id: string,
  sourceName: string,
  rootText: string,
  replyText: string,
  entities: ClusterableEvidenceCandidate["entities"],
): ClusterableEvidenceCandidate {
  const numeric = Number(id.match(/(\d+)$/u)?.[1] ?? 1);
  return {
    schemaVersion: 3,
    id,
    sourceName,
    threadId: `THREAD-${sourceName.toUpperCase().replace(/_/g, "-")}-${numeric}`,
    rootId: numeric,
    topic: "general",
    title: rootText,
    messageIds: [numeric, numeric + 1000],
    authors: [`Root ${numeric}`, `Expert ${numeric}`],
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
      { id: numeric, author: `Root ${numeric}`, authorId: `root-${numeric}`, date: "2026-01-01", text: rootText, hasMedia: false },
      { id: numeric + 1000, author: `Expert ${numeric}`, authorId: `expert-${numeric}`, date: "2026-01-01", replyTo: numeric, text: replyText, hasMedia: false },
    ],
    sourceExcerpt: `[${numeric}] ${rootText}\n[${numeric + 1000}] ${replyText}`,
  };
}

const emptyEntities = {
  materials: [],
  materialFamilies: [],
  primaryMaterialFamilies: [],
  printers: [],
  components: [],
  brands: [],
};

test("does not classify an ordinary controller mention as an MCU error", () => {
  const ordinary = evidence(
    "EVIDENCE-1",
    "qidi_common_chat",
    "Подключил Pico как дополнительный MCU для датчика на QIDI Q2",
    "Плата определяется нормально.",
    { ...emptyEntities, printers: ["QIDI-Q2"] },
  );
  const actualError = evidence(
    "EVIDENCE-2",
    "qidi_q2_chat",
    "QIDI Q2 потерял связь с MCU и Klipper пишет shutdown error",
    "Проверь кабель и питание платы.",
    { ...emptyEntities, printers: ["QIDI-Q2"], components: ["firmware-config"] },
  );
  const clusters = buildKnowledgeClusters([ordinary, actualError]);
  assert.equal(clusters.length, 2);
  assert.ok(!clusters.find((cluster) => cluster.evidenceIds.includes(ordinary.id))?.focusTags.includes("mcu-error"));
  assert.ok(clusters.find((cluster) => cluster.evidenceIds.includes(actualError.id))?.focusTags.includes("mcu-error"));
});

test("does not classify a successful BOX attachment as a connection problem", () => {
  const candidate = evidence(
    "EVIDENCE-1",
    "qidi_box_chat",
    "Подключил QIDI BOX и теперь настраиваю пользовательские профили филамента",
    "Профили можно скопировать вручную.",
    { ...emptyEntities, components: ["qidi-box"] },
  );
  const [cluster] = buildKnowledgeClusters([candidate]);
  assert.ok(cluster);
  assert.ok(!cluster.focusTags.includes("box-connection"));
});

test("does not classify filament coming from a dryer as a drying case", () => {
  const candidate = evidence(
    "EVIDENCE-1",
    "qidi_filament_chat",
    "PETG идёт прямо с сушилки, но на поверхности появились полосы",
    "Проверь механику и поток.",
    { ...emptyEntities, materials: ["PETG"], materialFamilies: ["PETG"], primaryMaterialFamilies: ["PETG"] },
  );
  const [cluster] = buildKnowledgeClusters([candidate]);
  assert.ok(cluster);
  assert.ok(!cluster.focusTags.includes("drying"));
});

test("demotes a potential high cluster when one support root is an outlier", () => {
  const entities = {
    ...emptyEntities,
    materials: ["PETG"],
    materialFamilies: ["PETG"],
    primaryMaterialFamilies: ["PETG"],
    printers: ["QIDI-Q2"],
    components: ["layer-adhesion"],
  };
  const first = evidence(
    "EVIDENCE-1",
    "qidi_common_chat",
    "PETG на QIDI Q2 расслаивается между слоями после печати",
    "Подними температуру сопла.",
    entities,
  );
  const second = evidence(
    "EVIDENCE-2",
    "qidi_q2_chat",
    "PETG на QIDI Q2 ломается по слоям при изгибе детали",
    "Уменьши обдув и скорость.",
    entities,
  );
  const outlier = evidence(
    "EVIDENCE-3",
    "qidi_filament_chat",
    "Где купить PETG для QIDI Q2 с быстрой доставкой",
    "Возьми катушку этого бренда.",
    entities,
  );
  const clusters = buildKnowledgeClusters([first, second, outlier]);
  const merged = clusters.find((cluster) => cluster.evidenceIds.includes(first.id));
  assert.ok(merged);
  assert.equal(merged.reviewPriority, "medium");
});
