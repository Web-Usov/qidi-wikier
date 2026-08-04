import {
  CONTINUATION,
  QUESTION,
  detectTopics,
  extractKeywords,
  sharedKeywordCount,
  technicalScore,
} from "./classify.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface ContextOptions {
  contextWindowMinutes: number;
  sameAuthorWindowMinutes: number;
  minContextScore: number;
}

export interface InferredLink {
  messageId: number;
  linkedTo: number;
  score: number;
  reasons: string[];
}

export interface ThreadDraft {
  rootId: number;
  messages: NormalizedMessage[];
  inferredLinks: InferredLink[];
}

interface ContextScore {
  score: number;
  reasons: string[];
  linkedTo: number;
}

export function detectTopicAnchors(messages: NormalizedMessage[]): Set<number> {
  const replyCounts = new Map<number, number>();
  for (const message of messages) {
    if (!message.replyTo) continue;
    replyCounts.set(message.replyTo, (replyCounts.get(message.replyTo) ?? 0) + 1);
  }
  const threshold = Math.max(20, Math.ceil(messages.length * 0.01));
  return new Set([...replyCounts.entries()].filter(([, count]) => count >= threshold).map(([id]) => id));
}

export function findRootId(
  message: NormalizedMessage,
  byId: Map<number, NormalizedMessage>,
  topicAnchors: Set<number>,
): number {
  let current = message;
  const visited = new Set<number>([message.id]);
  while (current.replyTo && !topicAnchors.has(current.replyTo) && byId.has(current.replyTo) && !visited.has(current.replyTo)) {
    visited.add(current.replyTo);
    current = byId.get(current.replyTo) as NormalizedMessage;
  }
  return current.id;
}

function isTopLevelMessage(message: NormalizedMessage, topicAnchors: Set<number>): boolean {
  return !message.replyTo || topicAnchors.has(message.replyTo);
}

function scoreContextualLink(
  current: NormalizedMessage,
  candidate: ThreadDraft,
  options: ContextOptions,
): ContextScore | null {
  const last = candidate.messages.at(-1);
  const first = candidate.messages[0];
  if (!last || !first || current.unixTime < last.unixTime) return null;

  const gapSeconds = current.unixTime - last.unixTime;
  const sameAuthor = candidate.messages.slice(-6).some((message) =>
    Boolean(current.authorId && message.authorId && current.authorId === message.authorId) || current.author === message.author,
  );
  const regularWindow = options.contextWindowMinutes * 60;
  const authorWindow = options.sameAuthorWindowMinutes * 60;
  if (gapSeconds > (sameAuthor ? authorWindow : regularWindow)) return null;
  if (current.unixTime - first.unixTime > Math.max(authorWindow, regularWindow * 4)) return null;

  let score = 0;
  const reasons: string[] = [];
  if (gapSeconds <= 60) {
    score += 1.5;
    reasons.push("разрыв не более минуты");
  } else if (gapSeconds <= 180) {
    score += 1;
    reasons.push("разрыв не более трёх минут");
  } else if (gapSeconds <= regularWindow) {
    score += 0.5;
    reasons.push("сообщение в контекстном окне");
  }

  if (sameAuthor) {
    score += gapSeconds <= 180 ? 2 : 1.25;
    reasons.push("тот же автор уже участвовал в цепочке");
  }

  const currentTopics = detectTopics(current.text);
  const candidateText = candidate.messages.map((message) => message.text).join("\n");
  const candidateTopics = detectTopics(candidateText);
  const sharedTopics = currentTopics.filter((topic) => candidateTopics.includes(topic));
  if (sharedTopics.length > 0) {
    score += 1.5 + Math.min(0.5, (sharedTopics.length - 1) * 0.25);
    reasons.push(`общая тема: ${sharedTopics.join(", ")}`);
  } else if (currentTopics.length === 0 || candidateTopics.length === 0) {
    score += 0.25;
  }

  const currentKeywords = extractKeywords(current.text);
  const candidateKeywords = extractKeywords(candidate.messages.slice(-4).map((message) => message.text).join("\n"));
  const shared = sharedKeywordCount(currentKeywords, candidateKeywords);
  if (shared >= 3) {
    score += 2.5;
    reasons.push(`совпало ключевых слов: ${shared}`);
  } else if (shared === 2) {
    score += 1.5;
    reasons.push("совпало два ключевых слова");
  } else if (shared === 1) {
    score += 0.5;
    reasons.push("совпало одно ключевое слово");
  }

  const recentText = candidate.messages.slice(-3).map((message) => message.text).join("\n");
  const currentIsTechnical = technicalScore(current) > 0;
  const recentCandidateIsTechnical = candidate.messages.slice(-3).some((message) => technicalScore(message) > 0);
  if (!currentIsTechnical && !recentCandidateIsTechnical && shared < 2) return null;

  if (QUESTION.test(recentText) && !QUESTION.test(current.text) && (CONTINUATION.test(current.text) || current.text.length <= 300)) {
    score += 1.5;
    reasons.push("похоже на ответ на предыдущий вопрос");
  }
  if (CONTINUATION.test(current.text)) {
    score += 0.75;
    reasons.push("фраза продолжает предыдущий контекст");
  }

  if (gapSeconds > regularWindow && shared < 2 && !CONTINUATION.test(current.text)) return null;
  if (score < options.minContextScore) return null;
  return { score, reasons, linkedTo: last.id };
}

export function mergeContextualSingletons(
  groups: ThreadDraft[],
  topicAnchors: Set<number>,
  options: ContextOptions,
): ThreadDraft[] {
  const ordered = [...groups].sort((a, b) => a.messages[0]!.unixTime - b.messages[0]!.unixTime || a.rootId - b.rootId);
  const merged: ThreadDraft[] = [];

  for (const group of ordered) {
    const current = group.messages[0];
    const canInfer = group.messages.length === 1 && current && isTopLevelMessage(current, topicAnchors);
    if (!canInfer) {
      merged.push(group);
      continue;
    }

    let bestIndex = -1;
    let best: ContextScore | null = null;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const candidate = merged[index];
      const candidateLast = candidate.messages.at(-1);
      if (!candidateLast) continue;
      const widestWindow = Math.max(options.contextWindowMinutes, options.sameAuthorWindowMinutes) * 60;
      if (current.unixTime - candidateLast.unixTime > widestWindow) break;
      const result = scoreContextualLink(current, candidate, options);
      if (result && (!best || result.score > best.score)) {
        best = result;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && best) {
      const target = merged[bestIndex];
      target.messages.push(current);
      target.messages.sort((a, b) => a.unixTime - b.unixTime || a.id - b.id);
      target.inferredLinks.push({
        messageId: current.id,
        linkedTo: best.linkedTo,
        score: Number(best.score.toFixed(2)),
        reasons: best.reasons,
      });
    } else {
      merged.push(group);
    }
  }

  return merged;
}
