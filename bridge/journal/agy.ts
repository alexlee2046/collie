// Antigravity CLI 1.3.5: brain/<session UUID>/.system_generated/logs/transcript.jsonl.
// Observed schema only; no cwd/latest-session guessing. GENERIC rows have no tool-call id,
// so their output stays a note rather than being attached to an inferred preceding call.
import { join } from "node:path";
import type { JsonValue } from "../json.ts";
import { containedRealpath, loadTail, readSinceFile, rootList, statFile } from "./files.ts";
import { createUnknownCounter, NO_CHANGE, noQueue, rememberPending, type RowReducer } from "./reduce.ts";
import { clamp, MAX_TEXT_CHARS, stripAnsi, summarizeToolInput } from "./text.ts";
import { classifyToolCall } from "./tool-call.ts";
import type { AgentSessionRef, JournalAdapter, TranscriptEntry, TranscriptPart, TranscriptSource } from "./types.ts";

export function createAgyReducer(): RowReducer {
  const unknown = createUnknownCounter({
    rows: ["USER_INPUT", "PLANNER_RESPONSE", "GENERIC", "SYSTEM_MESSAGE", "CHECKPOINT"],
    roles: [], parts: [],
  });
  // Keep only a bounded recent step index: otherwise trimmed live turns retain their full bodies
  // here forever. A step repeated after eviction is re-emitted; the live window upserts by uuid.
  const entries = new Map<string, TranscriptEntry>();
  return {
    queued: noQueue,
    unknowns: unknown.tally,
    push(line) {
      let row: JsonValue;
      try {
        // SAFETY: JSON.parse produces JSON values; object and field guards follow.
        row = JSON.parse(line) as JsonValue;
      } catch { return NO_CHANGE; }
      if (row === null || typeof row !== "object" || Array.isArray(row)) return NO_CHANGE;
      unknown.row(row.type);
      if (typeof row.step_index !== "number" || !Number.isSafeInteger(row.step_index) || row.step_index < 0) return NO_CHANGE;
      const role = row.type === "USER_INPUT" ? "user" : row.type === "PLANNER_RESPONSE" ? "assistant"
        : row.type === "GENERIC" ? "note" : undefined;
      // System messages/checkpoints are agent plumbing, not human speech.
      if (role === undefined) return NO_CHANGE;
      const parts: TranscriptPart[] = [];
      if (typeof row.content === "string" && row.content.trim() !== "") {
        const clipped = clamp(stripAnsi(row.content), MAX_TEXT_CHARS);
        if (Array.isArray(row.truncated_fields) && row.truncated_fields.includes("content")) clipped.truncated = true;
        parts.push({ kind: "text", ...clipped });
      }
      // Thinking is intentionally not exposed; the adapter serves committed conversation text.
      if (role === "assistant" && Array.isArray(row.tool_calls)) {
        for (const tool of row.tool_calls) {
          if (tool === null || typeof tool !== "object" || Array.isArray(tool) || typeof tool.name !== "string") continue;
          const summary = summarizeToolInput(tool.args);
          parts.push({ kind: "tool", name: tool.name, summary, call: classifyToolCall(tool.name, tool.args, summary) });
        }
      }
      if (parts.length === 0) return NO_CHANGE;
      const uuid = `agy-${row.step_index}`;
      const ts = typeof row.created_at === "string" ? row.created_at : "";
      const previous = entries.get(uuid);
      if (previous !== undefined) {
        previous.parts = parts;
        previous.ts = ts;
        previous.role = role;
        return { added: [], changed: [uuid] };
      }
      const entry: TranscriptEntry = { uuid, ts, role, parts };
      rememberPending(entries, uuid, entry);
      return { added: [entry], changed: [] };
    },
  };
}

export function parseAgyTranscript(text: string): TranscriptEntry[] {
  const reducer = createAgyReducer();
  // History retains the whole bounded input, unlike the live reducer's recent-step index.
  // Re-emitted steps must replace their earlier value without moving their cursor position.
  const entries = new Map<string, TranscriptEntry>();
  for (const line of text.split("\n")) {
    for (const entry of reducer.push(line).added) entries.set(entry.uuid, entry);
  }
  return [...entries.values()];
}

export class AgyTranscriptSource implements TranscriptSource {
  private readonly roots: string[];
  constructor(roots: string | readonly string[]) { this.roots = rootList(roots); }
  async resolve(ref: AgentSessionRef): Promise<string | null> {
    if (ref.kind !== "id" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.value)) return null;
    for (const root of this.roots) {
      const path = await containedRealpath(join(root, ref.value, ".system_generated", "logs", "transcript.jsonl"), root);
      if (path !== null) return path;
    }
    return null;
  }
  stat = statFile;
  load = loadTail;
  readSince = readSinceFile;
}

export function agyJournal(roots: string | readonly string[]): JournalAdapter {
  return { agent: "agy", source: new AgyTranscriptSource(roots), parse: parseAgyTranscript, reducer: createAgyReducer };
}
