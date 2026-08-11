import { createHash } from "node:crypto";
import type { EvidenceCandidate, EvidenceSourceMessage } from "./evidence.ts";
import type { KnowledgeCluster, KnowledgeEvidenceRole, KnowledgeReviewPriority } from "./knowledge.ts";

export interface ChatReadyExportOptions {
  maxFileChars?: number;
  maxEvidenceChars?: number;
}

export interface ChatReadyFile {
  path: string;
  content: string;
  clusterIds: string[];
}

export interface ChatReadyManifest {
  schemaVersion: 1;
  format: "qidi-chat-ready";
  clusters: number;
  evidenceCandidates: number;
  files: Array<{ path: string; characters: number; clusters: number }>;
  topicDistribution: Record<string, number>;
  priorityDistribution: Record<KnowledgeReviewPriority, number>;
  roleDistribution: Record<KnowledgeEvidenceRole, number>;
  omittedEvidenceReferences: number;
  anonymizedAuthors: true;
}

export interface ChatReadyExport {
  files: ChatReadyFile[];
  manifest: ChatReadyManifest;
}

const DEFAULT_MAX_FILE_CHARS = 6_000_000;
const DEFAULT_MAX_EVIDENCE_CHARS = 3_500;
const PRIORITY_ORDER: Record<KnowledgeReviewPriority, number> = { high: 0, medium: 1, low: 2 };
const ROLE_LABELS: Record<KnowledgeEvidenceRole, string> = {
  support: "Поддерживающие сообщения сообщества",
  caution: "Предостережения и непроверенные сообщения",
  unresolved: "Нерешённые вопросы и незавершённые наблюдения",
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, "-")
    .replace(/^-+|-+$/gu, "") || "other";
}

function cleanText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/[ \t]+\n/gu, "\n").trim();
}

function authorAlias(candidate: EvidenceCandidate, message: EvidenceSourceMessage): string {
  const raw = `${candidate.sourceName}:${message.authorId || message.author}`;
  return `participant-${createHash("sha256").update(raw).digest("hex").slice(0, 8)}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n… [фрагмент сокращён; см. ID evidence и сообщений]`;
}

function scopeLine(cluster: KnowledgeCluster): string {
  const parts = [
    cluster.scope.materials.length ? `материалы: ${cluster.scope.materials.join(", ")}` : "",
    cluster.scope.printers.length ? `принтеры: ${cluster.scope.printers.join(", ")}` : "",
    cluster.scope.components.length ? `компоненты: ${cluster.scope.components.join(", ")}` : "",
    cluster.scope.brands.length ? `бренды: ${cluster.scope.brands.join(", ")}` : "",
    cluster.focusTags.length ? `фокус: ${cluster.focusTags.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("; ") || "область автоматически не определена";
}

function parameterLine(candidate: EvidenceCandidate): string {
  if (candidate.parameters.length === 0) return "нет";
  return uniqueSorted(candidate.parameters.map((parameter) => `${parameter.kind}: ${parameter.value} [msg ${parameter.messageId}]`)).join("; ");
}

function transcript(candidate: EvidenceCandidate, maxChars: number): string {
  const messages = candidate.sourceMessages.map((message) => {
    const reply = message.replyTo === undefined ? "" : `, reply→${message.replyTo}`;
    const media = message.hasMedia ? ", media-not-inspected" : "";
    const text = cleanText(message.text) || "[сообщение без текстовой подписи]";
    return `- [${candidate.sourceName} msg ${message.id}${reply}, ${authorAlias(candidate, message)}, ${message.date}${media}]\n  ${text.replace(/\n/gu, "\n  ")}`;
  }).join("\n");
  return truncate(messages || cleanText(candidate.sourceExcerpt), maxChars);
}

function evidenceBlock(candidate: EvidenceCandidate, role: KnowledgeEvidenceRole, maxChars: number): string {
  const warnings = candidate.flags.length ? candidate.flags.join(", ") : "нет";
  return [
    `#### ${candidate.id}`,
    "",
    `- Роль в кластере: \`${role}\``,
    `- Источник: \`${candidate.sourceName}\`; цепочка: \`${candidate.threadId}\`; root: \`${candidate.rootId}\``,
    `- Типы: ${candidate.kinds.map((kind) => `\`${kind}\``).join(", ") || "нет"}; статус: \`${candidate.status}\`; предварительный уровень: \`${candidate.provisionalReliability}\``,
    `- Параметры: ${parameterLine(candidate)}`,
    `- Флаги проверки: ${warnings}`,
    "",
    transcript(candidate, maxChars),
    "",
  ].join("\n");
}

function roleIds(cluster: KnowledgeCluster, role: KnowledgeEvidenceRole): string[] {
  if (role === "support") return cluster.supportEvidenceIds;
  if (role === "caution") return cluster.cautionEvidenceIds;
  return cluster.unresolvedEvidenceIds;
}

function clusterBlock(
  cluster: KnowledgeCluster,
  evidenceById: Map<string, EvidenceCandidate>,
  maxEvidenceChars: number,
): { content: string; missing: number } {
  const lines = [
    `## ${cluster.title}`,
    "",
    `- Cluster ID: \`${cluster.id}\``,
    `- Тема: \`${cluster.topic}\`; приоритет ручной проверки: \`${cluster.reviewPriority}\``,
    `- Область: ${scopeLine(cluster)}`,
    `- Роли: support=${cluster.supportEvidenceIds.length}, caution=${cluster.cautionEvidenceIds.length}, unresolved=${cluster.unresolvedEvidenceIds.length}`,
    `- Источники: ${cluster.sourceNames.map((source) => `\`${source}\``).join(", ") || "нет"}`,
    `- Флаги кластера: ${cluster.flags.join(", ") || "нет"}`,
    "",
    "> Важно: support означает только полезное сообщение сообщества, а не проверенный технический факт.",
    "",
  ];
  let missing = 0;
  for (const role of ["support", "caution", "unresolved"] as const) {
    const ids = roleIds(cluster, role);
    if (ids.length === 0) continue;
    lines.push(`### ${ROLE_LABELS[role]}`, "");
    for (const id of ids) {
      const candidate = evidenceById.get(id);
      if (!candidate) {
        missing += 1;
        lines.push(`#### ${id}`, "", "[Ошибка экспорта: evidence-кандидат отсутствует]", "");
        continue;
      }
      lines.push(evidenceBlock(candidate, role, maxEvidenceChars));
    }
  }
  return { content: `${lines.join("\n").trim()}\n`, missing };
}

function topicHeader(topic: string): string {
  return [
    `# QIDI knowledge pack — ${topic}`,
    "",
    "> Автоматически подготовленный поисковый пакет из Telegram-обсуждений. Он сохраняет исходные формулировки, но не подтверждает истинность советов.",
    "",
    "Используйте Cluster ID, Evidence ID, имя источника и message ID для ссылок в ответах.",
    "",
  ].join("\n");
}

function splitTopic(topic: string, blocks: Array<{ id: string; content: string }>, maxChars: number): ChatReadyFile[] {
  const safeTopic = slug(topic);
  const files: ChatReadyFile[] = [];
  const willSplit = topicHeader(topic).length + blocks.reduce((sum, block) => sum + block.content.length + 1, 0) > maxChars;
  let current = topicHeader(topic);
  let ids: string[] = [];
  const flush = (): void => {
    if (ids.length === 0) return;
    const suffix = willSplit ? `-${String(files.length + 1).padStart(2, "0")}` : "";
    files.push({ path: `topics/${safeTopic}${suffix}.md`, content: `${current.trim()}\n`, clusterIds: ids });
    current = topicHeader(topic);
    ids = [];
  };
  for (const block of blocks) {
    if (ids.length > 0 && current.length + block.content.length + 2 > maxChars) flush();
    current += `\n${block.content}`;
    ids.push(block.id);
  }
  flush();
  return files;
}

function renderStartHere(manifest: Omit<ChatReadyManifest, "files">): string {
  return `# QIDI Chat Knowledge — старт\n\nЭтот пакет подготовлен для загрузки в отдельный проект или чат ChatGPT.\n\n## Что загрузить\n\nЗагрузите все Markdown-файлы из корня и папки \`topics\`, а также \`catalog.jsonl\` и \`manifest.json\`. Пакет рассчитан так, чтобы основные данные находились в тематических Markdown-файлах.\n\n## Как задавать вопросы\n\nПример:\n\n> Найди в базе случаи, похожие на расслоение PETG-резьбы на QIDI Q2. Отдели советы от результатов и укажи Cluster ID, Evidence ID и message ID.\n\n## Состав\n\n- Кластеров: ${manifest.clusters}\n- Evidence-кандидатов: ${manifest.evidenceCandidates}\n- Авторы в экспортированных метаданных анонимизированы.\n- Исходные советы не считаются автоматически подтверждёнными.\n`;
}

function renderInstructions(): string {
  return `# Инструкция для ChatGPT\n\nИспользуй загруженный QIDI knowledge pack как основной источник при ответах о QIDI Q2, QIDI BOX, филаментах и дефектах печати.\n\n1. Ищи совпадения одновременно по симптому, материалу, принтеру, компоненту и параметрам.\n2. Не называй сообщения из раздела \`support\` доказанным фактом: это лишь полезные ответы или результаты участников.\n3. Всегда отделяй \`support\`, \`caution\` и \`unresolved\`.\n4. Для каждого существенного вывода указывай Cluster ID и Evidence ID; при возможности также sourceName и message ID.\n5. Не объединяй разные случаи только из-за общего слова QIDI, принтер, температура или пластик.\n6. Учитывай отсутствующие фото/видео и внешние ссылки как ограничения.\n7. Если база не содержит ответа, прямо сообщи об этом.\n8. Не добавляй внешние сведения без отдельной пометки «Внешнее знание, не из базы».\n9. При противоречиях покажи обе стороны и не выбирай одну без основания.\n10. Начинай ответ с наиболее похожих случаев, затем перечисляй менее близкие.\n`;
}

function catalogLine(cluster: KnowledgeCluster, path: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: cluster.id,
    title: cluster.title,
    topic: cluster.topic,
    file: path,
    reviewPriority: cluster.reviewPriority,
    focusTags: cluster.focusTags,
    scope: cluster.scope,
    roles: {
      support: cluster.supportEvidenceIds.length,
      caution: cluster.cautionEvidenceIds.length,
      unresolved: cluster.unresolvedEvidenceIds.length,
    },
    sourceNames: cluster.sourceNames,
  });
}

function renderIndex(clusters: KnowledgeCluster[], topicFiles: ChatReadyFile[]): string {
  const topicGroups = new Map<string, KnowledgeCluster[]>();
  for (const cluster of clusters) {
    const group = topicGroups.get(cluster.topic) ?? [];
    group.push(cluster);
    topicGroups.set(cluster.topic, group);
  }
  const lines = [
    "# Индекс QIDI knowledge pack",
    "",
    "Для машинного поиска используйте также `catalog.jsonl`.",
    "",
    "## Тематические файлы",
    "",
  ];
  for (const topic of [...topicGroups.keys()].sort((a, b) => a.localeCompare(b))) {
    const group = topicGroups.get(topic)!;
    const groupIds = new Set(group.map((cluster) => cluster.id));
    const files = topicFiles.filter((file) => file.clusterIds.some((id) => groupIds.has(id)));
    const counts = {
      high: group.filter((cluster) => cluster.reviewPriority === "high").length,
      medium: group.filter((cluster) => cluster.reviewPriority === "medium").length,
      low: group.filter((cluster) => cluster.reviewPriority === "low").length,
    };
    lines.push(`### ${topic}`, "", `- Кластеров: ${group.length}; high=${counts.high}, medium=${counts.medium}, low=${counts.low}`, `- Файлы: ${files.map((file) => `\`${file.path}\``).join(", ")}`, "");
  }
  lines.push("## Быстрый поиск по приоритетным кластерам", "");
  for (const cluster of clusters.filter((item) => item.reviewPriority === "high")) {
    lines.push(`- \`${cluster.id}\` — ${cluster.title}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildChatReadyExport(
  clustersInput: KnowledgeCluster[],
  candidatesInput: EvidenceCandidate[],
  options: ChatReadyExportOptions = {},
): ChatReadyExport {
  const maxFileChars = options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
  const maxEvidenceChars = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  if (!Number.isInteger(maxFileChars) || maxFileChars < 50_000) throw new Error("maxFileChars must be an integer >= 50000");
  if (!Number.isInteger(maxEvidenceChars) || maxEvidenceChars < 500) throw new Error("maxEvidenceChars must be an integer >= 500");

  const clusterIds = clustersInput.map((cluster) => cluster.id);
  if (new Set(clusterIds).size !== clusterIds.length) throw new Error("Duplicate knowledge cluster IDs");
  const candidateIds = candidatesInput.map((candidate) => candidate.id);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error("Duplicate evidence candidate IDs");

  const clusters = [...clustersInput].sort((a, b) => (
    PRIORITY_ORDER[a.reviewPriority] - PRIORITY_ORDER[b.reviewPriority]
    || a.topic.localeCompare(b.topic)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id)
  ));
  const evidenceById = new Map(candidatesInput.map((candidate) => [candidate.id, candidate]));
  const topicBlocks = new Map<string, Array<{ id: string; content: string }>>();
  let omittedEvidenceReferences = 0;
  for (const cluster of clusters) {
    const rendered = clusterBlock(cluster, evidenceById, maxEvidenceChars);
    omittedEvidenceReferences += rendered.missing;
    const blocks = topicBlocks.get(cluster.topic) ?? [];
    blocks.push({ id: cluster.id, content: rendered.content });
    topicBlocks.set(cluster.topic, blocks);
  }
  if (omittedEvidenceReferences > 0) throw new Error(`Missing ${omittedEvidenceReferences} referenced evidence candidates`);

  const topicFiles = [...topicBlocks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([topic, blocks]) => splitTopic(topic, blocks, maxFileChars));
  const fileByCluster = new Map<string, string>();
  for (const file of topicFiles) for (const id of file.clusterIds) fileByCluster.set(id, file.path);

  const topicDistribution = Object.fromEntries([...topicBlocks.entries()].map(([topic, blocks]) => [topic, blocks.length]));
  const priorityDistribution: Record<KnowledgeReviewPriority, number> = {
    high: clusters.filter((cluster) => cluster.reviewPriority === "high").length,
    medium: clusters.filter((cluster) => cluster.reviewPriority === "medium").length,
    low: clusters.filter((cluster) => cluster.reviewPriority === "low").length,
  };
  const roleDistribution: Record<KnowledgeEvidenceRole, number> = {
    support: clusters.reduce((sum, cluster) => sum + cluster.supportEvidenceIds.length, 0),
    caution: clusters.reduce((sum, cluster) => sum + cluster.cautionEvidenceIds.length, 0),
    unresolved: clusters.reduce((sum, cluster) => sum + cluster.unresolvedEvidenceIds.length, 0),
  };
  const manifestBase = {
    schemaVersion: 1 as const,
    format: "qidi-chat-ready" as const,
    clusters: clusters.length,
    evidenceCandidates: candidatesInput.length,
    topicDistribution,
    priorityDistribution,
    roleDistribution,
    omittedEvidenceReferences,
    anonymizedAuthors: true as const,
  };
  const metaFiles: ChatReadyFile[] = [
    { path: "00_START_HERE.md", content: renderStartHere(manifestBase), clusterIds: [] },
    { path: "01_SEARCH_INSTRUCTIONS.md", content: renderInstructions(), clusterIds: [] },
    { path: "02_INDEX.md", content: renderIndex(clusters, topicFiles), clusterIds: [] },
    {
      path: "catalog.jsonl",
      content: `${clusters.map((cluster) => catalogLine(cluster, fileByCluster.get(cluster.id)!)).join("\n")}${clusters.length ? "\n" : ""}`,
      clusterIds: clusters.map((cluster) => cluster.id),
    },
  ];
  const withoutManifest = [...metaFiles, ...topicFiles];
  const manifest: ChatReadyManifest = {
    ...manifestBase,
    files: withoutManifest.map((file) => ({ path: file.path, characters: file.content.length, clusters: file.clusterIds.length })),
  };
  const manifestFile: ChatReadyFile = {
    path: "manifest.json",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    clusterIds: [],
  };
  return { files: [...metaFiles, manifestFile, ...topicFiles], manifest };
}
