# Схема знаний

## Evidence-кандидат — schema v3

Автоматический evidence-кандидат не является подтверждённым фактом.

```json
{
  "schemaVersion": 3,
  "id": "EVIDENCE-QIDI-COMMON-CHAT-593285",
  "sourceName": "qidi_common_chat",
  "threadId": "THREAD-QIDI-COMMON-CHAT-593285",
  "rootId": 593285,
  "topic": "print-defects",
  "messageIds": [593285, 593287],
  "authors": ["User", "Expert"],
  "kinds": ["question", "observation", "answer", "recommendation"],
  "status": "ready",
  "provisionalReliability": "D",
  "knowledgeValue": 0.82,
  "technicalScore": 12,
  "entities": {
    "materials": ["PETG"],
    "materialFamilies": ["PETG"],
    "primaryMaterialFamilies": ["PETG"],
    "printers": ["QIDI-Q2"],
    "components": ["layer-adhesion"],
    "brands": []
  },
  "parameters": [
    { "kind": "temperature", "value": "255 C", "messageId": 593287 }
  ],
  "flags": ["needs-editorial-verification", "answer-not-validated"],
  "sourceMessages": [
    {
      "id": 593285,
      "author": "User",
      "authorId": "user123",
      "date": "2026-01-01T12:00:00.000Z",
      "text": "...",
      "hasMedia": false
    },
    {
      "id": 593287,
      "author": "Expert",
      "authorId": "user456",
      "date": "2026-01-01T12:01:00.000Z",
      "replyTo": 593285,
      "text": "...",
      "hasMedia": false
    }
  ],
  "sourceExcerpt": "[593285] ..."
}
```

### Типы

- `question` — вопрос или запрос диагностики;
- `observation` — техническое наблюдение или измерение;
- `answer` — содержательный ответ внутри точной reply-цепочки;
- `recommendation` — предлагаемый шаг или настройка;
- `result` — явно описанный исход проверки;
- `configuration` — конфигурация, макрос или G-code;
- `reference` — внешняя ссылка.

### Статусы

- `ready` — найден ответ, результат, рекомендация или конфигурация;
- `question-only` — содержательный вопрос без ответа;
- `needs-context` — незавершённое наблюдение;
- `reference-only` — основное содержание находится по внешней ссылке.

### Предварительная надёжность

- `C` — собственный follow-up результат с явным исходом, параметрами в сообщении результата, техническими сущностями и без отсутствующего ключевого медиа;
- `D` — короткий ответ, рекомендация, чужой опыт, одиночное измерение, ссылка или незавершённый случай.

Пересказы производителя, поддержки, продавца и нейросети не получают `C`.

### Основные флаги

- `needs-editorial-verification`;
- `single-message`;
- `media-not-inspected`;
- `ai-generated-or-copied-claim`;
- `external-attributed-claim`;
- `commerce-reference`;
- `missing-answer`;
- `external-reference-only`;
- `insufficient-context`;
- `answer-not-validated`;
- `has-unverified-context-edges`.

## Knowledge-кластер — schema v2

Кластер является редакторской очередью, а не карточкой знания.

```json
{
  "schemaVersion": 2,
  "id": "KNOWLEDGE-PRINT-DEFECTS-ABC123DEF456",
  "title": "print-defects: PETG · QIDI-Q2 · layer-adhesion",
  "topic": "print-defects",
  "focusTags": ["layer-adhesion"],
  "scope": {
    "materials": ["PETG"],
    "printers": ["QIDI-Q2"],
    "components": ["layer-adhesion"],
    "brands": []
  },
  "status": "review-required",
  "automatedReliability": "unrated",
  "reviewPriority": "high",
  "supportEvidenceIds": ["EVIDENCE-..."],
  "cautionEvidenceIds": [],
  "unresolvedEvidenceIds": [],
  "sourceNames": ["qidi_common_chat", "qidi_q2_chat"],
  "sourceThreadIds": ["THREAD-..."],
  "sourceMessageIds": [1, 2, 3, 4],
  "independentSupportAuthors": ["user-a", "user-b"],
  "supportFingerprints": ["...", "..."],
  "parameterVariants": [],
  "flags": ["multi-source", "multi-author-support"]
}
```

### Роли evidence

- `support` — `ready`, человеческий содержательный ответ и отсутствие известных автоматических предостережений;
- `caution` — медиа, торговая/внешняя ссылка, нейросеть, внешний пересказ или автоматический бот-ответ;
- `unresolved` — вопрос без ответа или незавершённый случай.

### Приоритеты

- `high` — несколько источников, независимых авторов и разных ответов, высокая доля support и когерентные корневые случаи;
- `medium` — есть support, но не выполнены все условия high;
- `low` — нет support.

Приоритет определяет порядок ручного аудита и не является надёжностью.

## Проверенное доказательство

Редактор обязан:

- открыть исходные сообщения;
- подтвердить, что ответ относится к вопросу;
- проверить параметры и сущности;
- учесть фото/видео и внешние ссылки;
- отделить чужой пересказ от собственного опыта;
- отметить противоречия;
- назначить окончательный уровень.

## Уровни надёжности карточки

| Уровень | Значение |
|---|---|
| A | Официальный документ, измерение или воспроизводимый тест |
| B | Несколько независимых подтверждённых случаев |
| C | Один подробный собственный опыт с параметрами и исходом |
| D | Непроверенное предположение, совет или незавершённый случай |
| X | Опровергнуто или устарело |

Автоматический конвейер не назначает карточкам `A/B` и не публикует карточки без редакторской проверки.

## Контекстный граф

Предположительное ребро используется только для поиска соседнего контекста. Оно не входит в evidence автоматически, не склеивает цепочки и не является доказательством.
