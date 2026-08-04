import { extractEntities } from "./entities.ts";
import type { NormalizedMessage } from "./telegram.ts";

const ACKNOWLEDGEMENT = /^(спасибо|благодарю|понял|ясно|ок(?:ей)?|ага|угу|да|нет|точно|согласен|круто|класс|норм|плюсую|жд[её]м|доброе утро|добрый вечер|привет)[!.,… )]*(?:\p{Extended_Pictographic})*$/iu;
const ONLY_NOISE = /^[\s\p{P}\p{S}\p{Extended_Pictographic}]+$/u;
const MARKET = /(продам|куплю|обменяю|барахолк|доставка|авито|озон|wildberries|(?:^|\s)вб(?:\s|$)|скидк|промокод)/iu;
const TECHNICAL = /(qidi|ку2|q2|q1|plus\s*4|принтер|печать|сло[йя]|сопл|экстру|филамент|пластик|pla|petg|abs|asa|tpu|pa\d*|нейлон|карбон|стекловолок|gf\d*|cf\d*|температур|стол|камер|вентилятор|обдув|ретракт|pressure\s*advance|input\s*shap|рем[её]н|шкив|воблинг|резонанс|калибров|прошив|klipper|orca|g-?code|ошибк|qde\d+|box|бокс|сушк|катушк|ptfe|хотэнд|термистор|нагрев|адгези|усадк|мост|нависан|подач|пробк|засор|mesh|z[- ]?offset)/iu;

export const QUESTION = /\?|^(?:кто|как|почему|зачем|что|где|куда|какой|какая|какие|можно ли|есть ли|подскажите|подскажите пожалуйста)(?:\s|$)/iu;
const QUESTION_PHRASE = /^(?:(?:всем привет|привет|добрый день|добрый вечер|доброго дня|доброго вечера|ребят[аы]?|парни|коллеги|народ|гуру|мужики)[!,.?:;\s—-]*)?(?:кто(?:-нибудь)?|как|почему|зачем|что|где|куда|какой|какая|какие|можно ли|есть ли|подскажите(?: пожалуйста)?|кто знает|может кто|нужен совет|нужна помощь|куда копать|что делать|есть идеи)(?:\s|$)/iu;
export const STRONG_CONTINUATION = /^(?:проверил|проверила|заменил|заменила|настроил|настроила|поднял|подняла|опустил|опустила|сделал как|сделала как|после этого|в итоге|результат|помогло|не помогло|исправил|исправила|перепечатал|перепечатала)(?:\s|[:,.!-]|$)/iu;
export const WEAK_CONTINUATION = /^(?:а|и|но|да|нет|я|он|она|они|это|там|тут|ещ[её])(?:\s|[,.:;!?-]|$)/iu;
export const TOPIC_SHIFT = /^(?:кстати|к слову|другая тема|оффтоп)(?:\s|[,.:;!?-]|$)/iu;
export const ACTION_ANSWER = /(попробуй|поставь|использ|мажу|печатаю|печатал|делал|делала|суши|сушить|открой|закрой|подними|снизь|выключи|включи|перенес|проверь|проверить|нужно|надо|лучше|можно|стоит|помогло|не помогло|держит|прилип|отлип)/iu;
export const DEFINITION_QUESTION = /(что такое|что значит|означает|получается|это\s+[^?]{1,60}\?)/iu;

const STOP_WORDS = new Set([
  "без", "был", "была", "были", "быть", "вам", "вас", "вот", "все", "всё", "где", "для", "его", "если", "есть", "ещё", "или", "как", "когда", "который", "меня", "мне", "можно", "мой", "надо", "нет", "они", "она", "оно", "под", "при", "просто", "про", "раз", "так", "там", "тебя", "тоже", "только", "тут", "уже", "хочу", "что", "это", "этот", "эта", "эти", "очень", "сейчас", "потом", "после", "перед", "через", "пока", "кто", "куда", "какой", "какая", "какие", "почему", "зачем", "будет", "может", "нужно", "нужен", "нужна", "себя", "свой", "свои", "такой", "такая", "такие", "того", "тому", "тогда", "чем", "чего", "чтобы", "либо", "лишь", "даже", "ведь", "have", "with", "from", "this", "that", "what", "when", "where", "which", "then", "than", "into", "your", "you", "for", "the", "and", "but", "not",
  "qidi", "q2", "q1", "box", "abs", "asa", "pla", "petg", "tpu", "pa6", "pa12", "pc", "pps", "cf", "gf",
  "принтер", "печать", "пластик", "филамент", "катушка", "температура", "проблема", "вопрос", "подскажите",
]);
const SHORT_TECH_TOKENS = new Set(["pid", "mcu", "cfg", "kamp", "rfid", "ptfe"]);

const TOPICS: Array<[string, RegExp]> = [
  ["qidi-box", /(qidi\s*box|qidi-box|gd[- ]?box|бокс|ams|rfid|смотк|бесконечн.{0,8}катуш|ptfe.{0,20}box)/iu],
  ["firmware-errors", /(прошив|firmware|klipper|qde\d+|ошибк|конфиг|printer\.cfg|макрос|g-?code)/iu],
  ["calibration", /(input\s*shap|pressure\s*advance|калибров|резонанс|акселерометр|mesh|z[- ]?offset|flow\s*rate|pa[- ]?tower)/iu],
  ["print-defects", /(воблинг|полос|эхо|ряб|сдвиг.{0,10}сло|деламинац|рассло|сопл|пробк|засор|мост|нависан|угол|дефект|артефакт|волос|stringing)/iu],
  ["mechanics", /(рем[её]н|шкив|направляющ|каретк|подшипник|винт|балк|рама|люфт|натяж)/iu],
  ["filaments", /(filament|филамент|пластик|pla|petg|abs|asa|tpu|pa\d*|нейлон|pc|pps|peek|pvdf|gf\d*|cf\d*|карбон|стекловолок|сушк|гигроскоп)/iu],
  ["hardware", /(плата|mcu|stm32|gd32|вентилятор|камера|датчик|термистор|нагреватель|хотэнд|экструдер|сопло|электрон)/iu],
];

export function detectTopics(text: string): string[] {
  return TOPICS.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}
export function classifyTopic(text: string): string {
  return detectTopics(text)[0] ?? "general";
}

export function isQuestionLike(text: string): boolean {
  const head = text.trim().slice(0, 600);
  return QUESTION.test(head) || QUESTION_PHRASE.test(head);
}

function normalizedComparableText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\[вложение:[^\]]+\]/giu, " ")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNearDuplicateText(a: string, b: string): boolean {
  const left = normalizedComparableText(a);
  const right = normalizedComparableText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 3));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length >= 3));
  if (leftTokens.size < 6 || rightTokens.size < 6) return false;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  const containment = shared / Math.min(leftTokens.size, rightTokens.size);
  const jaccard = shared / (leftTokens.size + rightTokens.size - shared);
  return containment >= 0.82 && jaccard >= 0.42;
}

export function technicalScore(message: NormalizedMessage): number {
  let score = 0;
  const text = message.text;
  if (TECHNICAL.test(text)) score += 3;
  if (/\d{2,3}\s*°?c/iu.test(text)) score += 2;
  if (/\d+(?:[.,]\d+)?\s*(?:мм|mm|мм\/с|mm\/s|мм\/с²|hz|гц|час|мин|%)/iu.test(text)) score += 1;
  if (/https?:\/\//iu.test(text)) score += 1;
  if (/(помогло|решил[оа]?|не помогло|причина|исправил|заменил|проверил|результат|настройк|параметр)/iu.test(text)) score += 2;
  if (text.length >= 160) score += 1;
  if (message.reactionCount >= 3) score += 1;
  if (message.replyTo) score += 1;
  return score;
}

export function knowledgeValue(message: NormalizedMessage): number {
  if (isMediaOnly(message)) return 0;
  let value = 0;
  const score = technicalScore(message);
  if (score >= 3) value += 0.35;
  else if (score > 0) value += 0.15;
  if (/\d{2,3}\s*°?c|\d+(?:[.,]\d+)?\s*(?:мм|mm|мм\/с|mm\/s|hz|гц|%)/iu.test(message.text)) value += 0.15;
  if (/(помогло|не помогло|решил|причина|исправил|заменил|проверил|результат|настройк|параметр|попробуй|поставь|подними|опусти|перенес|проверь|проверить)/iu.test(message.text)) value += 0.25;
  if (isQuestionLike(message.text)) value += 0.08;
  if (message.text.length >= 80) value += 0.1;
  const entities = extractEntities(message.text);
  if (entities.materials.length || entities.printers.length || entities.components.length || entities.brands.length) value += 0.12;
  return Number(Math.min(1, value).toFixed(2));
}

export function isMediaOnly(message: NormalizedMessage): boolean {
  return message.hasMedia && /^\[Вложение:[^\]]+\]$/u.test(message.text.trim());
}

export function removalReason(message: NormalizedMessage): string | null {
  if (message.type !== "message") return "service-message";
  if (!message.text) return message.hasMedia ? "media-without-caption" : "empty";
  if (ONLY_NOISE.test(message.text)) return "emoji-or-punctuation-only";
  if (ACKNOWLEDGEMENT.test(message.text)) return "short-acknowledgement";
  if (MARKET.test(message.text)) return "marketplace-or-sale";
  if (message.text.length < 8 && !message.replyTo) return "too-short-without-context";
  return null;
}

function keywordStem(token: string): string {
  if (!/[а-я]/u.test(token) || token.length < 6) return token;
  const stemmed = token.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ется|ются|лась|лся|ать|ять|ить|ов|ев|ам|ям|ах|ях|ом|ем|ый|ий|ая|ое|ые|ую|юю|а|я|ы|и|е|у|ю)$/u, "");
  return stemmed.length >= 4 ? stemmed : token;
}

export function extractKeywords(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/ё/g, "е").replace(/https?:\/\/\S+/giu, " ");
  const rawTokens = normalized.match(/[a-zа-я0-9][a-zа-я0-9+._-]*/giu) ?? [];
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    const clean = token.replace(/^[._+-]+|[._+-]+$/g, "");
    if (!clean || STOP_WORDS.has(clean)) continue;
    const stem = keywordStem(clean);
    if (!stem || STOP_WORDS.has(stem)) continue;
    if (stem.length >= 4 || SHORT_TECH_TOKENS.has(stem) || /\d/.test(stem)) tokens.add(stem);
  }
  return tokens;
}

export function sharedKeywordCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}
