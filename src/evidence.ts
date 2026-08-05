import { ACTION_ANSWER, isQuestionLike } from "./classify.ts";
import { extractEntities, type EntityProfile } from "./entities.ts";
import type { Thread } from "./render.ts";

export type EvidenceKind = "question" | "observation" | "recommendation" | "result" | "configuration" | "reference";
export type EvidenceStatus = "ready" | "question-only" | "reference-only" | "needs-context";
export type EvidenceReliability = "C" | "D";

export interface EvidenceParameter {
  kind: "temperature" | "speed" | "flow" | "dimension" | "percentage" | "duration" | "version";
  value: string;
  messageId: number;
}

export interface EvidenceCandidate {
  schemaVersion: 1;
  id: string;
  threadId: string;
  rootId: number;
  topic: string;
  title: string;
  messageIds: number[];
  authors: string[];
  dateStart: string;
  dateEnd: string;
  kinds: EvidenceKind[];
  status: EvidenceStatus;
  provisionalReliability: EvidenceReliability;
  knowledgeValue: number;
  technicalScore: number;
  entities: EntityProfile;
  parameters: EvidenceParameter[];
  flags: string[];
  sourceExcerpt: string;
}

const RESULT = /(помогло|не помогло|исправил|исправила|решил|решила|в итоге|результат|после этого|стало лучше|стало хуже|получилось|не получилось|проверил|проверила|заменил|заменила|перепечатал|перепечатала|устранил|устранила)/iu;
const CONFIGURATION = /(\[(?:gcode_macro|printer|extruder|heater_|bed_mesh)[^\]]*\]|printer\.cfg|config\.cfg|\bM\d{3}\b|\bG\d{1,3}\b|\bSET_[A-Z_]+\b|\b[a-z_]+\s*:\s*[-+\d{])/mu;
const AI_CLAIM = /(chatgpt|deepseek|дипсик|gemini|claude|гугл\s*ии|нейронк|искусственн.{0,10}интеллект)/iu;

const PARAMETER_PATTERNS: Array<[EvidenceParameter["kind"], RegExp]> = [
  ["temperature", /-?\d{2,3}(?:[.,]\d+)?\s*(?:°\s*)?[cс](?![a-zа-я])/giu],
  ["flow", /\d+(?:[.,]\d+)?\s*(?:мм3\/с|мм³\/с|mm3\/s|mm³\/s|куб(?:ик(?:ов|а)?)?)/giu],
  ["speed", /\d+(?:[.,]\d+)?\s*(?:мм\/с(?:²|2)?|mm\/s(?:²|2)?)/giu],
  ["dimension", /\d+(?:[.,]\d+)?\s*(?:мм|mm)(?!\s*\/)/giu],
  ["percentage", /\d+(?:[.,]\d+)?\s*%/gu],
  ["duration", /\d+(?:[.,]\d+)?\s*(?:сек(?:унд[уы]?)?|мин(?:ут[уы]?)?|час(?:а|ов)?)/giu],
  ["version", /\b\d+\.\d+(?:\.\d+)?(?:\s*(?:beta|бета))?\b/giu],
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeEntities(thread: Thread): EntityProfile {
  const profiles = thread.messages.map((message) => extractEntities(message.text));
  const primary = unique(profiles.flatMap((profile) => profile.primaryMaterialFamilies));
  return {
    materials: unique(profiles.flatMap((profile) => profile.materials)),
    materialFamilies: unique(profiles.flatMap((profile) => profile.materialFamilies)),
    primaryMaterialFamilies: primary.length === 1 ? primary : [],
    printers: unique(profiles.flatMap((profile) => profile.printers)),
    components: unique(profiles.flatMap((profile) => profile.components)),
    brands: unique(profiles.flatMap((profile) => profile.brands)),
  };
}

function extractParameters(thread: Thread): EvidenceParameter[] {
  const result: EvidenceParameter[] = [];
  const seen = new Set<string>();
  for (const message of thread.messages) {
    for (const [kind, pattern] of PARAMETER_PATTERNS) {
      const local = new RegExp(pattern.source, pattern.flags);
      for (const match of message.text.matchAll(local)) {
        const value = match[0].trim();
        const key = `${kind}:${value.toLowerCase()}:${message.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ kind, value, messageId: message.id });
      }
    }
  }
  return result.slice(0, 40);
}

function detectKinds(thread: Thread, combined: string, parameters: EvidenceParameter[]): EvidenceKind[] {
  const kinds: EvidenceKind[] = [];
  if (thread.messages.some((message) => isQuestionLike(message.text))) kinds.push("question");
  if (thread.score >= 3 || parameters.length || combined.length >= 120) kinds.push("observation");
  if (thread.messages.some((message) => !isQuestionLike(message.text) && ACTION_ANSWER.test(message.text))) {
    kinds.push("recommendation");
  }
  if (RESULT.test(combined)) kinds.push("result");
  if (CONFIGURATION.test(combined)) kinds.push("configuration");
  if (/https?:\/\//iu.test(combined)) kinds.push("reference");
  return unique(kinds) as EvidenceKind[];
}

function statusFor(kinds: EvidenceKind[]): EvidenceStatus {
  if (kinds.includes("result") || kinds.includes("recommendation") || kinds.includes("configuration")) return "ready";
  if (kinds.includes("question") && !kinds.includes("reference")) return "question-only";
  if (kinds.includes("reference") && kinds.length <= 2) return "reference-only";
  return "needs-context";
}

function excerpt(thread: Thread): string {
  const text = thread.messages.map((message) => `[${message.id}] ${message.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return text.slice(0, 1200);
}

export function buildEvidenceCandidates(threads: Thread[], minKnowledgeValue = 0.6): EvidenceCandidate[] {
  return threads.flatMap((thread) => {
    if (thread.knowledgeValue < minKnowledgeValue) return [];
    const combined = thread.messages.map((message) => message.text).join("\n");
    const parameters = extractParameters(thread);
    const kinds = detectKinds(thread, combined, parameters);
    const status = statusFor(kinds);
    const flags: string[] = ["needs-editorial-verification"];
    if (thread.messages.length === 1) flags.push("single-message");
    if (thread.messages.some((message) => message.hasMedia)) flags.push("media-not-inspected");
    if (AI_CLAIM.test(combined)) flags.push("ai-generated-or-copied-claim");
    if (status === "question-only") flags.push("missing-answer");
    if (status === "reference-only") flags.push("external-reference-only");
    if (thread.contextEdges.length) flags.push("has-unverified-context-edges");
    const provisionalReliability: EvidenceReliability = status === "ready"
      && kinds.includes("result")
      && parameters.length > 0
      && !flags.includes("ai-generated-or-copied-claim")
      ? "C"
      : "D";
    const dates = thread.messages.map((message) => message.date).filter(Boolean);
    return [{
      schemaVersion: 1,
      id: `EVIDENCE-${thread.id.replace(/^THREAD-/, "")}`,
      threadId: thread.id,
      rootId: thread.rootId,
      topic: thread.topic,
      title: thread.title,
      messageIds: thread.messages.map((message) => message.id),
      authors: unique(thread.messages.map((message) => message.author)),
      dateStart: dates[0] ?? "",
      dateEnd: dates.at(-1) ?? dates[0] ?? "",
      kinds,
      status,
      provisionalReliability,
      knowledgeValue: thread.knowledgeValue,
      technicalScore: thread.score,
      entities: mergeEntities(thread),
      parameters,
      flags,
      sourceExcerpt: excerpt(thread),
    }];
  });
}
