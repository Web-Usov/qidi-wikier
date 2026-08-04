import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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

for (const file of files) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--check", file],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error(`Failed to check ${file}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Syntax check passed for ${files.length} TypeScript files.`);
