import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareTelegramExport } from "../src/pipeline-v2.ts";

function message(id: number, seconds: number, from: string, text: string, replyTo = 1) {
  const date = new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));
  return {
    id,
    type: "message",
    date: date.toISOString(),
    date_unixtime: String(Math.floor(date.getTime() / 1000)),
    from,
    from_id: `user-${from}`,
    reply_to_message_id: replyTo,
    text,
    text_entities: [{ type: "plain", text }],
  };
}

test("links adjacent top-level messages while preserving unrelated discussions", async () => {
  const root = await mkdtemp(join(tmpdir(), "qidi-wikier-"));
  const input = join(root, "chat.json");
  const output = join(root, "prepared");
  const messages = [
    {
      id: 1,
      type: "service",
      date: "2026-01-01T12:00:00.000Z",
      date_unixtime: "1767268800",
      action: "topic_created",
      title: "QIDI",
      text: "",
    },
    message(10, 10, "Alex", "Печатаю ABS на QIDI Q2, слои расходятся. Температура сопла 250 C."),
    message(11, 50, "Boris", "Попробуй поднять температуру ABS до 265 C и выключить обдув."),
    message(12, 100, "Alex", "Поднял до 265 C, помогло: межслойная прочность стала заметно лучше."),
    message(20, 1800, "Seller", "Продам катушку, доставка через Авито."),
    message(30, 4000, "Clara", "Как настроить сушку QIDI BOX для PETG?"),
  ];
  await writeFile(input, JSON.stringify({ name: "fixture", type: "public_supergroup", id: 1, messages }), "utf8");

  await prepareTelegramExport({ input, output, sourceName: "fixture", maxChars: 50_000 });

  const statistics = JSON.parse(await readFile(join(output, "statistics.json"), "utf8"));
  assert.equal(statistics.threads, 2);
  assert.equal(statistics.inferredContextLinks, 2);
  assert.equal(statistics.removalCounts["marketplace-or-sale"], 1);
  assert.deepEqual(statistics.detectedTopicAnchors, [1]);

  const review = await readFile(join(output, "review", "context_links_sample.md"), "utf8");
  assert.match(review, /Проверка контекстных связей/);
  assert.match(review, /10 → 11/);

  const chunk = await readFile(join(output, "chunks", "fixture_001.md"), "utf8");
  assert.match(chunk, /контекстно связано с 10/);
  assert.match(chunk, /контекстно связано с 11/);
  assert.match(chunk, /THREAD-FIXTURE-30/);
});
