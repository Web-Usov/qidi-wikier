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
  const root = await mkdtemp(join(tmpdir(), "qidi-wikier-evidence-"));
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
  return {
    output,
    statistics: JSON.parse(await readFile(join(output, "statistics.json"), "utf8")),
    candidates: raw ? raw.split("\n").map(JSON.parse) : [],
  };
}

test("extracts ready evidence with exact parameters and provisional C reliability", async () => {
  const { candidates, statistics, output } = await runFixture([
    message(10, 10, "Alex", "Печатаю PETG на QIDI Q2: сопло 240 C, стол 80 C, скорость 100 мм/с. Межслойка слабая, что проверить?"),
    message(11, 30, "Alex", "Поднял сопло до 255 C и снизил скорость до 70 мм/с. После этого межслойка стала лучше, проверил на трёх деталях.", 10),
  ]);

  assert.equal(statistics.schemaVersion, 4);
  assert.equal(statistics.evidenceCandidates, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].schemaVersion, 2);
  assert.equal(candidates[0].status, "ready");
  assert.equal(candidates[0].provisionalReliability, "C");
  assert.ok(candidates[0].kinds.includes("result"));
  assert.ok(candidates[0].parameters.some((parameter: { value: string }) => parameter.value.includes("255")));
  assert.match(await readFile(join(output, "review", "evidence_candidates_sample.md"), "utf8"), /EVIDENCE-FIXTURE-10/);
});

test("keeps detailed unanswered questions separate from evidence-ready cases", async () => {
  const { candidates } = await runFixture([
    message(20, 10, "Alex", "Почему QIDI Q2 при печати ABS на 260 C и столе 105 C даёт трещины между слоями после высоты 40 мм? Камера держится около 55 C."),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "question-only");
  assert.equal(candidates[0].provisionalReliability, "D");
  assert.ok(candidates[0].flags.includes("missing-answer"));
});

test("marks copied AI claims as unverified D evidence", async () => {
  const { candidates } = await runFixture([
    message(30, 10, "Alex", "DeepSeek говорит, что PLA в закрытой камере при 45 C всегда размягчается до экструдера и вызывает пробку. Температура сопла 215 C."),
    message(31, 30, "Alex", "Рекомендует открыть крышку и дверь принтера.", 30),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provisionalReliability, "D");
  assert.ok(candidates[0].flags.includes("ai-generated-or-copied-claim"));
});

test("recognizes terse direct replies as answers", async () => {
  const { candidates } = await runFixture([
    message(40, 10, "Alex", "На QIDI Q2 после отключения света пластик не идёт. Продолжить печать уже не получится?"),
    message(41, 20, "Boris", "Уже нет", 40),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "ready");
  assert.ok(candidates[0].kinds.includes("answer"));
  assert.ok(candidates[0].flags.includes("answer-not-validated"));
  assert.equal(candidates[0].provisionalReliability, "D");
});

test("does not treat URL query strings as questions or parameters", async () => {
  const { candidates } = await runFixture([
    message(50, 10, "Alex", "Настройки PA6: https://wiki.qidi-russia.ru/%D0%9F%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D1%8C?x=1"),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "reference-only");
  assert.ok(!candidates[0].kinds.includes("question"));
  assert.deepEqual(candidates[0].parameters, []);
});

test("suppresses low-information advice fragments and moderation messages", async () => {
  const { candidates } = await runFixture([
    message(60, 10, "Moderator", "Пользователь @linkey предупреждён (3 из 3) • Причина: настройки печати • Действие: Ограничен 🔇"),
    message(61, 20, "Alex", "А попробуй прочитать о чем говорит принтер)"),
  ]);

  assert.equal(candidates.length, 0);
});

test("keeps single-message measurements at provisional D reliability", async () => {
  const { candidates } = await runFixture([
    message(70, 10, "Alex", "Сейчас проверил деталь на QIDI Q2: в модели 4,5 мм, по факту получилось 4,64 мм."),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "ready");
  assert.equal(candidates[0].provisionalReliability, "D");
  assert.ok(candidates[0].flags.includes("single-message"));
});

test("does not award C reliability to another author's anecdotal result", async () => {
  const { candidates } = await runFixture([
    message(80, 10, "Alex", "Какие сопла ставите на QIDI Q1 Pro для композитов? Родное прошло 900 часов?"),
    message(81, 20, "Boris", "Печатаю композитами на родном сопле при 280 C, после 1000 часов качество осталось нормальным.", 80),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "ready");
  assert.ok(candidates[0].kinds.includes("answer"));
  assert.equal(candidates[0].provisionalReliability, "D");
});
