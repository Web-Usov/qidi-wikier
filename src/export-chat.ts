#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { buildChatReadyExport } from "./chat-ready.ts";
import type { EvidenceCandidate } from "./evidence.ts";
import type { KnowledgeCluster } from "./knowledge.ts";

interface ExportOptions {
  clusters?: string;
  output?: string;
  maxFileChars: number;
  maxEvidenceChars: number;
  evidence: string[];
}

function usage(): string {
  return `Usage:
  npm run export-chat -- \\
    --clusters ./prepared/combined/knowledge/clusters.jsonl \\
    --output ./prepared/chat-ready \\
    [--max-file-chars 6000000] \\
    [--max-evidence-chars 3500] \\
    ./prepared/*/evidence/candidates.jsonl
`;
}

function parseArgs(args: string[]): ExportOptions {
  const options: ExportOptions = {
    maxFileChars: 6_000_000,
    maxEvidenceChars: 3_500,
    evidence: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (["--clusters", "--output", "--max-file-chars", "--max-evidence-chars"].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--clusters") options.clusters = value;
      else if (arg === "--output") options.output = value;
      else if (arg === "--max-file-chars") options.maxFileChars = Number(value);
      else options.maxEvidenceChars = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    options.evidence.push(arg);
  }
  return options;
}

async function readJsonLines<T>(file: string, validate: (item: T) => void): Promise<T[]> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const items: T[] = [];
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as T;
      validate(item);
      items.push(item);
    } catch (error) {
      throw new Error(`${file}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return items;
}

function validateCluster(cluster: KnowledgeCluster): void {
  if (!cluster.id || !cluster.topic || !cluster.reviewPriority || !Array.isArray(cluster.evidenceIds)) {
    throw new Error("missing required knowledge cluster fields");
  }
}

function validateEvidence(candidate: EvidenceCandidate): void {
  if (!candidate.id || !candidate.sourceName || !candidate.threadId || !Array.isArray(candidate.sourceMessages)) {
    throw new Error("missing required evidence fields");
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.clusters || !options.output || options.evidence.length === 0) {
    throw new Error("--clusters, --output and at least one evidence candidates.jsonl are required");
  }
  const clusters = await readJsonLines<KnowledgeCluster>(options.clusters, validateCluster);
  const evidenceNested = await Promise.all(options.evidence.map((file) => readJsonLines<EvidenceCandidate>(file, validateEvidence)));
  const result = buildChatReadyExport(clusters, evidenceNested.flat(), {
    maxFileChars: options.maxFileChars,
    maxEvidenceChars: options.maxEvidenceChars,
  });
  const output = resolve(options.output);
  await rm(output, { recursive: true, force: true });
  await Promise.all(result.files.map(async (file) => {
    const path = resolve(output, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, "utf8");
  }));
  console.log(JSON.stringify({ output, ...result.manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
