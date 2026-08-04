#!/usr/bin/env node
import { resolve } from "node:path";
import { prepareTelegramExport } from "./pipeline.ts";

interface CliOptions {
  input?: string;
  output?: string;
  sourceName?: string;
  maxChars: number;
}

function usage(): string {
  return `Usage:
  npm run prepare -- --input <telegram.json> --output <directory> [options]

Options:
  --source-name <name>   Stable source identifier (default: input filename)
  --max-chars <number>   Approximate maximum Markdown chunk size (default: 600000)
  --help                 Show this message

Example:
  npm run prepare -- \\
    --input ./sources/qidi_general_chat.json \\
    --output ./prepared/general \\
    --source-name qidi_general_chat
`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { maxChars: 600_000 };
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
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output) throw new Error("Both --input and --output are required");
  if (!Number.isFinite(options.maxChars) || options.maxChars < 50_000) {
    throw new Error("--max-chars must be a number of at least 50000");
  }

  await prepareTelegramExport({
    input: resolve(options.input),
    output: resolve(options.output),
    sourceName: options.sourceName,
    maxChars: options.maxChars,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  process.exitCode = 1;
}
