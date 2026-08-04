import { createReadStream } from "node:fs";

export interface TelegramMessageRaw {
  id?: number;
  type?: string;
  date?: string;
  date_unixtime?: string;
  from?: string | null;
  from_id?: string | null;
  author?: string | null;
  reply_to_message_id?: number;
  text?: unknown;
  text_entities?: unknown[];
  file_name?: string;
  mime_type?: string;
  photo?: string;
  file?: string;
  forwarded_from?: string;
  reactions?: Array<{ count?: number }>;
  action?: string;
  title?: string;
}

export interface NormalizedMessage {
  id: number;
  type: string;
  date: string;
  unixTime: number;
  author: string;
  authorId: string;
  replyTo?: number;
  text: string;
  fileName?: string;
  mimeType?: string;
  hasMedia: boolean;
  reactionCount: number;
}

/**
 * Streams objects from Telegram Desktop's top-level `messages` array.
 * It keeps only one JSON object buffer at a time, so exports may be very large.
 */
export async function* streamTelegramMessages(
  filePath: string,
): AsyncGenerator<TelegramMessageRaw> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let phase: "find_messages" | "find_array" | "read_array" | "done" = "find_messages";
  let probe = "";
  let collecting = false;
  let objectBuffer = "";
  let objectDepth = 0;
  let inString = false;
  let escaped = false;

  for await (const chunk of stream) {
    for (const char of chunk) {
      if (phase === "find_messages") {
        probe = (probe + char).slice(-32);
        if (/"messages"\s*:\s*$/.test(probe)) phase = "find_array";
        continue;
      }

      if (phase === "find_array") {
        if (/\s/.test(char)) continue;
        if (char !== "[") throw new Error("Expected messages array in Telegram export");
        phase = "read_array";
        continue;
      }

      if (phase !== "read_array") continue;

      if (!collecting) {
        if (/\s|,/.test(char)) continue;
        if (char === "]") {
          phase = "done";
          break;
        }
        if (char !== "{") throw new Error(`Unexpected token in messages array: ${char}`);
        collecting = true;
        objectBuffer = "{";
        objectDepth = 1;
        inString = false;
        escaped = false;
        continue;
      }

      objectBuffer += char;

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        objectDepth += 1;
      } else if (char === "}") {
        objectDepth -= 1;
        if (objectDepth === 0) {
          collecting = false;
          try {
            yield JSON.parse(objectBuffer) as TelegramMessageRaw;
          } catch (error) {
            throw new Error(
              `Failed to parse Telegram message object: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          objectBuffer = "";
        }
      }
    }
    if (phase === "done") break;
  }

  if (phase === "find_messages") throw new Error('Top-level "messages" field was not found');
  if (collecting || objectDepth !== 0) throw new Error("Telegram export ended inside a message object");
}

export function flattenTelegramText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenTelegramText).join("");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("text" in record) return flattenTelegramText(record.text);
  }
  return "";
}

export function normalizeMessage(raw: TelegramMessageRaw): NormalizedMessage | null {
  if (!Number.isInteger(raw.id)) return null;

  const text = flattenTelegramText(raw.text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const hasMedia = Boolean(raw.photo || raw.file || raw.file_name);
  const fileHint = raw.file_name ? `[Вложение: ${raw.file_name}]` : "";
  const combinedText = [text, fileHint].filter(Boolean).join("\n").trim();

  return {
    id: raw.id as number,
    type: raw.type ?? "message",
    date: raw.date ?? "",
    unixTime: Number(raw.date_unixtime ?? Date.parse(raw.date ?? "") / 1000) || 0,
    author: raw.from ?? raw.author ?? raw.forwarded_from ?? "Неизвестный участник",
    authorId: raw.from_id ?? "",
    replyTo: Number.isInteger(raw.reply_to_message_id) ? raw.reply_to_message_id : undefined,
    text: combinedText,
    fileName: raw.file_name,
    mimeType: raw.mime_type,
    hasMedia,
    reactionCount: (raw.reactions ?? []).reduce((sum, reaction) => sum + (reaction.count ?? 0), 0),
  };
}
