import type { InferredLink } from "./context.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface Thread {
  id: string;
  rootId: number;
  topic: string;
  title: string;
  messages: NormalizedMessage[];
  score: number;
  inferredLinks: InferredLink[];
}

export interface ContextLinkReviewRecord {
  threadId: string;
  topic: string;
  messageId: number;
  linkedTo: number;
  score: number;
  reasons: string[];
  previousText: string;
  currentText: string;
}

export function threadTitle(messages: NormalizedMessage[]): string {
  const candidate = messages.find((message) => message.text.length >= 20)?.text ?? messages[0]?.text ?? "Без названия";
  return candidate.replace(/\s+/g, " ").slice(0, 110);
}

export function renderThread(thread: Thread, sourceName: string, topicAnchors: Set<number>): string {
  const dates = thread.messages.map((message) => message.date).filter(Boolean);
  const start = dates[0] ?? "неизвестно";
  const end = dates.at(-1) ?? start;
  const inferredByMessage = new Map(thread.inferredLinks.map((link) => [link.messageId, link]));
  const lines = [
    `## ${thread.id} — ${thread.title}`,
    "",
    `- Источник: \`${sourceName}\``,
    `- Тема: \`${thread.topic}\``,
    `- Период: ${start}${end !== start ? ` — ${end}` : ""}`,
    `- Сообщения: ${thread.messages.map((message) => message.id).join(", ")}`,
    `- Технический балл: ${thread.score}`,
    `- Контекстных связей: ${thread.inferredLinks.length}`,
    "",
    "### Цепочка",
    "",
  ];
  for (const message of thread.messages) {
    const inferred = inferredByMessage.get(message.id);
    const relation = inferred
      ? `, контекстно связано с ${inferred.linkedTo} (балл ${inferred.score})`
      : message.replyTo && topicAnchors.has(message.replyTo)
        ? ", сообщение в топике"
        : message.replyTo
          ? `, ответ на ${message.replyTo}`
          : "";
    lines.push(`**[${message.id}] ${message.author}** — ${message.date || "без даты"}${relation}`, "", message.text.trim(), "");
    if (inferred) lines.push(`_Причины связи: ${inferred.reasons.join("; ")}._`, "");
  }
  return `${lines.join("\n")}\n`;
}

export function renderContextReview(records: ContextLinkReviewRecord[], sourceName: string): string {
  const lines = [
    "# Проверка контекстных связей",
    "",
    `Источник: \`${sourceName}\``,
    "",
    "> В выборку попадают связи с наименьшим эвристическим баллом. Их нужно проверить в первую очередь: ошибочную связь следует исправлять настройками алгоритма, а не вручную в итоговом Markdown.",
    "",
  ];
  for (const record of records) {
    lines.push(
      `## ${record.threadId}: ${record.linkedTo} → ${record.messageId}`,
      "",
      `- Тема: \`${record.topic}\``,
      `- Балл: ${record.score}`,
      `- Причины: ${record.reasons.join("; ")}`,
      "",
      `**Предыдущее сообщение [${record.linkedTo}]**`,
      "",
      record.previousText,
      "",
      `**Присоединённое сообщение [${record.messageId}]**`,
      "",
      record.currentText,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderChunkHeader(sourceName: string, index: number): string {
  return [
    "# Очищенные обсуждения QIDI",
    "",
    `Источник: \`${sourceName}\`  `,
    `Часть: ${String(index).padStart(3, "0")}`,
    "",
    "> Это слой доказательств, а не готовая энциклопедия. Сообщения очищены от очевидного шума. Связи без Telegram reply помечены как контекстные и требуют последующей редакторской проверки.",
    "",
  ].join("\n");
}
