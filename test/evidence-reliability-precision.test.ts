import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareTelegramExport } from "../src/pipeline.ts";

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

async function runFixture(messages: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "qidi-wikier-c-precision-"));
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
  await writeFile(input, JSON.stringify({ name: "fixture", type: "public_supergroup", id: 1, messages: [service, ...messages] }), "utf8");
  await prepareTelegramExport({ input, output, sourceName: "fixture", maxChars: 50_000, reviewSampleSize: 30 });
  const raw = (await readFile(join(output, "evidence", "candidates.jsonl"), "utf8")).trim();
  return raw ? raw.split("\n").map(JSON.parse) : [];
}

test("does not treat a numbered procedural sequence as an outcome", async () => {
  const candidates = await runFixture([
    message(10, 10, "Alex", "Почему QIDI Q2 долго начинает печать? Сопло 240 C, стол 80 C."),
    message(11, 20, "Alex", "После этого вызывается EXTRUSION_AND_FLUSH, которая выдавливает пруток ещё 4 раза. Затем команда CUT_FILAMENT вызывается в начале старта.", 10),
  ]);
  assert.equal(candidates.length, 1);
  assert.ok(!candidates[0].kinds.includes("result"));
  assert.equal(candidates[0].provisionalReliability, "D");
});

test("does not award C to an unfinished parameter experiment", async () => {
  const candidates = await runFixture([
    message(20, 10, "Alex", "На PETG мосты получаются волнами. Сопло 240 C, стол 80 C. Что изменить?"),
    message(21, 20, "Alex", "Скорости проверил, поставил 20 мм/с для мостов. Поток не трогал, попробую ещё толстые мосты.", 20),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provisionalReliability, "D");
});

test("keeps a parameterized explicit outcome eligible for C", async () => {
  const candidates = await runFixture([
    message(30, 10, "Alex", "QIDI BOX очень шумит при ретракте. Скорость 40 мм/с. Что проверить?"),
    message(31, 20, "Alex", "Помогло уменьшение скорости ретракта до 20 мм/с. Проверил несколько раз, бокс стал заметно тише.", 30),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provisionalReliability, "C");
});
