import { createHash } from "node:crypto";
import type { EntityProfile } from "./entities.ts";
import type { EvidenceCandidate, EvidenceParameter } from "./evidence.ts";

export type KnowledgeEvidenceRole = "support" | "caution" | "unresolved";
export type KnowledgeReviewPriority = "high" | "medium" | "low";

export interface EvidenceSourceMessage {
  id: number;
  author: string;
  authorId: string;
  date: string;
  replyTo?: number;
  text: string;
  hasMedia: boolean;
}

export interface ClusterableEvidenceCandidate extends EvidenceCandidate {
  sourceName?: string;
  sourceMessages?: EvidenceSourceMessage[];
}

export interface KnowledgeParameterVariant {
  kind: EvidenceParameter["kind"];
  value: string;
  supportEvidenceIds: string[];
  cautionEvidenceIds: string[];
}

export interface KnowledgeCluster {
  schemaVersion: 1;
  id: string;
  key: string;
  title: string;
  topic: string;
  focusTags: string[];
  scope: EntityProfile;
  status: "review-required";
  automatedReliability: "unrated";
  reviewPriority: KnowledgeReviewPriority;
  evidenceIds: string[];
  supportEvidenceIds: string[];
  cautionEvidenceIds: string[];
  unresolvedEvidenceIds: string[];
  sourceNames: string[];
  sourceThreadIds: string[];
  sourceMessageIds: number[];
  independentAuthors: string[];
  parameterVariants: KnowledgeParameterVariant[];
  flags: string[];
}

const CAUTION_FLAGS = new Set([
  "ai-generated-or-copied-claim",
  "external-attributed-claim",
  "commerce-reference",
  "media-not-inspected",
  "external-reference-only",
]);

const GENERIC_COMPONENTS = new Set(["temperature", "speed"]);

const FOCUS_PATTERNS: Array<[string, RegExp]> = [
  ["bed-adhesion", /(?:адгези.{0,18}(?:стол|платформ)|не\s+лип|отлип|прилип|клей|адгезив)/iu],
  ["layer-adhesion", /(?:межсло|рассло|деламинац|по\s+слоям|слои.{0,20}(?:лома|держ|расход))/iu],
  ["warping", /(?:варпинг|загибает|загибается|угол.{0,18}(?:подня|оторв|загнул))/iu],
  ["stringing", /(?:сопл|паутин|стринг|нит(?:и|ей)|волос)/iu],
  ["under-extrusion", /(?:недоэкстру|нехват.{0,12}пластик|пропуск.{0,10}сло|тонк.{0,8}линии)/iu],
  ["over-extrusion", /(?:переэкстру|избыт.{0,12}пластик|наплыв)/iu],
  ["overhangs", /(?:нависан|овергенг|overhang)/iu],
  ["bridges", /(?:мост(?:ы|ов|ах)|bridge)/iu],
  ["seam", /(?:шов|seam)/iu],
  ["clog", /(?:засор|пробк|clog|не\s+ид[её]т\s+пластик)/iu],
  ["drying", /(?:сушк|сушил|сушить|влажн)/iu],
  ["dimensional-accuracy", /(?:размер|геометри|усадк|калибров.{0,15}(?:xy|размер)|по\s+факту.{0,20}мм)/iu],
  ["surface-quality", /(?:поверхност|полос|ряб|шероховат|артефакт|качество\s+стен)/iu],
  ["resonance", /(?:резонанс|шейпер|input\s*shap|рингинг|эхо)/iu],
  ["wobble", /(?:вобл|wobbl|z[- ]?band|вертикальн.{0,12}полос)/iu],
  ["firmware-error", /(?:ошибк|error|klipper|прошив|firmware)/iu],
  ["loading", /(?:загрузк|заправ|подач.{0,12}филамент)/iu],
  ["unloading", /(?:выгрузк|извлеч|вытаск.{0,12}филамент)/iu],
  ["sync", /(?:синхрон|рассинхрон|sync)/iu],
  ["noise", /(?:шум|скрип|стук|трещит|гул)/iu],
  ["smell", /(?:запах|вон|пахн)/iu],
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sourceNameOf(candidate: ClusterableEvidenceCandidate): string {
  if (candidate.sourceName) return candidate.sourceName;
  const match = candidate.threadId.match(/^THREAD-(.+)-\d+$/u);
  return (match?.[1] ?? "unknown").toLowerCase().replace(/-+/g, "_");
}

function canonicalComponents(components: string[]): string[] {
  const values = uniqueSorted(components);
  if (values.includes("bed-mesh")) return values.filter((value) => value !== "bed");
  const specific = values.filter((value) => !GENERIC_COMPONENTS.has(value));
  return specific.length > 0 ? specific : values;
}

function scopeOf(candidate: ClusterableEvidenceCandidate): EntityProfile {
  const materialFamilies = uniqueSorted(candidate.entities.materialFamilies);
  const primaryMaterialFamilies = uniqueSorted(candidate.entities.primaryMaterialFamilies);
  const materials = uniqueSorted(candidate.entities.materials);
  return {
    materials: primaryMaterialFamilies.length > 0
      ? primaryMaterialFamilies
      : materialFamilies.length > 0
        ? materialFamilies
        : materials,
    materialFamilies,
    primaryMaterialFamilies,
    printers: uniqueSorted(candidate.entities.printers),
    components: canonicalComponents(candidate.entities.components),
    brands: uniqueSorted(candidate.entities.brands),
  };
}

function focusTagsOf(candidate: ClusterableEvidenceCandidate): string[] {
  const text = `${candidate.title}\n${candidate.sourceExcerpt}`;
  return FOCUS_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).sort();
}

function scopeKey(candidate: ClusterableEvidenceCandidate): { key: string; scope: EntityProfile; focusTags: string[] } {
  const scope = scopeOf(candidate);
  const focusTags = focusTagsOf(candidate);
  const anchored = scope.materials.length > 0
    || scope.printers.length > 0
    || scope.components.length > 0
    || scope.brands.length > 0
    || focusTags.length > 0;
  const payload = {
    topic: candidate.topic,
    materials: scope.materials,
    printers: scope.printers,
    components: scope.components,
    brands: scope.brands,
    focusTags,
    singleton: anchored ? "" : candidate.id,
  };
  return { key: JSON.stringify(payload), scope, focusTags };
}

function roleOf(candidate: ClusterableEvidenceCandidate): KnowledgeEvidenceRole {
  if (candidate.status !== "ready") return "unresolved";
  if (candidate.flags.some((flag) => CAUTION_FLAGS.has(flag))) return "caution";
  if (!candidate.kinds.some((kind) => kind === "answer" || kind === "recommendation" || kind === "result" || kind === "configuration")) {
    return "unresolved";
  }
  return "support";
}

function authorKeys(candidate: ClusterableEvidenceCandidate): string[] {
  const fromMessages = candidate.sourceMessages?.map((message) => message.authorId || message.author) ?? [];
  return uniqueSorted(fromMessages.length > 0 ? fromMessages : candidate.authors);
}

function neutralTitle(topic: string, scope: EntityProfile, focusTags: string[]): string {
  const parts = [
    ...scope.materials,
    ...scope.printers,
    ...scope.components,
    ...focusTags,
    ...scope.brands,
  ];
  return `${topic}: ${uniqueSorted(parts).join(" · ") || "неуточнённый технический случай"}`;
}

function parameterKey(parameter: EvidenceParameter): string {
  return `${parameter.kind}:${parameter.value.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function parameterVariants(
  evidence: ClusterableEvidenceCandidate[],
  roles: Map<string, KnowledgeEvidenceRole>,
): KnowledgeParameterVariant[] {
  const grouped = new Map<string, KnowledgeParameterVariant>();
  for (const candidate of evidence) {
    const role = roles.get(candidate.id) ?? "unresolved";
    if (role === "unresolved") continue;
    for (const parameter of candidate.parameters) {
      const key = parameterKey(parameter);
      const current = grouped.get(key) ?? {
        kind: parameter.kind,
        value: parameter.value,
        supportEvidenceIds: [],
        cautionEvidenceIds: [],
      };
      if (role === "support") current.supportEvidenceIds.push(candidate.id);
      else current.cautionEvidenceIds.push(candidate.id);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()]
    .map((variant) => ({
      ...variant,
      supportEvidenceIds: uniqueSorted(variant.supportEvidenceIds),
      cautionEvidenceIds: uniqueSorted(variant.cautionEvidenceIds),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

function clusterId(key: string, topic: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12).toUpperCase();
  const prefix = topic.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "GENERAL";
  return `KNOWLEDGE-${prefix}-${digest}`;
}

export function buildKnowledgeClusters(input: ClusterableEvidenceCandidate[]): KnowledgeCluster[] {
  const candidates = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const buckets = new Map<string, { scope: EntityProfile; focusTags: string[]; evidence: ClusterableEvidenceCandidate[] }>();
  for (const candidate of candidates) {
    const { key, scope, focusTags } = scopeKey(candidate);
    const bucket = buckets.get(key) ?? { scope, focusTags, evidence: [] };
    bucket.evidence.push(candidate);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    const evidence = bucket.evidence.sort((a, b) => a.id.localeCompare(b.id));
    const roles = new Map(evidence.map((candidate) => [candidate.id, roleOf(candidate)] as const));
    const supportEvidenceIds = evidence.filter((candidate) => roles.get(candidate.id) === "support").map((candidate) => candidate.id);
    const cautionEvidenceIds = evidence.filter((candidate) => roles.get(candidate.id) === "caution").map((candidate) => candidate.id);
    const unresolvedEvidenceIds = evidence.filter((candidate) => roles.get(candidate.id) === "unresolved").map((candidate) => candidate.id);
    const sourceNames = uniqueSorted(evidence.map(sourceNameOf));
    const sourceThreadIds = uniqueSorted(evidence.map((candidate) => candidate.threadId));
    const sourceMessageIds = [...new Set(evidence.flatMap((candidate) => candidate.messageIds))].sort((a, b) => a - b);
    const independentAuthors = uniqueSorted(evidence.flatMap(authorKeys));
    const supportAuthors = uniqueSorted(evidence
      .filter((candidate) => roles.get(candidate.id) === "support")
      .flatMap(authorKeys));
    const reviewPriority: KnowledgeReviewPriority = supportEvidenceIds.length >= 2
      && supportAuthors.length >= 2
      && sourceNames.length >= 2
      ? "high"
      : supportEvidenceIds.length > 0
        ? "medium"
        : "low";
    const flags: string[] = [];
    if (evidence.length === 1) flags.push("singleton");
    if (sourceNames.length > 1) flags.push("multi-source");
    if (supportAuthors.length > 1) flags.push("multi-author-support");
    if (cautionEvidenceIds.length > 0) flags.push("contains-cautions");
    if (supportEvidenceIds.length === 0) flags.push("no-verified-support");
    if (unresolvedEvidenceIds.length > 0) flags.push("contains-unresolved-evidence");

    return {
      schemaVersion: 1 as const,
      id: clusterId(key, evidence[0]!.topic),
      key,
      title: neutralTitle(evidence[0]!.topic, bucket.scope, bucket.focusTags),
      topic: evidence[0]!.topic,
      focusTags: bucket.focusTags,
      scope: bucket.scope,
      status: "review-required" as const,
      automatedReliability: "unrated" as const,
      reviewPriority,
      evidenceIds: evidence.map((candidate) => candidate.id),
      supportEvidenceIds,
      cautionEvidenceIds,
      unresolvedEvidenceIds,
      sourceNames,
      sourceThreadIds,
      sourceMessageIds,
      independentAuthors,
      parameterVariants: parameterVariants(evidence, roles),
      flags,
    };
  }).sort((a, b) => {
    const priority = { high: 0, medium: 1, low: 2 } as const;
    return priority[a.reviewPriority] - priority[b.reviewPriority]
      || b.supportEvidenceIds.length - a.supportEvidenceIds.length
      || a.key.localeCompare(b.key);
  });
}
