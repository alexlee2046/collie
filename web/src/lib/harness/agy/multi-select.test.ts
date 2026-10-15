import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { lineText, splitLines } from "../../blocks";
import { multiSelectEquals, multiSelectIdentity } from "../multi-select-model";
import { buildBlocks } from "../index";
import { agyAdapter } from "./index";
import { detectMultiSelectRegion } from "./multi-select";

const lines = (text: string) => splitLines(parseAnsi(text));
const capture = (name: string) => readFileSync(join(import.meta.dirname, "../../../fixtures/panes", `agy--v135-${name}.txt`), "utf8");
const model = (name: string) => detectMultiSelectRegion(lines(capture(name)))!.model;

describe("agy native multi-select, measured 1.3.5 digit choreography", () => {
  it("exposes real checkboxes and explicit global submit/skip plans", () => {
    expect(model("multi-question")).toMatchObject({ phase: "checkbox", toggle: "digit", advanceKeys: ["Enter"], cancelKeys: ["Escape"], options: [
      { n: 1, label: "Red", checked: false }, { n: 2, label: "Green", checked: false }, { n: 3, label: "Blue", checked: false },
    ] });
    expect(model("multi-red-green")).toMatchObject({ options: [{ checked: true }, { checked: true }, { checked: false }] });
  });
  it("tracks checked state but ignores pointer movement in identity", () => {
    expect(multiSelectIdentity(model("multi-red"), model("multi-down"))).toBe(true);
    expect(multiSelectEquals(model("multi-red"), model("multi-red-green"))).toBe(false);
    const m = model("multi-question");
    expect(multiSelectIdentity(m, { ...m, cancelKeys: ["Enter"] })).toBe(false);
    expect(multiSelectEquals(m, { ...m, cancelKeys: ["Enter"] })).toBe(false);
  });
  it("declines unknown, incomplete, stale and write-in screens instead of guessing", () => {
    const text = lines(capture("multi-question")).map(lineText).join("\n");
    for (const mutated of [
      text.replace("> 1.", "  1."),
      text.replace("> 1.", "  1.").replace("  4. Write-in", "> 4. Write-in"),
      text.replace("2. [ ] Green", "5. [ ] Green"),
      text.replace("space Toggle", "space Something else"),
      text.replace("[ ] Red", "[?] Red"),
      text + "\nnew output\nnot a modal",
    ]) expect(detectMultiSelectRegion(lines(mutated))).toBeNull();
  });
});

describe("busy is not an unread modal", () => {
  const rule = "─".repeat(80);
  const busy = ["Working…", rule, ">", rule, "esc to cancel     accept-edits · Gemini"].join("\n");
  it("keeps busy sends closed without showing an Esc dialog", () => {
    expect(agyAdapter.composerReady!(lines(busy))).toBe(false);
    expect(buildBlocks(lines(busy), { agent: "agy" }).map(b => b.kind)).toEqual(["raw"]);
    expect(buildBlocks(lines(busy), { agent: "antigravity" }).map(b => b.kind)).toEqual(["raw"]);
  });
  it("still exposes an escape for an unrecognised modal, not for the shell", () => {
    expect(buildBlocks(lines("unknown picker\n\nesc to cancel"), { agent: "agy" })[0]!.kind).toBe("unread-dialog");
    expect(buildBlocks(lines("$ agy\nStarting…"), { agent: "agy" })[0]!.kind).toBe("raw");
  });
});
