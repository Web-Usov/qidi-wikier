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

export interface EvidenceSourceMessage {
  id: number;
  author: string;
  authorId: string;
  date: string;
  replyTo?: number;
  text: string;
  hasMedia: boolean;
}

export interface EvidenceCandidate {
  schemaVersion: 3;
  id: string;
  sourceName: string;
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
  sourceMessages: EvidenceSourceMessage[];
  sourceExcerpt: string;
}

interface EvidenceAnalysis {
  kinds: EvidenceKind[];
  questionMessages: NormalizedMessage[];
  answerMessages: NormalizedMessage[];
  resultMessages: NormalizedMessage[];
  recommendationMessages: NormalizedMessage[];
  configurationMessages: NormalizedMessage[];
  nonReferenceText: string;
}

// JavaScript's \b is ASCII-oriented and does not form reliable boundaries around
// Cyrillic words. All Russian outcome markers therefore use Unicode lookarounds.
const EXPLICIT_OUTCOME = /(?<![\p{L}\p{N}_])(?:не\s+помогло|помогло|исправил(?:а|ось|ась)?|устранил(?:а|ось|ась)?|решил(?:а)?\s+(?:проблему|вопрос)|заработал(?:о|а)?|перестал(?:о|а)?|пропал(?:о|а)?|исчезл(?:о|а)?|стал(?:о|а)?\s+(?:лучше|хуже|нормально|норм)|получил(?:ся|ась|ось)|не\s+получил(?:ся|ась|ось)|остал(?:ся|ась)\s+доволен|сработал(?:о|а)?|отпечатал(?:ось|ась|ся)|печатает\s+(?:нормально|норм)|держится|не\s+отлипает|отлипл(?:о|а)?)(?![\p{L}\p{N}_])/iu;
const OUTCOME_CONTEXT = /(?:после\s+этого|в\s+итоге|в\s+результате|по\s+факту).{0,180}(?:помог|исправ|устран|заработ|перестал|пропал|исчез|стал[оа]?\s+(?:лучше|хуже|норм)|получил|оказал|сработ|держ|отлип)/isu;
const UNCERTAIN_OUTCOME = /(?:если|когда|может|возможно|должно|должен|надеюсь|попробую|буду|планирую).{0,80}(?:помог|исправ|устран|заработ|перестан|пропад|исчез|получ|сработ|станет\s+(?:лучше|хуже|норм))/isu;
const MEASUREMENT_OUTCOME = /(?:измерил|измерила|замерил|замерила|перепроверил|перепроверила|проверил|проверила).{0,100}(?:по\s+факту|получил|оказал|\d)/isu;
const CONFIGURATION = /(\[(?:gcode_macro|printer|extruder|heater_|bed_mesh)[^\]]*\]|printer\.cfg|config\.cfg|\bM\d{3}\b|\bG\d{1,3}\b|\bSET_[A-Z_]+\b|\b[a-z_]+\s*:\s*[-+\d{])/mu;
const AI_CLAIM = /(chatgpt|deepseek|дипсик|gemini|claude|гугл\s*ии|нейронк|искусственн.{0,10}интеллект)/iu;
const EXTERNAL_ATTRIBUTION = /(?:ответил(?:и|а)?\s+(?:мне\s+)?(?:производител|поддержк|магазин|продавец)|ответ\s+(?:от\s+)?(?:производител|поддержк|магазин|продавц)|производитель\s+(?:пишет|говорит|ответил|рекомендует)|мне\s+(?:написали|ответили)\s+(?:из|от)|цитат[аы]|скопированн|пересланн)/iu;
const MODERATION_BOT = /^Пользователь\s+.+(?:предупрежд[её]н|ограничен|заблокирован).*(?:Причина:|Действие:)/isu;
const COMMERCE_REFERENCE = /(?:\bavito\.ru\b|\bozon(?:\.ru)?\b|wildberries|wb\.ru|aliexpress|алиэкспресс|multismol\.ru|dns-shop\.ru|\/products?\/|\/catalog\/)/iu;
const TECHNICAL_DOMAIN = /(?:3d[- ]?(?:печ|принт)|принтер|печата|печать|слайсер|orca|klipper|g-?code|макрос|прошив|калибров|шейпер|input\s*shap|pressure\s*advance|ретракт|экстру|хотэнд|термистор|сопл|стол|камера|филамент|пластик|катуш|pla|petg|abs|asa|tpu|pa\d*|нейлон|поликарбонат|pps|peek|карбон|стекловолок|адгези|усадк|сло[йя]|мост|нависан|обдув|вентилятор|(?<![\p{L}\p{N}_])(?:ремень|ремня|ремни|ремней|ремню|ремнём|ремнями|ремнях)(?![\p{L}\p{N}_])|шкив|направляющ|каретк|подшипник|резьб|шестерн|детал|модел(?:ь|и)|stl|step|компас|fusion|freecad|cad|qidi|q2|q1|plus\s*4|x-?max)/iu;
const RECOMMENDATION = /(?:попробуй|пробуйте|поставь|поставьте|используй|использовать|суши|сушить|открой|закрой|подними|снизь|опусти|выключи|включи|перенеси|проверь|проверить|замени|убери|вынь|добавь|уменьши|увеличь|настрой(?:те)?(?![а-я])|настроить|калибруй|калибровать|мажь|клей\s+нужен|лучше|нужно|надо|стоит)/iu;
const DIRECT_ANSWER = /^(?:да|нет|уже\s+нет|нельзя|можно|не\s+выйдет|не\s+получится|обязательно|не\s+обязательно|верно|точно|именно|так\s+и\s+есть)(?:\s|[,.!;:]|$)/iu;
const EXPLANATORY_ANSWER = /^(?:это|потому|значит|зависит|скорее|похоже|разница|причина)/iu;
const QUALITATIVE_ANSWER = /(?:нравится|прочн|хрупк|ж[её]стк|гибк|подойд[её]т|не\s+подойд[её]т|держит|не\s+держит|липнет|не\s+липнет|помогает|не\s+делает|лучше|хуже|нормальн|без\s+проблем)/iu;
const EVALUATION_QUESTION = /(?:как\s+(?:тебе|вам|он|она|оно)|качество|норм|подойд|годится|стоит\s+ли|пробовал|опыт|прочн|ж[её]стк|гибк|межслой)/iu;
const PARAMETER_QUESTION = /(?:настройк|параметр|температур|градус|скорост|обдув|поток|расход|размер|диаметр|длин|толщ|сколько|суш|ретракт|ток|процент|шаг|зазор|коэффициент|формул)/iu;
const ENTITY_QUESTION = /(?:кто|какой|какая|какие|что|чем|производител|бренд|фирм|материал|пластик|сопло|принтер|клей|адгезив|прошив|слайсер|модель|филамент)/iu;
const POINTER_ONLY = /^(?:в\s+лс|выше|ниже|в\s+(?:этой\s+)?теме|в\s+закрепе|в\s+(?:вики|wiki)|в\s+статьях|по\s+ссылке|гугли|ищи|уже\s+есть\s+готовые\s+решения)[.!… ]*$/iu;
const PHOTO_REQUEST = /(?:есть|можно|покаж|скинь|пришли|отправ).{0,30}(?:фото|фотк|изображ|скрин|вид)/iu;
const NON_ANSWER = /^(?:спасибо|благодарю|понял|поняла|ясно|ок(?:ей)?|ага|угу|круто|класс|согласен|согласна|жд[её]м|сорри|не\s+знаю|хз|ноу)[!.,… )\p{Extended_Pictographic}]*$/iu;
const SETTING_TUPLE = /^\s*\d{1,3}(?:[.,]\d+)?(?:\s*[/\\,]\s*\d{1,3}(?:[.,]\d+)?){1,4}\s*$/u;
const HARDNESS_ANSWER = /^\s*(?:shore\s*)?\d{2,3}\s*[adд]\s*$/iu;
const REPEATED_TEST = /(?:на\s+(?:двух|тр[её]х|четыр[её]х|пяти|\d+)\s+(?:детал|тест|печат)|несколько\s+раз|повторил|повторила|дважды|трижды)/iu;
const REQUEST_WITHOUT_QUESTION_MARK = /(?:^|[.!;:]\s+|(?:ребят[аы]?|народ|коллеги|господа|парни|мужики)[,!:;\s—-]+)(?:а\s+)?(?:можете|можешь)\s+(?:сказать|подсказать)|(?:^|[.!;:]\s+)(?:господа[,!:;\s—-]*)?(?:дайте|скиньте|пришлите)|(?:какие|какую|какой)\s+(?:параметр|настройк|температур|скорост|обдув|расход|профил)|(?:нужны?|нужна)\s+(?:настройк|помощь|совет)|(?:а\s+почему|а\s+как|а\s+что)\s+|(?:пытаюсь|хочу|нужно)\s+(?:разобраться|понять|узнать)[^.!?]{0,100}(?:какой|какая|какие|что|как)/iu;
const SHORT_NOMINAL_QUESTION = /(?:кто|какой|какая|какие|производител|бренд|фирм|материал|пластик|сопло|клей|адгезив|чем\s+печат|что\s+взять)/iu;

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

function uniqueMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const seen = new Set<number>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
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
  return cleaned.length > 0 && (isQuestionLike(cleaned) || REQUEST_WITHOUT_QUESTION_MARK.test(cleaned));
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
  if (!text || evidenceQuestionLike(text) || UNCERTAIN_OUTCOME.test(text)) return false;
  return EXPLICIT_OUTCOME.test(text) || OUTCOME_CONTEXT.test(text) || MEASUREMENT_OUTCOME.test(text);
}

function isRecommendationMessage(message: NormalizedMessage): boolean {
  const text = stripReferences(message.text);
  return text.length > 0 && !evidenceQuestionLike(text) && RECOMMENDATION.test(text);
}

function isConfigurationMessage(message: NormalizedMessage): boolean {
  return CONFIGURATION.test(message.text);
}

function isShortNominalAnswer(text: string, questionText: string): boolean {
  if (!SHORT_NOMINAL_QUESTION.test(questionText) || POINTER_ONLY.test(text)) return false;
  if (text.length < 2 || text.length > 60) return false;
  const words = text.match(/[\p{L}\p{N}+#.-]+/gu) ?? [];
  return words.length >= 1 && words.length <= 5 && words.join("").length >= 3;
}

function isSubstantiveAnswer(message: NormalizedMessage, questionText: string): boolean {
  const text = stripReferences(message.text);
  if (!text || evidenceQuestionLike(text) || NON_ANSWER.test(text) || POINTER_ONLY.test(text)) return false;
  if (PHOTO_REQUEST.test(questionText) && !/(?:https?:\/\/|\[Вложение:)/iu.test(message.text)) return false;
  if (isResultMessage(message) || isRecommendationMessage(message) || isConfigurationMessage(message)) return true;
  if (DIRECT_ANSWER.test(text) || HARDNESS_ANSWER.test(text)) return true;
  if (SETTING_TUPLE.test(text) && PARAMETER_QUESTION.test(questionText)) return true;

  const parameters = extractMessageParameters(message);
  const entities = extractEntities(text);
  if (parameters.length > 0 && PARAMETER_QUESTION.test(questionText)) return true;
  if (hasEntities(entities) && ENTITY_QUESTION.test(questionText)) return true;
  if (QUALITATIVE_ANSWER.test(text) && EVALUATION_QUESTION.test(questionText) && text.length >= 5) return true;
  if (technicalScore(message) >= 3 && text.length >= 20 && TECHNICAL_DOMAIN.test(text)) return true;
  if (EXPLANATORY_ANSWER.test(text) && text.length >= 8) return true;
  if (/\d{2,3}/u.test(text) && /(температур|градус|до\s+скольки|суш)/iu.test(questionText)) return true;
  return isShortNominalAnswer(text, questionText);
}

function analyzeThread(thread: Thread, parameters: EvidenceParameter[]): EvidenceAnalysis {
  const questionMessages = thread.messages.filter((message) => evidenceQuestionLike(message.text));
  const answerMessages: NormalizedMessage[] = [];
  let latestQuestion: NormalizedMessage | undefined;
  for (const message of thread.messages) {
    if (evidenceQuestionLike(message.text)) {
      latestQuestion = message;
      continue;
    }
    if (latestQuestion && message.id !== latestQuestion.id && isSubstantiveAnswer(message, stripReferences(latestQuestion.text))) {
      answerMessages.push(message);
    }
  }

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
    questionMessages,
    answerMessages: uniqueMessages(answerMessages),
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
  const technicalAnchor = thread.topic !== "general"
    || hasEntities(entities)
    || analysis.kinds.includes("configuration")
    || TECHNICAL_DOMAIN.test(combined);
  if (!technicalAnchor) return false;

  const structured = hasEntities(entities)
    || parameters.length > 0
    || analysis.kinds.includes("configuration")
    || analysis.kinds.includes("reference");
  const detailedOutcome = analysis.kinds.includes("result") && analysis.nonReferenceText.length >= 55;
  const mediaFirst = thread.messages[0]?.hasMedia && stripReferences(thread.messages[0].text).length === 0;
  if (mediaFirst && !structured && analysis.nonReferenceText.length < 100) return false;
  if (thread.messages.length === 1 && analysis.nonReferenceText.length < 60 && !structured && !detailedOutcome) return false;
  if (thread.score <= 4 && analysis.nonReferenceText.length < 70 && !structured && !detailedOutcome) return false;
  if (analysis.kinds.length === 1 && analysis.kinds[0] === "observation" && analysis.nonReferenceText.length < 80 && !structured) return false;
  return true;
}

function reliabilityFor(
  thread: Thread,
  status: EvidenceStatus,
  analysis: EvidenceAnalysis,
  flags: string[],
): EvidenceReliability {
  const root = thread.messages[0];
  if (!root) return "D";

  const qualifyingResult = analysis.resultMessages.find((message) => {
    if (message.id === root.id || message.authorId !== root.authorId) return false;
    const text = stripReferences(message.text);
    const resultParameters = extractMessageParameters(message);
    const explicitOutcome = EXPLICIT_OUTCOME.test(text) || OUTCOME_CONTEXT.test(text);
      const detailed = REPEATED_TEST.test(text)
        || OUTCOME_CONTEXT.test(text)
        || text.length >= 90;
      return text.length >= 35 && resultParameters.length > 0 && explicitOutcome && detailed;
  });
  if (!qualifyingResult) return "D";

  const evidenceEntities = extractEntities(`${root.text}\n${qualifyingResult.text}`);
  const eligible = status === "ready"
    && analysis.kinds.includes("result")
    && hasEntities(evidenceEntities)
    && !flags.includes("ai-generated-or-copied-claim")
    && !flags.includes("external-attributed-claim")
    && !flags.includes("media-not-inspected");
  return eligible ? "C" : "D";
}

function excerpt(thread: Thread): string {
  const text = thread.messages.map((message) => `[${message.id}] ${message.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return text.slice(0, 1200);
}

function candidateTitle(thread: Thread): string {
  const preferred = thread.messages.find((message) => {
    const text = stripReferences(message.text);
    return text.length >= 20 && (evidenceQuestionLike(text) || technicalScore(message) >= 3 || hasEntities(extractEntities(text)));
  });
  const fallback = thread.messages.find((message) => stripReferences(message.text).length >= 20);
  return stripReferences(preferred?.text ?? fallback?.text ?? thread.title ?? "Без названия").slice(0, 110) || "Без названия";
}

export function buildEvidenceCandidates(threads: Thread[], minKnowledgeValue = 0.6, sourceName = "unknown"): EvidenceCandidate[] {
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
    if (EXTERNAL_ATTRIBUTION.test(combined)) flags.push("external-attributed-claim");
    if (COMMERCE_REFERENCE.test(combined)) flags.push("commerce-reference");
    if (status === "question-only") flags.push("missing-answer");
    if (status === "reference-only") flags.push("external-reference-only");
    if (status === "needs-context") flags.push("insufficient-context");
    if (analysis.answerMessages.length && !analysis.kinds.includes("result")) flags.push("answer-not-validated");
    if (thread.contextEdges.length) flags.push("has-unverified-context-edges");
    const provisionalReliability = reliabilityFor(thread, status, analysis, flags);
    const dates = thread.messages.map((message) => message.date).filter(Boolean);
    return [{
      schemaVersion: 3 as const,
      id: `EVIDENCE-${thread.id.replace(/^THREAD-/, "")}`,
      sourceName,
      threadId: thread.id,
      rootId: thread.rootId,
      topic: thread.topic,
      title: candidateTitle(thread),
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
          sourceMessages: thread.messages.map((message) => ({
            id: message.id,
            author: message.author,
            authorId: message.authorId,
            date: message.date,
            ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
            text: message.text,
            hasMedia: message.hasMedia,
          })),
          sourceExcerpt: excerpt(thread),
        }];
  });
}
