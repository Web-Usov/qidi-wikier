import type { ContextEdge } from "./context.ts";
import type { EntityProfile } from "./entities.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface Thread {
  id: string;
  rootId: number;
  topic: string;
  title: string;
  messages: NormalizedMessage[];
  score: number;
  knowledgeValue: number;
  contextEdges: ContextEdge[];
}

export interface ContextLinkReviewRecord extends ContextEdge {
  sourceThreadId: string;
  targetThreadId: string;
  topic: string;
  previousText: string;
  currentText: string;
  previousEntities: EntityProfile;
  currentEntities: EntityProfile;
}

export function threadTitle(messages: NormalizedMessage[]): string {
  const candidate = messages.find((message) => message.text.length >= 20)?.text ?? messages[0]?.text ?? "Без названия";
  return candidate.replace(/\s+/g, " ").slice(0, 110);
}

export function renderThread(thread: Thread, sourceName: string, topicAnchors: Set<number>): string {
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
    `- Ценность для базы: ${thread.knowledgeValue}`,
    `- Предположительных внешних связей: ${thread.contextEdges.length}`,
    "",
    "### Точная цепочка Telegram",
    "",
  ];
  for (const message of thread.messages) {
    const relation = message.replyTo && topicAnchors.has(message.replyTo)
      ? ", сообщение в топике"
      : message.replyTo
        ? `, ответ на ${message.replyTo}`
        : "";
    lines.push(`**[${message.id}] ${message.author}** — ${message.date || "без даты"}${relation}`, "", message.text.trim(), "");
  }
  if (thread.contextEdges.length) {
    lines.push("### Предположительные связи с другими цепочками", "");
    for (const edge of thread.contextEdges) {
      lines.push(
        `- [${edge.messageId}] → [${edge.linkedTo}], уверенность: **${edge.confidence}**, балл: ${edge.score}, отрыв от второго кандидата: ${edge.scoreMargin ?? "нет второго кандидата"}.`,
        `  Причины: ${edge.reasons.join("; ")}.`,
      );
      if (edge.conflicts.length) lines.push(`  Конфликты: ${edge.conflicts.join("; ")}.`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderRecord(record: ContextLinkReviewRecord): string[] {
  return [
    `## ${record.sourceThreadId}: ${record.linkedTo} → ${record.messageId}`,
    "",
    `- Целевая цепочка: \`${record.targetThreadId}\``,
    `- Тема источника: \`${record.topic}\``,
    `- Балл: ${record.score}`,
    `- Уверенность: \`${record.confidence}\``,
    `- Отрыв от второго кандидата: ${record.scoreMargin ?? "нет второго кандидата"}`,
    `- Ценность сообщений: ${record.targetKnowledgeValue} → ${record.sourceKnowledgeValue}`,
    `- Общие сущности: ${Object.entries(record.sharedEntities).map(([kind, values]) => `${kind}=${values.join("/")}`).join("; ") || "нет"}`,
    `- Конфликты: ${record.conflicts.join("; ") || "нет"}`,
    `- Причины: ${record.reasons.join("; ")}`,
    "",
    `**Предыдущее сообщение [${record.linkedTo}]**`,
    "",
    record.previousText,
    "",
    `**Предположительно связанное сообщение [${record.messageId}]**`,
    "",
    record.currentText,
    "",
  ];
}

export function renderContextReview(
  records: ContextLinkReviewRecord[],
  sourceName: string,
  totals: Record<ContextEdge["confidence"], number>,
): string {
  const lines = [
    "# Стратифицированная проверка контекстных связей",
    "",
    `Источник: \`${sourceName}\``,
    "",
    `Всего связей: low=${totals.low}, medium=${totals.medium}, high=${totals.high}.`,
    "",
    "> Предположительные связи не склеивают Telegram-цепочки и не влияют на последующие решения алгоритма. Выборка распределена по уровням уверенности.",
    "",
  ];
  for (const confidence of ["low", "medium", "high"] as const) {
    const band = records.filter((record) => record.confidence === confidence);
    lines.push(`# Уровень ${confidence}`, "", `В выборке: ${band.length}.`, "");
    for (const record of band) lines.push(...renderRecord(record));
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
    "> Внутри разделов находятся только точные Telegram reply-цепочки. Эвристические связи вынесены в отдельный граф и перечислены как метаданные, но не объединяют тексты.",
    "",
  ].join("\n");
}
