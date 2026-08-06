# QIDI Wikier

Конвейер для превращения Telegram-выгрузок сообщества QIDI в проверяемую редакторскую базу знаний и компактный пакет для поиска через ChatGPT.

## Возможности версии 0.6.0

- потоковый разбор больших Telegram Desktop JSON;
- консервативное удаление флуда, объявлений, сервисных сообщений и пустых медиа;
- неизменяемые точные цепочки только по `reply_to_message_id`;
- отдельный нетранзитивный граф предположительных контекстных связей;
- извлечение материалов, принтеров, компонентов, брендов и технических параметров;
- evidence schema v3 с полным provenance каждого исходного сообщения;
- статусы `ready`, `question-only`, `needs-context`, `reference-only`;
- типы `question`, `observation`, `answer`, `recommendation`, `result`, `configuration`, `reference`;
- предварительные уровни только `C` и `D`; уровни `A/B` автоматически не назначаются;
- детерминированная агрегация evidence-кандидатов из нескольких источников;
- knowledge cluster schema v2 с ролями `support`, `caution`, `unresolved`;
- root-scoped тематическая область и строгая high-priority очередь;
- ChatGPT-ready экспорт со стартовой инструкцией, индексом, каталогом и тематическими Markdown-пакетами;
- сохранение Cluster ID, Evidence ID, thread ID, sourceName и message ID в поисковом пакете;
- анонимизация имён авторов в экспортированных метаданных;
- детерминированное разбиение слишком крупных тематических файлов;
- GitHub Actions CI и автономная обработка приватных LFS-выгрузок.

## Требования

- Node.js 22.6 или новее;
- исходные Telegram JSON на локальном диске.

Внешние npm-зависимости не используются.

## Обработка одного источника

```bash
npm run ingest -- \
  --input ./sources/qidi_common_chat.json \
  --output ./prepared/qidi_common_chat \
  --source-name qidi_common_chat \
  --min-evidence-value 0.6 \
  --review-sample-size 120
```

## Агрегация нескольких источников

```bash
npm run aggregate -- \
  --output ./prepared/combined \
  --review-sample-size 120 \
  ./prepared/qidi_common_chat/evidence/candidates.jsonl \
  ./prepared/qidi_q2_chat/evidence/candidates.jsonl \
  ./prepared/qidi_box_chat/evidence/candidates.jsonl \
  ./prepared/qidi_filament_chat/evidence/candidates.jsonl
```

## Экспорт пакета для ChatGPT

После агрегации:

```bash
npm run export-chat -- \
  --clusters ./prepared/combined/knowledge/clusters.jsonl \
  --output ./prepared/chat-ready \
  --max-file-chars 6000000 \
  --max-evidence-chars 3500 \
  ./prepared/qidi_common_chat/evidence/candidates.jsonl \
  ./prepared/qidi_q2_chat/evidence/candidates.jsonl \
  ./prepared/qidi_box_chat/evidence/candidates.jsonl \
  ./prepared/qidi_filament_chat/evidence/candidates.jsonl
```

Результат:

```text
prepared/chat-ready/
├── 00_START_HERE.md
├── 01_SEARCH_INSTRUCTIONS.md
├── 02_INDEX.md
├── catalog.jsonl
├── manifest.json
└── topics/
    ├── calibration.md
    ├── filaments.md
    ├── firmware-errors.md
    ├── general.md
    ├── hardware.md
    ├── mechanics.md
    ├── print-defects.md
    └── qidi-box.md
```

При превышении `--max-file-chars` тема разбивается на файлы с суффиксами `-01`, `-02` и далее. Каждый Cluster ID попадает ровно в один тематический файл.

Пакет сохраняет исходные формулировки сообщений, но не превращает сообщения сообщества в подтверждённые технические факты. `support`, `caution` и `unresolved` остаются отдельными разделами.

## Производные файлы основных слоёв

```text
prepared/
├── qidi_common_chat/
│   ├── manifest.json
│   ├── statistics.json
│   ├── chunks/*.md
│   ├── evidence/candidates.jsonl
│   ├── quarantine/uncertain_messages.jsonl
│   ├── review/context_graph.jsonl
│   ├── review/context_links_sample.md
│   ├── review/evidence_candidates_sample.md
│   └── skipped/removal_report.json
└── combined/
    ├── knowledge/clusters.jsonl
    ├── knowledge/statistics.json
    ├── knowledge/index.md
    └── review/knowledge_clusters_sample.md
```

`chunks` содержат только точные Telegram reply-цепочки. Контекстные рёбра не добавляют чужой текст внутрь цепочки и не влияют на последующие решения эвристики.

`evidence/candidates.jsonl` хранит evidence schema v3: источник, ID цепочки и сообщений, авторов и `authorId`, даты, reply-связи, исходный текст, медиа-флаг, извлечённые сущности, параметры, статус и обязательные флаги проверки.

`knowledge/clusters.jsonl` хранит review-очереди, а не утверждения. Кластер всегда имеет `status=review-required` и `automatedReliability=unrated`.

## Проверка

```bash
npm run check
npm test
```

CI запускает обе команды на всех ветках и pull request.

## Границы автоматизации

- Конвейер не определяет истинность технического совета.
- `support` означает только отсутствие известных автоматических предостережений, а не подтверждение факта.
- `high` означает приоритет ручной проверки, а не высокую надёжность знания.
- Фотографии и видео не анализируются.
- Контекстные рёбра не являются доказательствами.
- Имена авторов не выводятся в ChatGPT-ready metadata; вместо них используются стабильные анонимные псевдонимы.
- Публикуемая карточка знания появляется только после редакторской проверки evidence, противоречий и параметров.

Подробности: [архитектура](docs/ARCHITECTURE.md) и [схема знаний](docs/KNOWLEDGE_SCHEMA.md).
