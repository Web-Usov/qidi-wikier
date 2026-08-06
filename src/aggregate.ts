#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { EvidenceCandidate } from "./evidence.ts";
import {
  buildKnowledgeClusters,
  type ClusterableEvidenceCandidate,
  type KnowledgeCluster,
  type KnowledgeReviewPriority,
} from "./knowledge.ts";

interface AggregateOptions {
  output?: string;
  reviewSampleSize: number;
  inputs: string[];
}

function usage(): string {
  return `Usage:
  npm run aggregate -- --output <directory> [--review-sample-size 120] <candidates.jsonl> [...]

Example:
  npm run aggregate -- \\
    --output ./prepared/combined \\
    ./prepared/*/evidence/candidates.jsonl
`;
}

function parseArgs(args: string[]): AggregateOptions {
  const options: AggregateOptions = { reviewSampleSize: 120, inputs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--output" || arg === "--review-sample-size") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--output") options.output = value;
      else options.reviewSampleSize = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    options.inputs.push(arg);
  }
  return options;
}

async function readCandidates(file: string): Promise<ClusterableEvidenceCandidate[]> {
  const source = basename(resolve(file)).replace(/\.jsonl$/u, "");
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const candidates: ClusterableEvidenceCandidate[] = [];
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const candidate = JSON.parse(line) as ClusterableEvidenceCandidate;
      if (!candidate.id || !candidate.threadId || !candidate.status || !candidate.entities) {
        throw new Error("missing required evidence fields");
      }
      candidate.sourceName ??= source === "candidates" ? undefined : source;
      candidates.push(candidate);
    } catch (error) {
      throw new Error(`${file}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return candidates;
}

function evenlySample<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return items;
  if (count === 1) return [items[0]!];
  return Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]!);
}

function reviewSample(clusters: KnowledgeCluster[], sampleSize: number): KnowledgeCluster[] {
  const priorities: KnowledgeReviewPriority[] = ["high", "medium", "low"];
  const base = Math.floor(sampleSize / priorities.length);
  let remaining = sampleSize - base * priorities.length;
  const result: KnowledgeCluster[] = [];
  for (const priority of priorities) {
    const band = clusters.filter((cluster) => cluster.reviewPriority === priority);
    const target = Math.min(band.length, base + (remaining > 0 ? 1 : 0));
    if (remaining > 0) remaining -= 1;
    result.push(...evenlySample(band, target));
  }
  if (result.length < sampleSize) {
    const selected = new Set(result.map((cluster) => cluster.id));
    result.push(...clusters.filter((cluster) => !selected.has(cluster.id)).slice(0, sampleSize - result.length));
  }
  return result;
}

function scopeText(cluster: KnowledgeCluster): string {
  const parts = [
    cluster.scope.materials.length ? `материалы=${cluster.scope.materials.join("/")}` : "",
    cluster.scope.printers.length ? `принтеры=${cluster.scope.printers.join("/")}` : "",
    cluster.scope.components.length ? `компоненты=${cluster.scope.components.join("/")}` : "",
    cluster.scope.brands.length ? `бренды=${cluster.scope.brands.join("/")}` : "",
    cluster.focusTags.length ? `фокус=${cluster.focusTags.join("/")}` : "",
  ].filter(Boolean);
  return parts.join("; ") || "не определён";
}

function evidenceLine(candidate: ClusterableEvidenceCandidate | undefined): string {
  if (!candidate) return "кандидат отсутствует";
  const excerpt = candidate.sourceExcerpt.replace(/\s+/g, " ").slice(0, 500);
  return `\`${candidate.id}\` — ${candidate.status}/${candidate.provisionalReliability}; ${candidate.flags.join(", ") || "без флагов"}\n\n> ${excerpt}`;
}

function renderReview(
  clusters: KnowledgeCluster[],
  evidenceById: Map<string, ClusterableEvidenceCandidate>,
  totals: Record<KnowledgeReviewPriority, number>,
): string {
  const lines = [
    "# Проверка кластеров знаний",
    "",
    `Всего: high=${totals.high}, medium=${totals.medium}, low=${totals.low}.`,
    "",
    "> Кластер — только редакторская очередь. Он не является утверждением, не подтверждает истинность советов и никогда автоматически не получает уровни A/B/C.",
    "",
  ];
  for (const priority of ["high", "medium", "low"] as const) {
    const band = clusters.filter((cluster) => cluster.reviewPriority === priority);
    lines.push(`# Приоритет ${priority}`, "", `В выборке: ${band.length}.`, "");
    for (const cluster of band) {
      lines.push(
        `## ${cluster.id} — ${cluster.title}`,
        "",
        `- Статус: \`${cluster.status}\`; автоматическая надёжность: \`${cluster.automatedReliability}\``,
        `- Область: ${scopeText(cluster)}`,
        `- Поддержка: ${cluster.supportEvidenceIds.length}; предостережения: ${cluster.cautionEvidenceIds.length}; нерешённые: ${cluster.unresolvedEvidenceIds.length}`,
        `- Источники: ${cluster.sourceNames.join(", ") || "нет"}; независимые авторы: ${cluster.independentAuthors.length}`,
        `- Флаги: ${cluster.flags.join("; ") || "нет"}`,
        `- Параметры: ${cluster.parameterVariants.map((variant) => `${variant.value} [support=${variant.supportEvidenceIds.length}, caution=${variant.cautionEvidenceIds.length}]`).join("; ") || "нет"}`,
        "",
      );
      if (cluster.supportEvidenceIds.length) {
        lines.push("### Поддерживающие кандидаты", "");
        for (const id of cluster.supportEvidenceIds.slice(0, 6)) lines.push(evidenceLine(evidenceById.get(id)), "");
      }
      if (cluster.cautionEvidenceIds.length) {
        lines.push("### Предостережения", "");
        for (const id of cluster.cautionEvidenceIds.slice(0, 4)) lines.push(evidenceLine(evidenceById.get(id)), "");
      }
      if (cluster.unresolvedEvidenceIds.length) {
        lines.push("### Нерешённые вопросы и наблюдения", "");
        for (const id of cluster.unresolvedEvidenceIds.slice(0, 4)) lines.push(evidenceLine(evidenceById.get(id)), "");
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderIndex(clusters: KnowledgeCluster[], statistics: Record<string, unknown>): string {
  const lines = [
    "# Индекс кластеров знаний",
    "",
    "> Автоматический индекс для редакторской работы. Здесь нет автоматически подтверждённых технических фактов.",
    "",
    "```json",
    JSON.stringify(statistics, null, 2),
    "```",
    "",
    "## Кластеры с поддерживающими доказательствами",
    "",
  ];
  for (const cluster of clusters.filter((item) => item.supportEvidenceIds.length > 0).slice(0, 300)) {
    lines.push(`- \`${cluster.id}\` — ${cluster.title} — support=${cluster.supportEvidenceIds.length}, caution=${cluster.cautionEvidenceIds.length}, unresolved=${cluster.unresolvedEvidenceIds.length}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.output || options.inputs.length === 0) throw new Error("--output and at least one candidates.jsonl input are required");
  if (!Number.isInteger(options.reviewSampleSize) || options.reviewSampleSize <= 0 || options.reviewSampleSize > 2000) {
    throw new Error("--review-sample-size must be an integer from 1 to 2000");
  }

  const nested = await Promise.all(options.inputs.map(readCandidates));
  const candidates = nested.flat();
  const duplicateIds = candidates.map((candidate) => candidate.id).filter((id, index, values) => values.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error(`Duplicate evidence IDs: ${[...new Set(duplicateIds)].slice(0, 20).join(", ")}`);

  const clusters = buildKnowledgeClusters(candidates);
  const knowledgeDir = join(resolve(options.output), "knowledge");
  const reviewDir = join(resolve(options.output), "review");
  await Promise.all([mkdir(knowledgeDir, { recursive: true }), mkdir(reviewDir, { recursive: true })]);

  const priorityDistribution = {
    high: clusters.filter((cluster) => cluster.reviewPriority === "high").length,
    medium: clusters.filter((cluster) => cluster.reviewPriority === "medium").length,
    low: clusters.filter((cluster) => cluster.reviewPriority === "low").length,
  };
  const statistics = {
    schemaVersion: 1,
    evidenceCandidates: candidates.length,
    knowledgeClusters: clusters.length,
    priorityDistribution,
    clustersWithSupport: clusters.filter((cluster) => cluster.supportEvidenceIds.length > 0).length,
    clustersWithCautions: clusters.filter((cluster) => cluster.cautionEvidenceIds.length > 0).length,
    unresolvedOnlyClusters: clusters.filter((cluster) => cluster.supportEvidenceIds.length === 0 && cluster.cautionEvidenceIds.length === 0).length,
    multiSourceClusters: clusters.filter((cluster) => cluster.sourceNames.length > 1).length,
    supportEvidence: clusters.reduce((sum, cluster) => sum + cluster.supportEvidenceIds.length, 0),
    cautionEvidence: clusters.reduce((sum, cluster) => sum + cluster.cautionEvidenceIds.length, 0),
    unresolvedEvidence: clusters.reduce((sum, cluster) => sum + cluster.unresolvedEvidenceIds.length, 0),
    inputs: options.inputs.map((input) => basename(input)),
  };
  const sample = reviewSample(clusters, options.reviewSampleSize);
  const evidenceById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  await Promise.all([
    writeFile(join(knowledgeDir, "clusters.jsonl"), clusters.map((cluster) => JSON.stringify(cluster)).join("\n") + (clusters.length ? "\n" : ""), "utf8"),
    writeFile(join(knowledgeDir, "statistics.json"), `${JSON.stringify(statistics, null, 2)}\n`, "utf8"),
    writeFile(join(knowledgeDir, "index.md"), renderIndex(clusters, statistics), "utf8"),
    writeFile(join(reviewDir, "knowledge_clusters_sample.md"), renderReview(sample, evidenceById, priorityDistribution), "utf8"),
  ]);

  console.log(JSON.stringify({ output: resolve(options.output), ...statistics }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  process.exitCode = 1;
});
