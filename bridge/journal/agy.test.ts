import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgyTranscriptSource, createAgyReducer, parseAgyTranscript } from "./agy.ts";
import { PENDING_MAX } from "./reduce.ts";

const row = (step_index: number, type: string, fields = {}) => JSON.stringify({ step_index, type, status: "DONE", created_at: "2026-10-15T00:00:00Z", ...fields });
const id = "11111111-2222-4333-8444-555555555555";
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("agy transcript", () => {
  test("reads speech and tool calls without exposing system or thinking text", () => {
    const entries = parseAgyTranscript([
      row(0, "SYSTEM_MESSAGE", { content: "private plumbing" }),
      row(1, "USER_INPUT", { content: "Synthetic question" }),
      row(2, "PLANNER_RESPONSE", { content: "Synthetic answer", thinking: "private reasoning", tool_calls: [{ name: "read_file", args: { path: "fixture.txt" } }] }),
      row(3, "GENERIC", { content: "Synthetic output" }),
      row(4, "CHECKPOINT", { content: "private checkpoint" }),
    ].join("\n"));
    expect(entries.map(e => e.role)).toEqual(["user", "assistant", "note"]);
    expect(entries[1]!.parts.map(p => p.kind)).toEqual(["text", "tool"]);
    expect(JSON.stringify(entries)).not.toContain("private");
    expect(entries[2]!.parts).toEqual([{ kind: "text", text: "Synthetic output" }]);
  });
  test("skips malformed rows and keeps stable step cursors under a bounded tail", () => {
    const text = ["null", "{", row(-1, "USER_INPUT", { content: "bad" }), row(7, "USER_INPUT", { content: "same" }), row(8, "USER_INPUT", { content: "same" })].join("\n");
    expect(parseAgyTranscript(text).map(e => e.uuid)).toEqual(["agy-7", "agy-8"]);
    expect(parseAgyTranscript(row(8, "USER_INPUT", { content: "same" }))[0]!.uuid).toBe("agy-8");
  });
  test("reports a repeated step as an update rather than a duplicated turn", () => {
    const reducer = createAgyReducer();
    const entry = reducer.push(row(0, "PLANNER_RESPONSE", { content: "partial" })).added[0]!;
    const update = reducer.push(row(0, "PLANNER_RESPONSE", { content: "complete" }));
    expect(update.added).toHaveLength(0);
    expect(update.changed).toEqual([entry.uuid]);
    expect(entry.parts).toEqual([{ kind: "text", text: "complete" }]);
  });
  test("forgets old step bodies while keeping recent steps updateable", () => {
    const reducer = createAgyReducer();
    const first = reducer.push(row(0, "PLANNER_RESPONSE", { content: "old" })).added[0]!;
    for (let step = 1; step <= PENDING_MAX; step++) {
      reducer.push(row(step, "PLANNER_RESPONSE", { content: "fixture" }));
    }
    const recent = reducer.push(row(PENDING_MAX, "PLANNER_RESPONSE", { content: "updated" }));
    expect(recent.added).toHaveLength(0);
    expect(recent.changed).toEqual([`agy-${PENDING_MAX}`]);
    const replay = reducer.push(row(0, "PLANNER_RESPONSE", { content: "replayed" }));
    expect(replay.changed).toHaveLength(0);
    expect(replay.added[0]!.uuid).toBe(first.uuid);
    expect(replay.added[0]).not.toBe(first);
    expect(first.parts).toEqual([{ kind: "text", text: "old" }]);
  });
  test("preserves upstream truncation and counts unknown row types", () => {
    const reducer = createAgyReducer();
    expect(reducer.push(row(0, "USER_INPUT", { content: "excerpt", truncated_fields: ["content"] })).added[0]!.parts[0]).toEqual({ kind: "text", text: "excerpt", truncated: true });
    reducer.push(row(1, "FUTURE_EVENT"));
    expect(reducer.unknowns().rows.get("FUTURE_EVENT")).toBe(1);
  });
  test("resolves only a reported UUID within its configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-agy-test-")); dirs.push(root);
    const logdir = join(root, "brain", id, ".system_generated", "logs");
    await mkdir(logdir, { recursive: true });
    const file = join(logdir, "transcript.jsonl");
    await writeFile(file, row(0, "USER_INPUT", { content: "fixture" }) + "\n");
    const source = new AgyTranscriptSource(join(root, "brain"));
    expect(await source.resolve({ kind: "id", value: id })).toBe(await realpath(file));
    expect(await source.resolve({ kind: "id", value: "../escape" })).toBeNull();
    expect(await source.resolve({ kind: "path", value: file })).toBeNull();
    await rm(file);
    const outside = join(root, "outside.jsonl"); await writeFile(outside, "secret");
    await symlink(outside, file);
    expect(await source.resolve({ kind: "id", value: id })).toBeNull();
  });
});
