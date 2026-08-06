import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareTelegramExport } from "../src/pipeline.ts";

function message(id: number, seconds: number, from: string, text: string) {
  const date = new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));
  return {
    id,
    type: "message",
    date: date.toISOString(),
    date_unixtime: String(Math.floor(date.getTime() / 1000)),
    from,
    from_id: `user-${from}`,
    reply_to_message_id: 1,
    text,
    text_entities: [{ type: "plain", text }],
  };
}

async function runFixture(messages: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "qidi-wikier-context-regression-"));
  const input = join(root, "chat.json");
  const output = join(root, "prepared");
  const service = {
    id: 1,
    type: "service",
    date: "2026-01-01T12:00:00.000Z",
    date_unixtime: "1767268800",
    action: "topic_created",
    title: "QIDI",
    text: "",
  };
  await writeFile(
    input,
    JSON.stringify({ name: "fixture", type: "public_supergroup", id: 1, messages: [service, ...messages] }),
    "utf8",
  );
  await prepareTelegramExport({ input, output, sourceName: "fixture", maxChars: 50_000, reviewSampleSize: 30 });
  return {
    statistics: JSON.parse(await readFile(join(output, "statistics.json"), "utf8")),
    graph: await readFile(join(output, "review", "context_graph.jsonl"), "utf8"),
  };
}

test("rejects accidental matches built only from generic conversational words", async () => {
  const { statistics, graph } = await runFixture([
    message(800, 10, "Alex", "Кто может подсказать про печать X-Max 3: кашу постоянно печатает после калибровки, будто вообще не хочет клеиться."),
    message(801, 30, "Boris", "На ноутбуке сканер постоянно терял метки, качество было плохое, будто вообще другое устройство. На Mac всё заработало лучше."),
    message(810, 50, "Seller", "На али официальные сопла стоят 2500 рублей."),
  ]);

  assert.equal(statistics.inferredContextLinks, 0);
  assert.equal(statistics.removalCounts["marketplace-or-sale"], 1);
  assert.equal(graph, "");
});
