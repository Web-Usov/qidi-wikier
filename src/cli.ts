#!/usr/bin/env node
import { resolve } from "node:path";
import { prepareTelegramExport } from "./pipeline.ts";

interface CliOptions {
  input?: string;
  output?: string;
  sourceName?: string;
  maxChars: number;
  contextWindowMinutes: number;
  sameAuthorWindowMinutes: number;
  minContextScore: number;
  minScoreMargin: number;
  reviewSampleSize: number;
}

function usage(): string {
  return `Usage:
  npm run ingest -- --input <telegram.json> --output <directory> [options]

Options:
  --source-name <name>                  Stable source identifier (default: input filename)
  --max-chars <number>                  Approximate maximum Markdown chunk size (default: 600000)
  --context-window-minutes <number>     Window for different authors (default: 12)
  --same-author-window-minutes <number> Window for fragmented messages by one author (default: 45)
  --min-context-score <number>          Minimum inferred-edge score (default: 4.0)
  --min-score-margin <number>           Required gap from second-best candidate (default: 0.75)
  --review-sample-size <number>         Stratified review sample size (default: 120)
  --help                                Show this message

Example:
  npm run ingest -- \\
    --input ./sources/qidi_general_chat.json \\
    --output ./prepared/general \\
    --source-name qidi_general_chat
`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    maxChars: 600_000,
    contextWindowMinutes: 12,
    sameAuthorWindowMinutes: 45,
    minContextScore: 4,
    minScoreMargin: 0.75,
    reviewSampleSize: 120,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--input") options.input = value;
    else if (arg === "--output") options.output = value;
    else if (arg === "--source-name") options.sourceName = value;
    else if (arg === "--max-chars") options.maxChars = Number(value);
    else if (arg === "--context-window-minutes") options.contextWindowMinutes = Number(value);
    else if (arg === "--same-author-window-minutes") options.sameAuthorWindowMinutes = Number(value);
    else if (arg === "--min-context-score") options.minContextScore = Number(value);
    else if (arg === "--min-score-margin") options.minScoreMargin = Number(value);
    else if (arg === "--review-sample-size") options.reviewSampleSize = Number(value);
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output) throw new Error("Both --input and --output are required");
  if (!Number.isFinite(options.maxChars) || options.maxChars < 50_000) throw new Error("--max-chars must be at least 50000");
  for (const [name, value] of [
    ["--context-window-minutes", options.contextWindowMinutes],
    ["--same-author-window-minutes", options.sameAuthorWindowMinutes],
    ["--min-context-score", options.minContextScore],
    ["--min-score-margin", options.minScoreMargin],
    ["--review-sample-size", options.reviewSampleSize],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  }
  await prepareTelegramExport({
    input: resolve(options.input),
    output: resolve(options.output),
    sourceName: options.sourceName,
    maxChars: options.maxChars,
    contextWindowMinutes: options.contextWindowMinutes,
    sameAuthorWindowMinutes: options.sameAuthorWindowMinutes,
    minContextScore: options.minContextScore,
    minScoreMargin: options.minScoreMargin,
    reviewSampleSize: options.reviewSampleSize,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  process.exitCode = 1;
}
