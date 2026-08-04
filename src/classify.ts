import type { NormalizedMessage } from "./telegram.ts";

const ACKNOWLEDGEMENT = /^(спасибо|благодарю|понял|ясно|ок(?:ей)?|ага|угу|да|нет|точно|согласен|круто|класс|норм|плюсую|жд[её]м|доброе утро|добрый вечер|привет)[!.,… )]*(?:\p{Extended_Pictographic})*$/iu;
const ONLY_NOISE = /^[\s\p{P}\p{S}\p{Extended_Pictographic}]+$/u;
const MARKET = /(продам|куплю|обменяю|барахолк|доставка|авито|озон|wildberries|(?:^|\s)вб(?:\s|$)|скидк|промокод)/iu;
const TECHNICAL = /(qidi|ку2|q2|q1|plus\s*4|принтер|печать|сло[йя]|сопл|экстру|филамент|пластик|pla|petg|abs|asa|tpu|pa\d*|нейлон|карбон|стекловолок|gf\d*|cf\d*|температур|стол|камер|вентилятор|обдув|ретракт|pressure\s*advance|input\s*shap|рем[её]н|шкив|воблинг|резонанс|калибров|прошив|klipper|orca|g-?code|ошибк|qde\d+|box|бокс|сушк|катушк|ptfe|хотэнд|термистор|нагрев|адгези|усадк|мост|нависан|подач|пробк|засор|mesh|z[- ]?offset)/iu;

export const QUESTION = /\?|^(?:кто|как|почему|зачем|что|где|куда|какой|какая|какие|можно ли|есть ли|подскажите|подскажите пожалуйста)(?:\s|$)/iu;
export const CONTINUATION = /^(?:а\s|и\s|но\s|да[,\s]|нет[,\s]|у меня(?:\s|$)|тоже(?:\s|$)|это(?:\s|$)|там(?:\s|$)|тут(?:\s|$)|если(?:\s|$)|попробуй(?:\s|$)|скорее(?:\s|$)|потому(?:\s|$)|значит(?:\s|$)|возможно(?:\s|$)|видимо(?:\s|$)|точно(?:\s|$)|кстати(?:\s|$)|ещ[её](?:\s|$)|поднял(?:\s|$)|опустил(?:\s|$)|проверил(?:\s|$)|заменил(?:\s|$)|сделал(?:\s|$)|настроил(?:\s|$)|помогло(?:\s|$)|не помогло(?:\s|$)|я\s|он\s|она\s|они\s)/iu;

const STOP_WORDS = new Set([
  "без", "был", "была", "были", "быть", "вам", "вас", "вот", "все", "всё", "где", "для", "его", "если", "есть", "ещё", "или", "как", "когда", "который", "меня", "мне", "можно", "мой", "надо", "нет", "они", "она", "оно", "под", "при", "просто", "про", "раз", "так", "там", "тебя", "тоже", "только", "тут", "уже", "хочу", "что", "это", "этот", "эта", "эти", "очень", "сейчас", "потом", "после", "перед", "через", "пока", "кто", "куда", "какой", "какая", "какие", "почему", "зачем", "будет", "может", "нужно", "нужен", "нужна", "себя", "свой", "свои", "такой", "такая", "такие", "того", "тому", "тогда", "чем", "чего", "чтобы", "либо", "лишь", "даже", "ведь", "ещe", "have", "with", "from", "this", "that", "what", "when", "where", "which", "then", "than", "into", "your", "you", "for", "the", "and", "but", "not",
]);

const SHORT_TECH_TOKENS = new Set([
  "q2", "q1", "abs", "asa", "pla", "petg", "tpu", "pa6", "pa12", "pc", "pps", "cf", "gf", "box",
]);

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

export function removalReason(message: NormalizedMessage): string | null {
  if (message.type !== "message") return "service-message";
  if (!message.text) return message.hasMedia ? "media-without-caption" : "empty";
  if (ONLY_NOISE.test(message.text)) return "emoji-or-punctuation-only";
  if (ACKNOWLEDGEMENT.test(message.text)) return "short-acknowledgement";
  if (MARKET.test(message.text)) return "marketplace-or-sale";
  if (message.text.length < 8 && !message.replyTo) return "too-short-without-context";
  return null;
}

export function extractKeywords(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/ё/g, "е").replace(/https?:\/\/\S+/giu, " ");
  const rawTokens = normalized.match(/[a-zа-я0-9][a-zа-я0-9+._-]*/giu) ?? [];
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    const clean = token.replace(/^[._+-]+|[._+-]+$/g, "");
    if (!clean || STOP_WORDS.has(clean)) continue;
    if (clean.length >= 4 || SHORT_TECH_TOKENS.has(clean) || /\d/.test(clean)) tokens.add(clean);
  }
  return tokens;
}

export function sharedKeywordCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}
