import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { installApiStub } from "./fixtures/api";

// Replays the same measured agy frames as the unit/binding tier; the real-pane run
// verifies the vendor's digit recipe separately. No live bridge or credentials in CI.
test.use({ serviceWorkers: "block", viewport: { width: 402, height: 874 } });
const pane = fixtureAgents[0]!.paneId;
const encoded = encodeURIComponent(pane);
const capture = (name: string) => readFileSync(fileURLToPath(new URL(`../src/fixtures/panes/${name}.txt`, import.meta.url)), "utf8");

test("agy checkboxes have 44px targets, follow terminal state and submit only once", async ({ page }) => {
  await installApiStub(page);
  await page.addInitScript(() => localStorage.setItem("collie:dash-prefs:v1", JSON.stringify({ paneView: "terminal" })));
  let text = capture("agy--v135-multi-question");
  const writes: string[][] = [];
  await page.route((url) => url.pathname === "/api/snapshot", route => route.fulfill({ json: {
    ...fixtureSnapshot, agents: [{ ...fixtureAgents[0]!, agent: "agy", hasSession: false }],
  } }));
  await page.route((url) => url.pathname === `/api/pane/${encoded}`, route => route.fulfill({ json: {
    paneId: pane, text, truncated: false, revision: 1,
  } }));
  await page.route((url) => url.pathname === `/api/pane/${encoded}/keys`, async route => {
    // SAFETY: this body is emitted by the app's own sendKeys client.
    const body = route.request().postDataJSON() as { keys: string[]; expected_prompt?: string };
    writes.push(body.keys);
    expect(body.expected_prompt).toContain("Question 1/1: Which test colors?");
    if (body.keys.join() === "1") text = capture("agy--v135-multi-red");
    if (body.keys.join() === "2") text = capture("agy--v135-multi-red-green");
    if (body.keys.join() === "Enter") text = capture("agy--working");
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/pane/${encoded}`);
  const group = page.getByRole("group", { name: "Question 1/1: Which test colors?", exact: true });
  await expect(group).toBeVisible();
  for (const control of await group.getByRole("button").all()) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  for (const name of ["Red", "Green"]) {
    const option = group.getByRole("checkbox", { name, exact: true });
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
  }
  await group.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(group).toHaveCount(0);
  expect(writes).toEqual([["1"], ["2"], ["Enter"]]);
  await expect(page.getByText("Collie cannot read this dialog", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(402);
});
