import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

const files = [
  ...collectTypeScriptFiles("src"),
  ...collectTypeScriptFiles("test"),
].sort();

if (files.length === 0) {
  console.error("No TypeScript files found in src or test.");
  process.exit(1);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "qidi-wikier-check-"));

try {
  for (const [index, file] of files.entries()) {
    let transformed;
    try {
      const source = readFileSync(file, "utf8");
      transformed = stripTypeScriptTypes(source, {
        mode: "transform",
        sourceMap: false,
      });
    } catch (error) {
      console.error(
        `Failed to transform ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    const temporaryFile = join(
      temporaryDirectory,
      `${String(index).padStart(3, "0")}-${basename(file, ".ts")}.mjs`,
    );
    writeFileSync(temporaryFile, transformed, "utf8");

    const result = spawnSync(process.execPath, ["--check", temporaryFile], {
      stdio: "inherit",
    });

    if (result.error) {
      console.error(`Failed to check ${file}: ${result.error.message}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`Syntax check failed for ${file}.`);
      process.exit(result.status ?? 1);
    }
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Syntax check passed for ${files.length} TypeScript files.`);
