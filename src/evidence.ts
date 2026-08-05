import { isQuestionLike, technicalScore } from "./classify.ts";
import { extractEntities, type EntityProfile } from "./entities.ts";
import type { Thread } from "./render.ts";
import type { NormalizedMessage } from "./telegram.ts";

export type EvidenceKind = "question" | "observation" | "answer" | "recommendation" | "result" | "configuration" | "reference";
export type EvidenceStatus = "ready" | "question-only" | "reference-only" | "needs-context";
export type EvidenceReliability = "C" | "D";

export interface EvidenceParameter {
  kind: "temperature" | "speed" | "flow" | "dimension" | "percentage" | "duration" | "version";
  value: string;
  messageId: number;
}

export interface EvidenceCandidate {
  schemaVersion: 2;
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

interface EvidenceAnalysis {
  kinds: EvidenceKind[];
  answerMessages: NormalizedMessage[];
  resultMessages: NormalizedMessage[];
  recommendationMessages: NormalizedMessage[];
  configurationMessages: NormalizedMessage[];
  nonReferenceText: string;
}

const EXPLICIT_OUTCOME = /(?:\bпомогло\b|\bне\s+помогло\b|\bисправил(?:а|ось)?\b|\bустранил(?:а|ось)?\b|\bрешил(?:а)?\s+(?:проблему|вопрос)\b|\bзаработал(?:о|а)?\b|\bперестал(?:о|а)?\b|\bпропал(?:о|а)?\b|\bисчезл(?:о|а)?\b|\bстал(?:о|а)?\s+(?:лучше|хуже|нормально|норм)\b|\bполучил(?:ся|ась|ось)?\b|\bне\s+получил(?:ся|ась|ось)?\b|\bостал(?:ся|ась)\s+доволен)/iu;
const OUTCOME_CONTEXT = /(?:после\s+этого|в\s+итоге|в\s+результате|по\s+факту).{0,180}(?:помог|исправ|устран|заработ|перестал|пропал|исчез|стал[оа]?\s+(?:лучше|хуже|норм)|получил|доволен|\d)/isu;
const CONDITIONAL_OUTCOME = /(?:если|когда|может|должно|должен|проверь).{0,45}(?:не\s+)?помогло/isu;
const MEASUREMENT_OUTCOME = /(?:измерил|измерила|замерил|замерила|перепроверил|перепроверила|проверил|проверила).{0,100}(?:по\s+факту|получил|оказал|\d)/isu;
const CONFIGURATION = /(\[(?:gcode_macro|printer|extruder|heater_|bed_mesh)[^\]]*\]|printer\.cfg|config\.cfg|\bM\d{3}\b|\bG\d{1,3}\b|\bSET_[A-Z_]+\b|\b[a-z_]+\s*:\s*[-+\d{])/mu;
const AI_CLAIM = /(chatgpt|deepseek|дипсик|gemini|claude|гугл\s*ии|нейронк|искусственн.{0,10}интеллект)/iu;
const MODERATION_BOT = /^Пользователь\s+.+(?:предупрежд[её]н|ограничен|заблокирован).*(?:Причина:|Действие:)/isu;
const COMMERCE_REFERENCE = /(?:\bavito\.ru\b|\bozon(?:\.ru)?\b|wildberries|wb\.ru|aliexpress|алиэкспресс|multismol\.ru|\/products?\/|\/catalog\/)/iu;
const RECOMMENDATION = /(?:попробуй|поставь|используй|использовать|суши|сушить|открой|закрой|подними|снизь|опусти|выключи|включи|перенеси|проверь|проверить|замени|убери|вынь|добавь|уменьши|увеличь|настрой(?:те)?(?![а-я])|настроить|калибруй|калибровать|лучше|нужно|надо|стоит)/iu;
const DIRECT_ANSWER = /^(?:да|нет|уже\s+нет|нельзя|можно|не\s+выйдет|не\s+получится|обязательно|не\s+обязательно|верно|точно|именно|так\s+и\s+есть)(?:\s|[,.!;:]|$)/iu;
const EXPLANATORY_ANSWER = /^(?:это|потому|значит|зависит|скорее|похоже|разница|причина|процент|угол|перекрытие|заходишь|выбираешь|ставишь|смотри|фильтр|скорость|температура|сопло|стол|камера|поток|ретракт|кабель|питание|питалово|выключить|включить)/iu;
const SETTING_TUPLE = /^\s*\d{1,3}(?:[.,]\d+)?(?:\s*[/\\]\s*\d{1,3}(?:[.,]\d+)?){1,4}\s*$/u;
const HARDNESS_ANSWER = /^\s*\d{2,3}\s*[ad]\s*$/iu;
const REPEATED_TEST = /(?:на\s+(?:двух|тр[её]х|четыр[её]х|пяти|\d+)\s+(?:детал|тест|печат)|несколько\s+раз|повторил|повторила|дважды|трижды)/iu;

const PARAMETER_PATTERNS: Array<[EvidenceParameter["kind"], RegExp]> = [
  ["temperature", /-?\d{2,3}(?:[.,]\d+)?\s*(?:°\s*)?[cс](?![a-zа-я])/giu],
  ["flow", /\d+(?:[.,]\d+)?\s*(?:мм3\/с|мм³\/с|mm3\/s|mm³\/s|куб(?:ик(?:ов|а)?)?)/giu],
  ["speed", /\d+(?:[.,]\d+)?\s*(?:мм|mm)\s*(?:\/\s*|\\\s*|\s*)(?:с|сек)(?:\s*[²2])?/giu],
  ["dimension", /\d+(?:[.,]\d+)?\s*(?:мм|mm)(?!\s*(?:\/|\\|с(?:ек)?\b))/giu],
  ["percentage", /\d+(?:[.,]\d+)?\s*%/gu],
  ["duration", /\d+(?:[.,]\d+)?\s*(?:сек(?:унд[уы]?)?|мин(?:ут[уы]?)?|час(?:а|ов)?)/giu],
  ["version", /\bv?\d+\.\d+\.\d+(?:[-\s]?(?:beta|бета)\d*)?\b/giu],
];

const CONTEXTUAL_TEMPERATURE = /(?:сопл[оаеуы]?|хот(?:энд|енд)?|стол(?:е|а|ом)?|камер[аеуы]?|термокамер[аеуы]?)\s*(?:до|на|=|:)?\s*([+-]?\d{2,3})(?![\d.,])/giu;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stripReferences(text: string): string {
  return text
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\[Вложение:[^\]]+\]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceQuestionLike(text: string): boolean {
  const cleaned = stripReferences(text);
  return cleaned.length > 0 && isQuestionLike(cleaned);
}

function hasEntities(profile: EntityProfile): boolean {
  return profile.materials.length > 0
    || profile.printers.length > 0
    || profile.components.length > 0
    || profile.brands.length > 0;
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

function pushParameter(
  result: EvidenceParameter[],
  seen: Set<string>,
  kind: EvidenceParameter["kind"],
  value: string,
  messageId: number,
): void {
  const numbers = value.match(/[+-]?\d+(?:[.,]\d+)?/gu)?.join(":") ?? value.toLowerCase();
  const key = `${kind}:${numbers}:${messageId}`;
  if (seen.has(key)) return;
  seen.add(key);
  result.push({ kind, value: value.trim(), messageId });
}

function extractMessageParameters(message: NormalizedMessage): EvidenceParameter[] {
  const result: EvidenceParameter[] = [];
  const seen = new Set<string>();
  const text = message.text.replace(/https?:\/\/\S+/giu, " ");
  for (const [kind, pattern] of PARAMETER_PATTERNS) {
    const local = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(local)) pushParameter(result, seen, kind, match[0], message.id);
  }
  const contextual = new RegExp(CONTEXTUAL_TEMPERATURE.source, CONTEXTUAL_TEMPERATURE.flags);
  for (const match of text.matchAll(contextual)) pushParameter(result, seen, "temperature", match[0], message.id);
  return result;
}

function extractParameters(thread: Thread): EvidenceParameter[] {
  return thread.messages.flatMap(extractMessageParameters).slice(0, 40);
}

function isResultMessage(message: NormalizedMessage): boolean {
  const text = stripReferences(message.text);
  if (!text || CONDITIONAL_OUTCOME.test(text)) return false;
  return EXPLICIT_OUTCOME.test(text) || OUTCOME_CONTEXT.test(text) || MEASUREMENT_OUTCOME.test(text);
}

function isRecommendationMessage(message: NormalizedMessage): boolean {
  const text = stripReferences(message.text);
  return text.length > 0 && !evidenceQuestionLike(text) && RECOMMENDATION.test(text);
}

function isConfigurationMessage(message: NormalizedMessage): boolean {
  return CONFIGURATION.test(message.text);
}

function isSubstantiveAnswer(message: NormalizedMessage, rootText: string): boolean {
  const text = stripReferences(message.text);
  if (!text || evidenceQuestionLike(text)) return false;
  if (isResultMessage(message) || isRecommendationMessage(message) || isConfigurationMessage(message)) return true;
  if (DIRECT_ANSWER.test(text) || SETTING_TUPLE.test(text) || HARDNESS_ANSWER.test(text)) return true;

  const parameters = extractMessageParameters(message);
  const entities = extractEntities(text);
  if (parameters.length > 0 || hasEntities(entities)) return true;
  if (technicalScore(message) >= 3 && text.length >= 12) return true;
  if (EXPLANATORY_ANSWER.test(text) && text.length >= 10) return true;
  if (/\d{2,3}/u.test(text) && /(температур|градус|до\s+скольки|суш)/iu.test(rootText)) return true;
  return false;
}

function analyzeThread(thread: Thread, parameters: EvidenceParameter[]): EvidenceAnalysis {
  const root = thread.messages[0];
  const rootText = stripReferences(root?.text ?? "");
  const questionMessages = thread.messages.filter((message) => evidenceQuestionLike(message.text));
  const responseMessages = thread.messages.slice(1);
  const answerMessages = root && evidenceQuestionLike(root.text)
    ? responseMessages.filter((message) => isSubstantiveAnswer(message, rootText))
    : [];
  const resultMessages = thread.messages.filter(isResultMessage);
  const recommendationMessages = thread.messages.filter(isRecommendationMessage);
  const configurationMessages = thread.messages.filter(isConfigurationMessage);
  const hasReference = thread.messages.some((message) => /https?:\/\//iu.test(message.text));
  const nonReferenceText = stripReferences(thread.messages.map((message) => message.text).join("\n"));
  const kinds: EvidenceKind[] = [];
  if (questionMessages.length) kinds.push("question");
  if (thread.score >= 3 || parameters.length || nonReferenceText.length >= 120) kinds.push("observation");
  if (answerMessages.length) kinds.push("answer");
  if (recommendationMessages.length) kinds.push("recommendation");
  if (resultMessages.length) kinds.push("result");
  if (configurationMessages.length) kinds.push("configuration");
  if (hasReference) kinds.push("reference");
  return {
    kinds: unique(kinds) as EvidenceKind[],
    answerMessages,
    resultMessages,
    recommendationMessages,
    configurationMessages,
    nonReferenceText,
  };
}

function statusFor(analysis: EvidenceAnalysis): EvidenceStatus {
  const kinds = analysis.kinds;
  const actionable = kinds.includes("answer")
    || kinds.includes("recommendation")
    || kinds.includes("result")
    || kinds.includes("configuration");
  if (actionable) return "ready";
  if (kinds.includes("reference") && analysis.nonReferenceText.length < 160) return "reference-only";
  if (kinds.includes("question")) return "question-only";
  return "needs-context";
}

function isMeaningfulCandidate(
  thread: Thread,
  analysis: EvidenceAnalysis,
  entities: EntityProfile,
  parameters: EvidenceParameter[],
): boolean {
  const combined = thread.messages.map((message) => message.text).join("\n");
  if (MODERATION_BOT.test(combined)) return false;
  const structured = hasEntities(entities)
    || parameters.length > 0
    || analysis.kinds.includes("configuration")
    || analysis.kinds.includes("reference");
  const detailedOutcome = analysis.kinds.includes("result") && analysis.nonReferenceText.length >= 55;
  if (thread.messages.length === 1 && analysis.nonReferenceText.length < 60 && !structured && !detailedOutcome) return false;
  if (thread.score <= 4 && analysis.nonReferenceText.length < 70 && !structured && !detailedOutcome) return false;
  if (analysis.kinds.length === 1 && analysis.kinds[0] === "observation" && analysis.nonReferenceText.length < 80 && !structured) return false;
  return true;
}

function reliabilityFor(
  thread: Thread,
  status: EvidenceStatus,
  analysis: EvidenceAnalysis,
  entities: EntityProfile,
  parameters: EvidenceParameter[],
  flags: string[],
): EvidenceReliability {
  const root = thread.messages[0];
  const ownFollowUpResult = root && analysis.resultMessages.some((message) => (
    message.id !== root.id
    && message.authorId === root.authorId
    && stripReferences(message.text).length >= 35
  ));
  const repeatedOrDetailed = analysis.resultMessages.some((message) => (
    REPEATED_TEST.test(message.text) || stripReferences(message.text).length >= 70
  ));
  const eligible = status === "ready"
    && analysis.kinds.includes("result")
    && ownFollowUpResult
    && repeatedOrDetailed
    && parameters.length > 0
    && hasEntities(entities)
    && !flags.includes("ai-generated-or-copied-claim")
    && !flags.includes("media-not-inspected");
  return eligible ? "C" : "D";
}

function excerpt(thread: Thread): string {
  const text = thread.messages.map((message) => `[${message.id}] ${message.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return text.slice(0, 1200);
}

export function buildEvidenceCandidates(threads: Thread[], minKnowledgeValue = 0.6): EvidenceCandidate[] {
  return threads.flatMap((thread) => {
    if (thread.knowledgeValue < minKnowledgeValue) return [];
    const parameters = extractParameters(thread);
    const entities = mergeEntities(thread);
    const analysis = analyzeThread(thread, parameters);
    if (!isMeaningfulCandidate(thread, analysis, entities, parameters)) return [];
    const status = statusFor(analysis);
    const combined = thread.messages.map((message) => message.text).join("\n");
    const flags: string[] = ["needs-editorial-verification"];
    if (thread.messages.length === 1) flags.push("single-message");
    if (thread.messages.some((message) => message.hasMedia)) flags.push("media-not-inspected");
    if (AI_CLAIM.test(combined)) flags.push("ai-generated-or-copied-claim");
    if (COMMERCE_REFERENCE.test(combined)) flags.push("commerce-reference");
    if (status === "question-only") flags.push("missing-answer");
    if (status === "reference-only") flags.push("external-reference-only");
    if (status === "needs-context") flags.push("insufficient-context");
    if (analysis.answerMessages.length && !analysis.kinds.includes("result")) flags.push("answer-not-validated");
    if (thread.contextEdges.length) flags.push("has-unverified-context-edges");
    const provisionalReliability = reliabilityFor(thread, status, analysis, entities, parameters, flags);
    const dates = thread.messages.map((message) => message.date).filter(Boolean);
    return [{
      schemaVersion: 2 as const,
      id: `EVIDENCE-${thread.id.replace(/^THREAD-/, "")}`,
      threadId: thread.id,
      rootId: thread.rootId,
      topic: thread.topic,
      title: thread.title,
      messageIds: thread.messages.map((message) => message.id),
      authors: unique(thread.messages.map((message) => message.author)),
      dateStart: dates[0] ?? "",
      dateEnd: dates.at(-1) ?? dates[0] ?? "",
      kinds: analysis.kinds,
      status,
      provisionalReliability,
      knowledgeValue: thread.knowledgeValue,
      technicalScore: thread.score,
      entities,
      parameters,
      flags,
      sourceExcerpt: excerpt(thread),
    }];
  });
}
