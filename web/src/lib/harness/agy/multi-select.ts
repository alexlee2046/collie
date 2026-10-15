// agy 1.3.5, measured on an isolated pane: digit N toggles N AND moves the pointer;
// Enter submits the checked set globally. Write-in has different keyboard semantics.
import type { StyledLine } from "../../blocks";
import type { MultiSelectModel, MultiSelectOption } from "../multi-select-model";
import { isAlienBuffer, lineText } from "./markers";

export function detectMultiSelectRegion(lines: StyledLine[]): { model: Extract<MultiSelectModel, { phase: "checkbox" }>; startLine: number } | null {
  const texts = lines.map(lineText);
  if (isAlienBuffer(texts)) return null;
  let end = texts.length - 1;
  while (end >= 0 && texts[end]!.trim() === "") end--;
  if (end < 2 || !/^esc to cancel\b/i.test(texts[end]!.trim()) ||
      texts[end - 1]!.trim() !== "↑/↓ Navigate · space Toggle · enter Submit · esc Skip") return null;
  let start = end - 2;
  while (start >= Math.max(0, end - 32) && !/^Question \d+\/\d+: .+/.test(texts[start]!.trim())) start--;
  if (start < Math.max(0, end - 32)) return null;
  const options: MultiSelectOption[] = [];
  let pointerRow: number | null = null;
  let writeIn = false;
  for (let i = start + 1; i < end - 1; i++) {
    const text = texts[i]!.trim();
    if (!text) continue;
    const row = /^(>)?\s*([1-9])\. \[([ x])\] (.+)$/.exec(text);
    if (row) {
      if (writeIn || Number(row[2]) !== options.length + 1) return null;
      options.push({ n: Number(row[2]), checked: row[3] === "x", label: row[4]! });
      if (row[1]) {
        if (pointerRow !== null) return null;
        pointerRow = Number(row[2]);
      }
    } else {
      // Only the measured, UNFOCUSED free-text row. Never expose it as a checkbox.
      const field = /^([1-9])\. Write-in\.\.\.$/.exec(text);
      if (!field || writeIn || Number(field[1]) !== options.length + 1) return null;
      writeIn = true;
    }
  }
  if (!options.length || pointerRow === null || !writeIn) return null;
  const regionSignature = texts.slice(start, end).join("\n");
  const signature = texts.slice(start, end).map((text) =>
    text.replace(/^\s*>?\s*([1-9])\. \[[ x]\] /, "$1. [] ")).join("\n");
  return {
    startLine: start,
    model: {
      phase: "checkbox", question: texts[start]!.trim(), options,
      escape: null, pointer: "option", pointerRow, steps: null,
      toggle: "digit", advanceLabel: "Submit", advanceKeys: ["Enter"],
      cancelKeys: ["Escape"], cancelLabel: "Skip", signature, regionSignature,
    },
  };
}
