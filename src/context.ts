import {
  QUESTION,
  STRONG_CONTINUATION,
  TOPIC_SHIFT,
  WEAK_CONTINUATION,
  detectTopics,
  extractKeywords,
  isMediaOnly,
  knowledgeValue,
  sharedKeywordCount,
  technicalScore,
} from "./classify.ts";
import {
  entityIntersection,
  entityProfilesConflict,
  extractEntities,
  type EntityProfile,
} from "./entities.ts";
import type { NormalizedMessage } from "./telegram.ts";

export interface ContextOptions {
  contextWindowMinutes: number;
  sameAuthorWindowMinutes: number;
  minContextScore: number;
  minScoreMargin: number;
}

export interface ContextEdge {
  messageId: number;
  sourceRootId: number;
  linkedTo: number;
  targetRootId: number;
  score: number;
  scoreMargin: number | null;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  conflicts: string[];
  sharedEntities: Record<string, string[]>;
  sourceKnowledgeValue: number;
  targetKnowledgeValue: number;
}

export interface ThreadDraft {
  rootId: number;
  messages: NormalizedMessage[];
}

export interface ContextGraphDiagnostics {
  consideredRoots: number;
  rejectedMediaOnly: number;
  rejectedNoSemanticAnchor: number;
  rejectedBelowThreshold: number;
  rejectedAmbiguous: number;
}

export interface ContextGraphResult {
  edges: ContextEdge[];
  diagnostics: ContextGraphDiagnostics;
}

interface CandidateScore {
  score: number;
  reasons: string[];
  conflicts: string[];
  sharedEntities: Record<string, string[]>;
  target: ThreadDraft;
  targetMessage: NormalizedMessage;
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

function isTopLevelRoot(message: NormalizedMessage, topicAnchors: Set<number>): boolean {
  return !message.replyTo || topicAnchors.has(message.replyTo);
}

function sameAuthor(a: NormalizedMessage, b: NormalizedMessage): boolean {
  if (a.authorId && b.authorId) return a.authorId === b.authorId;
  return a.author === b.author;
}

function entitySignals(current: EntityProfile, previous: EntityProfile): {
  score: number;
  reasons: string[];
  shared: Record<string, string[]>;
  conflicts: string[];
  semanticAnchor: boolean;
} {
  let score = 0;
  const reasons: string[] = [];
  const shared: Record<string, string[]> = {};
  const exactMaterials = entityIntersection(current.materials, previous.materials);
  const materialFamilies = entityIntersection(current.materialFamilies, previous.materialFamilies);
  const printers = entityIntersection(current.printers, previous.printers);
  const components = entityIntersection(current.components, previous.components);
  const brands = entityIntersection(current.brands, previous.brands);
  const genericComponents = new Set(["temperature", "speed", "bed", "cooling", "firmware-config"]);
  const strongComponents = components.filter((component) => !genericComponents.has(component));
  const weakComponents = components.filter((component) => genericComponents.has(component));

  if (exactMaterials.length) {
    score += 2.5;
    shared.materials = exactMaterials;
    reasons.push(`совпал материал: ${exactMaterials.join(", ")}`);
  } else if (materialFamilies.length) {
    score += 1.2;
    shared.materialFamilies = materialFamilies;
    reasons.push(`совпало семейство материала: ${materialFamilies.join(", ")}`);
  }
  if (printers.length) {
    score += 0.25;
    shared.printers = printers;
    reasons.push(`совпал принтер (слабый признак): ${printers.join(", ")}`);
  }
  if (strongComponents.length) {
    score += Math.min(2.6, 1.6 + (strongComponents.length - 1) * 0.5);
    shared.components = strongComponents;
    reasons.push(`совпали специфичные компоненты/симптомы: ${strongComponents.join(", ")}`);
  }
  if (weakComponents.length) {
    score += Math.min(0.6, weakComponents.length * 0.3);
    shared.genericComponents = weakComponents;
    reasons.push(`совпали общие технические признаки: ${weakComponents.join(", ")}`);
  }
  if (brands.length) {
    score += 1.25;
    shared.brands = brands;
    reasons.push(`совпал бренд: ${brands.join(", ")}`);
  }

  const conflicts = entityProfilesConflict(current, previous);
  for (const conflict of conflicts) score -= conflict.startsWith("разные материалы") ? 1.5 : 0.75;
  return {
    score,
    reasons,
    shared,
    conflicts,
    semanticAnchor: exactMaterials.length > 0 || materialFamilies.length > 0 || strongComponents.length > 0 || brands.length > 0,
  };
}

function scoreCandidate(
  current: NormalizedMessage,
  target: ThreadDraft,
  options: ContextOptions,
): CandidateScore | null {
  const previous = target.messages[0];
  if (!previous || previous.unixTime >= current.unixTime || isMediaOnly(previous) || isMediaOnly(current)) return null;
  const gapSeconds = current.unixTime - previous.unixTime;
  const authorMatches = sameAuthor(current, previous);
  const maxWindow = (authorMatches ? options.sameAuthorWindowMinutes : options.contextWindowMinutes) * 60;
  if (gapSeconds > maxWindow) return null;

  let score = 0;
  const reasons: string[] = [];
  if (gapSeconds <= 60) {
    score += 1.2;
    reasons.push("разрыв не более минуты");
  } else if (gapSeconds <= 180) {
    score += 0.8;
    reasons.push("разрыв не более трёх минут");
  } else if (gapSeconds <= options.contextWindowMinutes * 60) {
    score += 0.25;
    reasons.push("сообщение в контекстном окне");
  }

  if (authorMatches) {
    if (gapSeconds <= 180) score += 0.5;
    else if (gapSeconds <= 600) score += 0.2;
    else score += 0.05;
    reasons.push("тот же непосредственный автор");
  }

  const entityResult = entitySignals(extractEntities(current.text), extractEntities(previous.text));
  score += entityResult.score;
  reasons.push(...entityResult.reasons);

  const currentKeywords = extractKeywords(current.text);
  const previousKeywords = extractKeywords(previous.text);
  const sharedKeywords = sharedKeywordCount(currentKeywords, previousKeywords);
  if (sharedKeywords >= 3) {
    score += 2;
    reasons.push(`совпало ключевых слов: ${sharedKeywords}`);
  } else if (sharedKeywords === 2) {
    score += 1.2;
    reasons.push("совпало два ключевых слова");
  } else if (sharedKeywords === 1) {
    score += 0.3;
    reasons.push("совпало одно ключевое слово");
  }

  const currentTopics = detectTopics(current.text);
  const previousTopics = detectTopics(previous.text);
  const sharedTopics = currentTopics.filter((topic) => previousTopics.includes(topic));
  if (sharedTopics.length) {
    score += 0.35;
    reasons.push(`общая широкая тема: ${sharedTopics.join(", ")}`);
  }

  if (QUESTION.test(previous.text) && QUESTION.test(current.text) && !authorMatches) return null;
  const strongContinuation = STRONG_CONTINUATION.test(current.text);
  const weakContinuation = WEAK_CONTINUATION.test(current.text);
  const directQuestionAnswer = QUESTION.test(previous.text) && !QUESTION.test(current.text) && (entityResult.semanticAnchor || sharedKeywords >= 2);
  if (directQuestionAnswer) {
    score += 1.25;
    reasons.push("семантически связанный ответ на вопрос");
  }
  if (strongContinuation && authorMatches && gapSeconds <= 600) {
    score += 1.5;
    reasons.push("сильный маркер результата или продолжения");
  } else if (weakContinuation) {
    score += 0.15;
    reasons.push("слабый языковой маркер продолжения");
  }
  if (TOPIC_SHIFT.test(current.text)) {
    score -= 0.75;
    reasons.push("возможная смена темы");
  }

  const semanticAnchor = entityResult.semanticAnchor || sharedKeywords >= 2;
  const sameAuthorContinuation = authorMatches && strongContinuation && gapSeconds <= 600;
  if (!semanticAnchor && !directQuestionAnswer && !sameAuthorContinuation) return null;

  const currentTechnical = technicalScore(current) > 0;
  const previousTechnical = technicalScore(previous) > 0;
  if (!currentTechnical && !previousTechnical && knowledgeValue(current) < 0.2 && knowledgeValue(previous) < 0.2) return null;

  return {
    score,
    reasons,
    conflicts: entityResult.conflicts,
    sharedEntities: entityResult.shared,
    target,
    targetMessage: previous,
  };
}

function confidenceFor(score: number): ContextEdge["confidence"] {
  if (score >= 6.5) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function inferContextGraph(
  groups: ThreadDraft[],
  topicAnchors: Set<number>,
  options: ContextOptions,
): ContextGraphResult {
  const roots = groups
    .filter((group) => group.messages[0] && isTopLevelRoot(group.messages[0], topicAnchors))
    .sort((a, b) => a.messages[0]!.unixTime - b.messages[0]!.unixTime || a.rootId - b.rootId);
  const diagnostics: ContextGraphDiagnostics = {
    consideredRoots: roots.length,
    rejectedMediaOnly: 0,
    rejectedNoSemanticAnchor: 0,
    rejectedBelowThreshold: 0,
    rejectedAmbiguous: 0,
  };
  const edges: ContextEdge[] = [];
  const widestWindow = Math.max(options.contextWindowMinutes, options.sameAuthorWindowMinutes) * 60;

  for (let sourceIndex = 0; sourceIndex < roots.length; sourceIndex += 1) {
    const source = roots[sourceIndex]!;
    const current = source.messages[0]!;
    if (isMediaOnly(current)) {
      diagnostics.rejectedMediaOnly += 1;
      continue;
    }
    const scored: CandidateScore[] = [];
    let hadWindowCandidate = false;
    for (let targetIndex = sourceIndex - 1; targetIndex >= 0; targetIndex -= 1) {
      const target = roots[targetIndex]!;
      const previous = target.messages[0]!;
      const gap = current.unixTime - previous.unixTime;
      if (gap > widestWindow) break;
      hadWindowCandidate = true;
      const result = scoreCandidate(current, target, options);
      if (result) scored.push(result);
    }
    if (!scored.length) {
      if (hadWindowCandidate) diagnostics.rejectedNoSemanticAnchor += 1;
      continue;
    }
    scored.sort((a, b) => b.score - a.score || b.targetMessage.unixTime - a.targetMessage.unixTime);
    const best = scored[0]!;
    const second = scored[1];
    if (best.score < options.minContextScore) {
      diagnostics.rejectedBelowThreshold += 1;
      continue;
    }
    const margin = second ? best.score - second.score : null;
    if (margin !== null && margin < options.minScoreMargin && best.score < 6.5) {
      diagnostics.rejectedAmbiguous += 1;
      continue;
    }
    edges.push({
      messageId: current.id,
      sourceRootId: source.rootId,
      linkedTo: best.targetMessage.id,
      targetRootId: best.target.rootId,
      score: Number(best.score.toFixed(2)),
      scoreMargin: margin === null ? null : Number(margin.toFixed(2)),
      confidence: confidenceFor(best.score),
      reasons: best.reasons,
      conflicts: best.conflicts,
      sharedEntities: best.sharedEntities,
      sourceKnowledgeValue: knowledgeValue(current),
      targetKnowledgeValue: knowledgeValue(best.targetMessage),
    });
  }

  return { edges, diagnostics };
}
