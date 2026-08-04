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
  const root = await mkdtemp(join(tmpdir(), "qidi-wikier-"));
  const input = join(root, "chat.json");
  const output = join(root, "prepared");
  const service = { id: 1, type: "service", date: "2026-01-01T12:00:00.000Z", date_unixtime: "1767268800", action: "topic_created", title: "QIDI", text: "" };
  await writeFile(input, JSON.stringify({ name: "fixture", type: "public_supergroup", id: 1, messages: [service, ...messages] }), "utf8");
  await prepareTelegramExport({ input, output, sourceName: "fixture", maxChars: 50_000, reviewSampleSize: 30 });
  return { output, statistics: JSON.parse(await readFile(join(output, "statistics.json"), "utf8")) };
}

test("keeps inferred relations as non-transitive graph edges", async () => {
  const { output, statistics } = await runFixture([
    message(10, 10, "Alex", "Печатаю ABS на QIDI Q2, слои расходятся. Температура сопла 250 C?"),
    message(11, 50, "Boris", "Попробуй поднять температуру ABS до 265 C: межслойная прочность должна стать лучше."),
    message(12, 100, "Alex", "Поднял температуру ABS до 265 C, помогло: межслойная прочность стала лучше."),
    message(20, 1800, "Seller", "Продам катушку через Авито."),
    message(30, 4000, "Clara", "Как настроить сушку QIDI BOX для PETG?"),
  ]);
  assert.equal(statistics.exactThreads, 4);
  assert.equal(statistics.inferredContextLinks, 2);
  assert.equal(statistics.removalCounts["marketplace-or-sale"], 1);
  assert.deepEqual(statistics.detectedTopicAnchors, [1]);
  const graph = (await readFile(join(output, "review", "context_graph.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(graph.map((edge) => [edge.linkedTo, edge.messageId]), [[10, 11], [10, 12]]);
  const chunk = await readFile(join(output, "chunks", "fixture_001.md"), "utf8");
  assert.match(chunk, /THREAD-FIXTURE-10/);
  assert.match(chunk, /THREAD-FIXTURE-11/);
  assert.match(chunk, /THREAD-FIXTURE-12/);
  assert.match(chunk, /Предположительные связи с другими цепочками/);
});

test("rejects unrelated nearby messages and cross-material collisions", async () => {
  const { output, statistics } = await runFixture([
    message(100, 10, "Alex", "Приложение просит обновить конфиг принтера. Как сохранить config.cfg перед прошивкой?"),
    message(101, 30, "Boris", "И намотка хорошая у катушки ABS."),
    message(110, 100, "Alex", "ABS CF Bestfilament печатаю 250/90/50, обдув 60 процентов."),
    message(111, 130, "Boris", "Кстати Resine от Filamentarno лучше печатается соплом 0.6 мм."),
  ]);
  assert.equal(statistics.exactThreads, 4);
  assert.equal(statistics.inferredContextLinks, 0);
  assert.equal(await readFile(join(output, "review", "context_graph.jsonl"), "utf8"), "");
});

test("accepts entity-grounded direct answers", async () => {
  const { output, statistics } = await runFixture([
    message(200, 10, "Alex", "Есть Nylon и PA12. Получается Nylon у производителя — это PA6?"),
    message(201, 30, "Boris", "Nylon — PA6."),
    message(210, 1000, "Alex", "Деталь из ABS легко разрушается по шву после печати. Что сделать?"),
    message(211, 1040, "Boris", "Перенеси шов на угол и проверь температуру ABS."),
    message(220, 2000, "Alex", "PETG намертво прилип к столу. Как потом снимать?"),
    message(221, 2030, "Boris", "Для PETG используй клей как разделительный слой, чтобы деталь потом отлипла."),
  ]);
  assert.equal(statistics.inferredContextLinks, 3);
  const graph = (await readFile(join(output, "review", "context_graph.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(graph.map((edge) => [edge.linkedTo, edge.messageId]).sort((a, b) => a[0] - b[0]), [[200, 201], [210, 211], [220, 221]]);
});

test("rejects ambiguous candidates", async () => {
  const { statistics } = await runFixture([
    message(300, 10, "Alex", "Как сушить ABS перед печатью?"),
    message(301, 20, "Boris", "Как сушить ABS перед печатью?"),
    message(302, 30, "Clara", "Суши ABS при 70 C несколько часов."),
  ]);
  assert.equal(statistics.inferredContextLinks, 0);
  assert.equal(statistics.contextGraphDiagnostics.rejectedAmbiguous, 1);
});

test("rejects printer conflicts and adjacent questions from different authors", async () => {
  const { statistics } = await runFixture([
    message(400, 10, "Alex", "Как настроить OPY на QIDI X-Max 3, если деталь отлипает при обдуве?"),
    message(401, 20, "Alex", "Печатаю PA66 OPY на QIDI Q1 Pro, камера 60 C и стол 100 C."),
    message(410, 100, "Boris", "Кто знает, почему Elegoo Rapid PETG даёт дырки в стенке?"),
    message(411, 120, "Clara", "Нужен совет: как напечатать образцы из PETG без артефактов?"),
  ]);
  assert.equal(statistics.inferredContextLinks, 0);
});

test("suppresses repeated top-level posts from the same author", async () => {
  const repeated = "Принтер QIDI Q1 Pro. Печатаю сферу PLA фирмы NIT. Почему в начале печати появляются дефекты, а дальше сфера нормальная?";
  const { statistics } = await runFixture([
    message(500, 10, "Alex", repeated),
    message(501, 20, "Alex", repeated),
  ]);
  assert.equal(statistics.inferredContextLinks, 0);
  assert.equal(statistics.contextGraphDiagnostics.rejectedDuplicate, 1);
});

test("suppresses paraphrased repeat questions and marketplace product posts", async () => {
  const { statistics } = await runFixture([
    message(600, 10, "Alex", "Всех приветствую! Скиньте форму и размеры металлической части датчика филамента для QIDI Q2, той что с пружинкой."),
    message(601, 30, "Alex", "Всех приветствую! Может кто скинуть форму и размеры металлической части датчика филамента для QIDI Q2?"),
    message(610, 50, "Seller", "PPS CF15, катушка 1 кг https://ozon.ru/t/example"),
  ]);
  assert.equal(statistics.exactThreads, 2);
  assert.equal(statistics.inferredContextLinks, 0);
  assert.equal(statistics.contextGraphDiagnostics.rejectedDuplicate, 1);
  assert.equal(statistics.removalCounts["marketplace-or-sale"], 1);
});

test("rejects a primary material topic shift despite incidental material mentions", async () => {
  const { statistics } = await runFixture([
    message(700, 10, "Alex", "Печатаю две вазы из PETG. Вторая не прилипает после калибровки стола. В чём причина?"),
    message(701, 40, "Alex", "Вдогонку другой вопрос. ASA первый раз печатаю, к PEI прилипает намертво. С PLA, PETG и ABS такой беды нет. Как ослабить адгезию ASA?"),
  ]);
  assert.equal(statistics.inferredContextLinks, 0);
});
