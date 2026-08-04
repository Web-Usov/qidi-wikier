import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  normalizeMessage,
  streamTelegramMessages,
  type NormalizedMessage,
} from "./telegram.ts";

export interface PrepareOptions {
  input: string;
  output: string;
  sourceName?: string;
  maxChars: number;
}

interface Thread {
  id: string;
  rootId: number;
  topic: string;
  title: string;
  messages: NormalizedMessage[];
  score: number;
}

interface SkipRecord {
  id: number;
  reason: string;
  text?: string;
}

const ACKNOWLEDGEMENT = /^(спасибо|благодарю|понял|ясно|ок(?:ей)?|ага|угу|да|нет|точно|согласен|круто|класс|норм|плюсую|жд[её]м|доброе утро|добрый вечер|привет)[!.,… )]*(?:\p{Extended_Pictographic})*$/iu;
const ONLY_NOISE = /^[\s\p{P}\p{S}\p{Extended_Pictographic}]+$/u;
const MARKET = /\b(продам|куплю|обменяю|барахолк|доставка|авито|озон|wildberries|вб\b|скидк|промокод)\b/iu;
const TECHNICAL = /\b(qidi|ку2|q2|q1|plus\s*4|принтер|печать|сло[йя]|сопл|экстру|филамент|пластик|pla|petg|abs|asa|tpu|pa\d*|нейлон|карбон|стекловолок|gf\d*|cf\d*|температур|стол|камер|вентилятор|обдув|ретракт|pressure\s*advance|input\s*shap|рем[её]н|шкив|воблинг|резонанс|калибров|прошив|klipper|orca|g-?code|ошибк|qde\d+|box|бокс|сушк|катушк|ptfe|хотэнд|термистор|нагрев|адгези|усадк|мост|нависан|подач|пробк|засор|mesh|z[- ]?offset)\b/iu;

const TOPICS: Array<[string, RegExp]> = [
  ["qidi-box", /\b(qidi\s*box|qidi-box|gd[- ]?box|бокс|ams|rfid|смотк|бесконечн.{0,8}катуш|ptfe.{0,20}box)\b/iu],
  ["firmware-errors", /\b(прошив|firmware|klipper|qde\d+|ошибк|конфиг|printer\.cfg|макрос|g-?code)\b/iu],
  ["calibration", /\b(input\s*shap|pressure\s*advance|калибров|резонанс|акселерометр|mesh|z[- ]?offset|flow\s*rate|pa[- ]?tower)\b/iu],
  ["print-defects", /\b(воблинг|полос|эхо|ряб|сдвиг.{0,10}сло|деламинац|рассло|сопл|пробк|засор|мост|нависан|угол|дефект|артефакт|волос|stringing)\b/iu],
  ["mechanics", /\b(рем[её]н|шкив|направляющ|каретк|подшипник|винт|балк|рама|люфт|натяж)\b/iu],
  ["filaments", /\b(filament|филамент|пластик|pla|petg|abs|asa|tpu|pa\d*|нейлон|pc\b|pps|peek|pvdf|gf\d*|cf\d*|карбон|стекловолок|сушк|гигроскоп)\b/iu],
  ["hardware", /\b(плата|mcu|stm32|gd32|вентилятор|камера|датчик|термистор|нагреватель|хотэнд|экструдер|сопло|электрон)\b/iu],
];

function classifyTopic(text: string): string {
  for (const [topic, pattern] of TOPICS) if (pattern.test(text)) return topic;
  return "general";
}

function technicalScore(message: NormalizedMessage): number {
  let score = 0;
  const text = message.text;
  if (TECHNICAL.test(text)) score += 3;
  if (/\d{2,3}\s*°?c\b/iu.test(text)) score += 2;
  if (/\b\d+(?:[.,]\d+)?\s*(?:мм|mm|мм\/с|mm\/s|мм\/с²|hz|гц|час|мин|%)\b/iu.test(text)) score += 1;
  if (/https?:\/\//iu.test(text)) score += 1;
  if (/\b(помогло|решил[оа]?|не помогло|причина|исправил|заменил|проверил|результат|настройк|параметр)\b/iu.test(text)) score += 2;
  if (text.length >= 160) score += 1;
  if (message.reactionCount >= 3) score += 1;
  if (message.replyTo) score += 1;
  return score;
}

function removalReason(message: NormalizedMessage): string | null {
  if (message.type !== "message") return "service-message";
  if (!message.text) return message.hasMedia ? "media-without-caption" : "empty";
  if (ONLY_NOISE.test(message.text)) return "emoji-or-punctuation-only";
  if (ACKNOWLEDGEMENT.test(message.text)) return "short-acknowledgement";
  if (MARKET.test(message.text) && !TECHNICAL.test(message.text)) return "marketplace-or-sale";
  if (message.text.length < 8 && !message.replyTo) return "too-short-without-context";
  return null;
}

function detectTopicAnchors(messages: NormalizedMessage[]): Set<number> {
  const replyCounts = new Map<number, number>();
  for (const message of messages) {
    if (!message.replyTo) continue;
    replyCounts.set(message.replyTo, (replyCounts.get(message.replyTo) ?? 0) + 1);
  }
  const threshold = Math.max(20, Math.ceil(messages.length * 0.01));
  return new Set([...replyCounts.entries()].filter(([, count]) => count >= threshold).map(([id]) => id));
}

function findRootId(
  message: NormalizedMessage,
  byId: Map<number, NormalizedMessage>,
  topicAnchors: Set<number>,
): number {
  let current = message;
  const visited = new Set<number>([message.id]);
  while (current.replyTo && !topicAnchors.has(current.replyTo) && byId.has(current.replyTo) && !visited.has(current.replyTo)) {
    visited.add(current.replyTo);
    current = byId.get(current.replyTo) as NormalizedMessage;
  }
  return current.id;
}

function threadTitle(messages: NormalizedMessage[]): string {
  const candidate = messages.find((message) => message.text.length >= 20)?.text ?? messages[0]?.text ?? "Без названия";
  return candidate.replace(/\s+/g, " ").slice(0, 110);
}

function renderThread(thread: Thread, sourceName: string): string {
  const dates = thread.messages.map((message) => message.date).filter(Boolean);
  const start = dates[0] ?? "неизвестно";
  const end = dates.at(-1) ?? start;
  const lines = [
    `## ${thread.id} — ${thread.title}`,
    "",
    `- Источник: \`${sourceName}\``,
    `- Тема: \`${thread.topic}\``,
    `- Период: ${start}${end !== start ? ` — ${end}` : ""}`,
    `- Сообщения: ${thread.messages.map((message) => message.id).join(", ")}`,
    `- Технический балл: ${thread.score}`,
    "",
    "### Цепочка",
    "",
  ];
  for (const message of thread.messages) {
    const reply = message.replyTo ? `, ответ на ${message.replyTo}` : "";
    lines.push(`**[${message.id}] ${message.author}** — ${message.date || "без даты"}${reply}`, "", message.text.trim(), "");
  }
  return `${lines.join("\n")}\n`;
}

function renderChunkHeader(sourceName: string, index: number): string {
  return [
    "# Очищенные обсуждения QIDI",
    "",
    `Источник: \`${sourceName}\`  `,
    `Часть: ${String(index).padStart(3, "0")}`,
    "",
    "> Это слой доказательств, а не готовая энциклопедия. Сообщения очищены от очевидного шума, но выводы требуют последующей редакторской проверки.",
    "",
  ].join("\n");
}

export async function prepareTelegramExport(options: PrepareOptions): Promise<void> {
  const sourceName = options.sourceName || basename(options.input).replace(/\.[^.]+$/, "");
  const chunksDir = join(options.output, "chunks");
  const quarantineDir = join(options.output, "quarantine");
  const skippedDir = join(options.output, "skipped");
  await Promise.all([mkdir(chunksDir, { recursive: true }), mkdir(quarantineDir, { recursive: true }), mkdir(skippedDir, { recursive: true })]);

  const retained: NormalizedMessage[] = [];
  const skipped: SkipRecord[] = [];
  const quarantined: NormalizedMessage[] = [];
  let rawCount = 0;

  for await (const raw of streamTelegramMessages(options.input)) {
    rawCount += 1;
    const message = normalizeMessage(raw);
    if (!message) {
      skipped.push({ id: -1, reason: "invalid-message" });
      continue;
    }
    const reason = removalReason(message);
    if (reason) {
      skipped.push({ id: message.id, reason, text: message.text.slice(0, 300) });
      continue;
    }
    if (technicalScore(message) === 0 && !message.replyTo) {
      quarantined.push(message);
      continue;
    }
    retained.push(message);
  }

  const byId = new Map(retained.map((message) => [message.id, message]));
  const topicAnchors = detectTopicAnchors(retained);
  const grouped = new Map<number, NormalizedMessage[]>();
  for (const message of retained) {
    const rootId = findRootId(message, byId, topicAnchors);
    const group = grouped.get(rootId) ?? [];
    group.push(message);
    grouped.set(rootId, group);
  }

  const threads: Thread[] = [];
  for (const [rootId, messages] of grouped) {
    messages.sort((a, b) => a.unixTime - b.unixTime || a.id - b.id);
    const score = messages.reduce((sum, message) => sum + technicalScore(message), 0);
    if (score < 2 && messages.length === 1) {
      quarantined.push(...messages);
      continue;
    }
    const combined = messages.map((message) => message.text).join("\n");
    threads.push({
      id: `THREAD-${sourceName.toUpperCase().replace(/[^A-ZА-Я0-9]+/giu, "-")}-${rootId}`,
      rootId,
      topic: classifyTopic(combined),
      title: threadTitle(messages),
      messages,
      score,
    });
  }
  threads.sort((a, b) => a.messages[0]!.unixTime - b.messages[0]!.unixTime || a.rootId - b.rootId);

  const chunkFiles: Array<{ file: string; threads: number; chars: number }> = [];
  let chunkIndex = 1;
  let body = renderChunkHeader(sourceName, chunkIndex);
  let threadCount = 0;
  const flush = async (): Promise<void> => {
    if (threadCount === 0) return;
    const file = `${sourceName}_${String(chunkIndex).padStart(3, "0")}.md`;
    await writeFile(join(chunksDir, file), body, "utf8");
    chunkFiles.push({ file: `chunks/${file}`, threads: threadCount, chars: body.length });
    chunkIndex += 1;
    body = renderChunkHeader(sourceName, chunkIndex);
    threadCount = 0;
  };
  for (const thread of threads) {
    const rendered = renderThread(thread, sourceName);
    if (threadCount > 0 && body.length + rendered.length > options.maxChars) await flush();
    body += `${rendered}\n`;
    threadCount += 1;
  }
  await flush();

  const topicCounts = Object.fromEntries([...new Set(threads.map((thread) => thread.topic))].sort().map((topic) => [topic, threads.filter((thread) => thread.topic === topic).length]));
  const removalCounts = Object.fromEntries([...new Set(skipped.map((item) => item.reason))].sort().map((reason) => [reason, skipped.filter((item) => item.reason === reason).length]));
  const statistics = {
    rawMessages: rawCount,
    retainedMessages: retained.length,
    skippedMessages: skipped.length,
    quarantinedMessages: quarantined.length,
    threads: threads.length,
    topicCounts,
    removalCounts,
    detectedTopicAnchors: [...topicAnchors].sort((a, b) => a - b),
  };

  await Promise.all([
    writeFile(join(options.output, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, sourceName, inputFile: basename(options.input), generatedAt: new Date().toISOString(), chunks: chunkFiles }, null, 2)}\n`, "utf8"),
    writeFile(join(options.output, "statistics.json"), `${JSON.stringify(statistics, null, 2)}\n`, "utf8"),
    writeFile(join(quarantineDir, "uncertain_messages.jsonl"), quarantined.map((message) => JSON.stringify(message)).join("\n") + (quarantined.length ? "\n" : ""), "utf8"),
    writeFile(join(skippedDir, "removal_report.json"), `${JSON.stringify(skipped, null, 2)}\n`, "utf8"),
  ]);

  console.log(JSON.stringify({ output: options.output, ...statistics, chunks: chunkFiles.length }, null, 2));
}
