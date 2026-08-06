import { createHash } from "node:crypto";
import { extractEntities, type EntityProfile } from "./entities.ts";
import type { EvidenceCandidate, EvidenceParameter, EvidenceSourceMessage } from "./evidence.ts";

export type KnowledgeEvidenceRole = "support" | "caution" | "unresolved";
export type KnowledgeReviewPriority = "high" | "medium" | "low";
export type ClusterableEvidenceCandidate = EvidenceCandidate;

export interface KnowledgeParameterVariant {
  kind: EvidenceParameter["kind"];
  value: string;
  supportEvidenceIds: string[];
  cautionEvidenceIds: string[];
}

export interface KnowledgeCluster {
  schemaVersion: 2;
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
  independentSupportAuthors: string[];
  supportFingerprints: string[];
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

// These tags intentionally describe technical mechanisms or failure modes.
// Purchasing, generic model requests, broad networking discussions and printer
// comparisons stay in individual evidence candidates instead of being merged.
const FOCUS_PATTERNS: Array<[string, RegExp]> = [
  ["bed-adhesion", /(?:адгези.{0,18}(?:стол|платформ)|не\s+лип|отлип|прилип|перв(?:ый|ого)\s+сло.{0,20}(?:стол|лип|платформ)|(?:клей|адгезив).{0,25}(?:стол|пластин|перв(?:ый|ого)\s+сло)|(?:стол|пластин|перв(?:ый|ого)\s+сло).{0,25}(?:клей|адгезив))/iu],
  ["layer-adhesion", /(?:межсло|рассло|деламинац|по\s+слоям|слои.{0,20}(?:лома|держ|расход))/iu],
  ["warping", /(?:варпинг|загибает|загибается|угол.{0,18}(?:подня|оторв|загнул))/iu],
  ["stringing", /(?:паутин|стринг|stringing|нит(?:и|ей|ями).{0,20}(?:между|детал|перемещ)|волоск)/iu],
  ["under-extrusion", /(?:недоэкстру|нехват.{0,12}пластик|пропуск.{0,10}сло|тонк.{0,8}линии)/iu],
  ["over-extrusion", /(?:переэкстру|избыт.{0,12}пластик|наплыв)/iu],
  ["overhangs", /(?:нависан|овергенг|overhang)/iu],
  ["bridges", /(?:мост(?:ы|ов|ах)|bridge)/iu],
  ["seam", /(?<![\p{L}\p{N}_])(?:шов|шва|шву|швом|шве|швы|швов|швам|швами|швах|seam)(?![\p{L}\p{N}_])/iu],
  ["clog", /(?:засор|пробк|clog|не\s+ид[её]т\s+пластик)/iu],
  ["drying", /(?:сушк|сушить|влажн|температур.{0,18}суш|суш.{0,18}температур)/iu],
  ["resonance", /(?:резонанс|шейпер|input\s*shap|рингинг|эхо)/iu],
  ["wobble", /(?:вобл|wobbl|z[- ]?band|вертикальн.{0,12}полос)/iu],
  ["noise", /(?:шум|скрип|стук|трещит|гул)/iu],
  ["smell", /(?:запах|вон|пахн)/iu],
  ["nozzle-replacement", /(?:(?:замен|менять|смен|откруч|закруч).{0,35}сопл|сопл.{0,35}(?:замен|менять|смен|откруч|закруч))/iu],
  ["nozzle-cleaning", /(?:(?:чист|прочист|засор|пробк).{0,35}сопл|сопл.{0,35}(?:чист|прочист|засор|пробк))/iu],
  ["nozzle-selection", /(?:(?:какие|какое|какой|покупал|производител|латун|сталь|карбид|рубинов|комплект|где\s+взять).{0,50}сопл|сопл.{0,50}(?:покупал|производител|латун|сталь|карбид|рубинов|комплект|где\s+взять))/iu],
  ["firmware-update", /(?:(?:обновлен|обновить|update|скачать).{0,40}(?:прошив|firmware|принтер)|(?:прошив|firmware).{0,40}(?:обновлен|обновить|update|скачать))/iu],
  ["mcu-error", /(?:(?:mcu|klippy).{0,55}(?:ошиб|error|shutdown|не\s+наход|lost|отвал|disconnect)|(?:shutdown|missed\s+scheduling|timer\s+too\s+close|lost\s+communication).{0,55}(?:mcu|klippy)?)/iu],
  ["heater-error", /(?:(?:heater|нагрев|термистор|temperature).{0,35}(?:ошиб|error|verify|fault)|(?:ошиб|error).{0,35}(?:heater|нагрев|термистор|temperature))/iu],
  ["config-error", /(?:(?:config|printer\.cfg|макрос|gcode_macro|klipper).{0,40}(?:ошиб|error|не\s+запуск|restart)|(?:ошиб|error).{0,40}(?:config|printer\.cfg|макрос|klipper))/iu],
  ["usb-storage", /(?:usb|флешк|sd[- ]?карт|накопител)/iu],
  ["power-resume", /(?:отключен.{0,20}(?:свет|питан)|пропал.{0,15}(?:свет|питан)|возобнов|продолж.{0,15}печать|power\s*loss)/iu],
  ["box-connection", /(?:(?:box|бокс).{0,45}(?:не\s+(?:вид|определ|обнаруж|подключ|соедин|работ)|ошиб.{0,12}(?:подключ|соедин)|как\s+подключ)|(?:не\s+(?:вид|определ|обнаруж|подключ|соедин)|как\s+подключ).{0,45}(?:box|бокс))/iu],
  ["multicolor", /(?:многоцвет|смен.{0,15}цвет|цвет.{0,15}смен|purge|прочистк.{0,15}объ[её]м)/iu],
  ["chamber-heating", /(?:(?:камер).{0,30}(?:нагрев|температур|греть|обогрев)|(?:нагрев|обогрев).{0,30}камер)/iu],
  ["cooling-hardware", /(?:(?:вентилятор|кулер|fan|4010|5015).{0,35}(?:замен|менять|апгрейд|модиф|плата|голов)|(?:замен|менять|апгрейд|модиф).{0,35}(?:вентилятор|кулер|fan|4010|5015))/iu],
  ["part-cooling-settings", /(?:(?:обдув|вентилятор).{0,35}(?:%|процент|настрой|сло|скорост|pla|petg|abs|asa|нейлон)|(?:%|процент|настрой).{0,35}(?:обдув|вентилятор))/iu],
  ["exhaust-fan", /(?:вытяжн.{0,20}(?:вентилятор|кулер)|вентилятор.{0,20}вытяж)/iu],
  ["retraction", /(?:ретракт|retract)/iu],
  ["flow", /(?:объ[её]мн.{0,20}(?:расход|поток)|flow\s*rate|макс.{0,10}поток)/iu],
  ["pressure-advance", /(?:pressure\s*advance|прешур|(?:(?:калибров|башн|линия|коэффициент).{0,20}(?<![\p{L}\p{N}_])pa(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])pa(?![\p{L}\p{N}_]).{0,20}(?:калибров|башн|линия|коэффициент)))/iu],
  ["bed-mesh", /(?:bed[_ -]?mesh|сетка\s+стол|карта\s+стол)/iu],
  ["z-offset", /(?:z[-_ ]?offset|зет.?офсет|офсет.{0,10}z)/iu],
  ["belts", /(?<![\p{L}\p{N}_])(?:ремень|ремня|ремни|ремней|ремню|ремнём|ремнями|ремнях)(?![\p{L}\p{N}_])|натяжк.{0,15}рем(?:ня|ней|ни)/iu],
  ["extruder-feed", /(?:заж[её]в|застр|закус|не\s+(?:проходит|проталкива)|пробуксов|шестерн.{0,25}(?:экстру|подач|филамент)|подач.{0,25}(?:не\s|проблем|пропуск)|экструдер.{0,35}(?:заж[её]в|застр|закус|не\s+пода|пробуксов|шестерн))/iu],
  ["camera", /(?:камер[ау]\s+виде|веб.?камер|camera)/iu],
  ["ventilation", /(?:вытяжк|вентиляц|фильтр.{0,15}(?:уголь|hepa))/iu],
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sourceNameOf(candidate: ClusterableEvidenceCandidate): string {
  return candidate.sourceName;
}

function canonicalComponents(components: string[]): string[] {
  const values = uniqueSorted(components);
  if (values.includes("bed-mesh")) return values.filter((value) => value !== "bed");
  const specific = values.filter((value) => !GENERIC_COMPONENTS.has(value));
  return specific.length > 0 ? specific : values;
}

function specificComponents(components: string[]): string[] {
  return uniqueSorted(components.filter((value) => !GENERIC_COMPONENTS.has(value)));
}

function rootContext(candidate: ClusterableEvidenceCandidate): string {
  const root = candidate.sourceMessages.find((message) => message.id === candidate.rootId);
  return `${root?.text ?? ""}\n${candidate.title}`.trim();
}


function scopeOf(candidate: ClusterableEvidenceCandidate): EntityProfile {
  const profile = extractEntities(rootContext(candidate));
  const materialFamilies = uniqueSorted(profile.materialFamilies);
  const primaryMaterialFamilies = uniqueSorted(profile.primaryMaterialFamilies);
  const materials = uniqueSorted(profile.materials);
  return {
    materials: primaryMaterialFamilies.length > 0
      ? primaryMaterialFamilies
      : materialFamilies.length > 0
        ? materialFamilies
        : materials,
    materialFamilies,
    primaryMaterialFamilies,
    printers: uniqueSorted(profile.printers),
    components: canonicalComponents(profile.components),
    brands: uniqueSorted(profile.brands),
  };
}

function focusTagsOf(candidate: ClusterableEvidenceCandidate): string[] {
  const text = rootContext(candidate);
  return FOCUS_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).sort();
}

function scopeKey(candidate: ClusterableEvidenceCandidate): {
  key: string;
  scope: EntityProfile;
  focusTags: string[];
  mergeable: boolean;
} {
  const scope = scopeOf(candidate);
  const focusTags = focusTagsOf(candidate);
  const semanticFacets = uniqueSorted([...specificComponents(scope.components), ...focusTags]);
  const contextAnchors = [scope.materials, scope.printers, scope.brands].filter((values) => values.length > 0).length;
  const mergeable = semanticFacets.length >= 2 || (semanticFacets.length >= 1 && contextAnchors >= 1);
  const payload = {
    topic: candidate.topic,
    materials: scope.materials,
    printers: scope.printers,
    components: scope.components,
    brands: scope.brands,
    focusTags,
    singleton: mergeable ? "" : candidate.id,
  };
  return { key: JSON.stringify(payload), scope, focusTags, mergeable };
}

function actionableMessages(candidate: ClusterableEvidenceCandidate): EvidenceSourceMessage[] {
  const followUps = candidate.sourceMessages.filter((message) => message.id !== candidate.rootId);
  return followUps.length > 0 ? followUps : candidate.sourceMessages;
}

function isAutomatedAuthor(message: EvidenceSourceMessage): boolean {
  const value = `${message.author} ${message.authorId}`.toLowerCase();
  return /(?:^|[^a-z])(?:chatkeeper)?bot(?:[^a-z]|$)/iu.test(value) || /бот$/iu.test(message.author.trim());
}

function nonAutomatedActionableMessages(candidate: ClusterableEvidenceCandidate): EvidenceSourceMessage[] {
  return actionableMessages(candidate).filter((message) => !isAutomatedAuthor(message));
}

function roleOf(candidate: ClusterableEvidenceCandidate): KnowledgeEvidenceRole {
  if (candidate.status !== "ready") return "unresolved";
  if (candidate.flags.some((flag) => CAUTION_FLAGS.has(flag))) return "caution";
  const actionable = actionableMessages(candidate);
  if (actionable.length > 0 && nonAutomatedActionableMessages(candidate).length === 0) return "caution";
  if (!candidate.kinds.some((kind) => kind === "answer" || kind === "recommendation" || kind === "result" || kind === "configuration")) {
    return "unresolved";
  }
  return "support";
}

function authorKeys(candidate: ClusterableEvidenceCandidate): string[] {
  return uniqueSorted(candidate.sourceMessages.map((message) => message.authorId || message.author));
}

function supportAuthorKeys(candidate: ClusterableEvidenceCandidate): string[] {
  return uniqueSorted(nonAutomatedActionableMessages(candidate).map((message) => message.authorId || message.author));
}

function normalizedSupportText(candidate: ClusterableEvidenceCandidate): string {
  const messages = nonAutomatedActionableMessages(candidate);
  const selected = messages.length > 0 ? messages : actionableMessages(candidate);
  return selected.map((message) => message.text)
    .join("\n")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\[Вложение:[^\]]+\]/giu, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function supportFingerprint(candidate: ClusterableEvidenceCandidate): string {
  return createHash("sha256").update(normalizedSupportText(candidate)).digest("hex").slice(0, 16);
}

const ROOT_STOPWORDS = new Set([
  "qidi", "принтер", "принтера", "принтере", "печать", "печати", "печатать", "печатаю",
  "вопрос", "подскажите", "помогите", "привет", "всем", "кто", "что", "как", "какой", "какая",
  "какие", "может", "можно", "нужно", "надо", "есть", "это", "этот", "эта", "для", "при", "после",
  "перед", "или", "уже", "только", "очень", "вообще", "проблема", "проблемой", "стал", "стала",
]);

function rootTokens(candidate: ClusterableEvidenceCandidate): Set<string> {
  const normalized = rootContext(candidate)
    .replace(/https?:\/\/\S+/giu, " ")
    .toLowerCase()
    .replace(/ё/gu, "е");
  const words = normalized.match(/[\p{L}\p{N}+#.-]{3,}/gu) ?? [];
  return new Set(words
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#.-]+$/gu, ""))
    .filter((word) => word.length >= 3 && !ROOT_STOPWORDS.has(word))
    .map((word) => word.length > 7 ? word.slice(0, 7) : word));
}

function rootsSimilar(first: ClusterableEvidenceCandidate, second: ClusterableEvidenceCandidate): boolean {
  const left = rootTokens(first);
  const right = rootTokens(second);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return shared >= 3 || (shared >= 2 && union > 0 && shared / union >= 0.22);
}

function coherentSupport(support: ClusterableEvidenceCandidate[]): boolean {
  if (support.length < 2) return false;
  const everyCandidateHasPeer = support.every((candidate, index) => support.some((peer, peerIndex) => (
    index !== peerIndex && rootsSimilar(candidate, peer)
  )));
  const crossSourcePair = support.some((candidate, index) => support.some((peer, peerIndex) => (
    index !== peerIndex
    && candidate.sourceName !== peer.sourceName
    && rootsSimilar(candidate, peer)
  )));
  return everyCandidateHasPeer && crossSourcePair;
}

function neutralTitle(topic: string, scope: EntityProfile, focusTags: string[]): string {
  const parts = [
    ...scope.materials,
    ...scope.printers,
    ...specificComponents(scope.components),
    ...focusTags,
    ...scope.brands,
  ];
  return `${topic}: ${uniqueSorted(parts).join(" · ") || "отдельный технический случай"}`;
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
    const supportEvidence = evidence.filter((candidate) => roles.get(candidate.id) === "support");
    const supportEvidenceIds = supportEvidence.map((candidate) => candidate.id);
    const cautionEvidenceIds = evidence.filter((candidate) => roles.get(candidate.id) === "caution").map((candidate) => candidate.id);
    const unresolvedEvidenceIds = evidence.filter((candidate) => roles.get(candidate.id) === "unresolved").map((candidate) => candidate.id);
    const sourceNames = uniqueSorted(evidence.map(sourceNameOf));
    const supportSourceNames = uniqueSorted(supportEvidence.map(sourceNameOf));
    const sourceThreadIds = uniqueSorted(evidence.map((candidate) => candidate.threadId));
    const sourceMessageIds = [...new Set(evidence.flatMap((candidate) => candidate.messageIds))].sort((a, b) => a - b);
    const independentAuthors = uniqueSorted(evidence.flatMap(authorKeys));
    const independentSupportAuthors = uniqueSorted(supportEvidence.flatMap(supportAuthorKeys));
    const supportFingerprints = uniqueSorted(supportEvidence.map(supportFingerprint));
    const supportRatio = evidence.length === 0 ? 0 : supportEvidenceIds.length / evidence.length;
    const highConfidenceQueue = supportEvidenceIds.length >= 2
      && independentSupportAuthors.length >= 2
      && supportFingerprints.length >= 2
      && supportSourceNames.length >= 2
      && supportRatio >= 0.5
      && evidence.length <= 20
      && coherentSupport(supportEvidence);
    const reviewPriority: KnowledgeReviewPriority = highConfidenceQueue
      ? "high"
      : supportEvidenceIds.length > 0
        ? "medium"
        : "low";
    const flags: string[] = [];
    if (evidence.length === 1) flags.push("singleton");
    if (sourceNames.length > 1) flags.push("multi-source");
    if (independentSupportAuthors.length > 1) flags.push("multi-author-support");
    if (supportFingerprints.length < supportEvidenceIds.length) flags.push("duplicate-support-wording");
    if (evidence.length > 20) flags.push("broad-review-queue");
    if (cautionEvidenceIds.length > 0) flags.push("contains-cautions");
    if (supportEvidenceIds.length === 0) flags.push("no-verified-support");
    if (unresolvedEvidenceIds.length > 0) flags.push("contains-unresolved-evidence");

    return {
      schemaVersion: 2 as const,
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
      independentSupportAuthors,
      supportFingerprints,
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
