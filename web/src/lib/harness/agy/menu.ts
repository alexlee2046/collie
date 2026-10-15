// agy 1.3.5's slash palette and checkbox questions advertise their own keys. Keep the
// existing guarded menu surface: digits are NOT checkbox toggles, and Enter submits the whole set.
import type { StyledLine } from "../../blocks";
import type { MenuModel } from "../menu-model";
import { parseKeyHintFooter } from "../menu-hints";
import { isAlienBuffer, isHorizontalRule, lineText } from "./markers";

export function detectMenuRegion(lines: StyledLine[]): { model: MenuModel; startLine: number } | null {
  const texts = lines.map(lineText);
  if (isAlienBuffer(texts)) return null;
  let end = texts.length - 1;
  while (end >= 0 && texts[end]!.trim() === "") end--;
  if (end < 1 || !/^esc to cancel\b/i.test(texts[end]!.trim())) return null;
  const footer = texts[end - 1]!.trim();
  const palette = footer === "↑/↓ Navigate · enter Select · tab Complete";
  const checkbox = footer === "↑/↓ Navigate · space Toggle · enter Submit · esc Skip";
  if (!palette && !checkbox) return null;

  let top = end - 2;
  while (top >= Math.max(0, end - 32) && !isHorizontalRule(texts[top]!)) top--;
  if (top < Math.max(0, end - 32)) return null;
  const body = texts.slice(top + 1, end - 1);
  let title: string;
  if (palette) {
    const draft = texts[top - 1]?.trim() ?? "";
    if (!/^> \/\S*\s*$/.test(draft) || !body.some((t) => /^> \/\S+\s+\S/.test(t.trim()))) return null;
    title = draft.slice(2).trim();
  } else {
    const question = body.find((t) => /^Question \d+\/\d+: .+/.test(t.trim()));
    // Write-in has its own text semantics. Do not send a Space/Enter while it owns the pointer.
    if (!question || !body.some((t) => /^> \d+\. \[[ x]\] .+/.test(t.trim()))) return null;
    title = question.trim();
  }
  // The shared hint parser expects 'to'; agy's printed footer omits it. No keys are inferred.
  const hints = footer.replace(/(enter|tab|space|esc) /g, "$1 to ");
  const actions = parseKeyHintFooter(hints);
  if (palette) actions.push({ label: "Cancel", keys: ["Escape"], cancel: true });
  return {
    model: { title, actions, nav: { upDown: true }, signature: texts.slice(top, end).join("\n") },
    startLine: top,
  };
}
