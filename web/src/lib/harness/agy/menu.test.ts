import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { lineText, splitLines } from "../../blocks";
import { menusEqual } from "../menu-model";
import { agyAdapter, antigravityAdapter } from "./index";
import { detectMenuRegion } from "./menu";

const capture = (name: string) => readFileSync(join(import.meta.dirname, "../../../fixtures/panes", `agy--v135-${name}.txt`), "utf8");
const parse = (text: string) => splitLines(parseAnsi(text));
const model = (name: string) => detectMenuRegion(parse(capture(name)))!.model;

describe("agy 1.3.5 measured menu keys", () => {
  it("offers only printed palette keys, not inferred command digits", () => {
    expect(model("slash").actions.map((a) => a.keys)).toEqual([["Enter"], ["Tab"], ["Escape"]]);
    expect(menusEqual(model("slash"), model("slash-down"))).toBe(false);
  });
  it("uses Space to toggle and Enter to submit the entire selection", () => {
    expect(model("multi-question").actions.map((a) => a.keys)).toEqual([["Space"], ["Enter"], ["Escape"]]);
    for (const name of ["multi-red", "multi-down", "multi-red-green"]) {
      expect(menusEqual(model("multi-question"), model(name))).toBe(false);
    }
  });
  for (const adapter of [agyAdapter, antigravityAdapter]) {
    it(`${adapter.agent} renders a guarded menu and refuses composer typing`, () => {
      for (const name of ["slash", "multi-question", "multi-red-green"]) {
        const lines = parse(capture(name));
        expect(adapter.buildBlocks(lines).some((b) => b.kind === (name === "slash" ? "menu" : "multi-select"))).toBe(true);
        expect(adapter.composerReady!(lines)).toBe(false);
      }
    });
  }
  it("refuses write-in focus, stale scrollback, and undocumented footer recipes", () => {
    const text = parse(capture("multi-question")).map(lineText).join("\n");
    expect(detectMenuRegion(parse(text.replace("> 1.", "  1.").replace("  4. Write-in", "> 4. Write-in")))).toBeNull();
    expect(detectMenuRegion(parse(text + "\nOrdinary new output\nMore output"))).toBeNull();
    expect(detectMenuRegion(parse(text.replace("space Toggle", "space Unknown")))).toBeNull();
  });
});
