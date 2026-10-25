// Smoke tests for the browser app, run against the production build. The first preset runs once the WASM
// core has loaded, so each test waits for "N cycles recorded" and then moves the cursor where it needs.
import { expect, type Page, test } from "@playwright/test";

const recorded = (page: Page) => page.getByText(/\d+ cycles recorded/);
const halted = (page: Page) => page.getByText(/Halted at cycle \d+ — PASS\./);

test("the app loads the core and runs the default program to PASS", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Go to end" }).click();
  await expect(halted(page)).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "Hello, TinyCPU!" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the cycle controls step backwards and forwards", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Step forward" }).click();
  await expect(page.getByText(/^Cycle 2 of \d+\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Step back" }).click();
  await expect(page.getByText(/^Cycle 1 of \d+\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Go to end" }).click();
  await expect(halted(page)).toBeVisible();
  await page.getByRole("button", { name: "Go to start" }).click();
  await expect(page.getByText(/^Cycle 1 of \d+\.$/)).toBeVisible();
});

test("an assembly error is reported with its line number", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Assembly source").fill("_start:\n    frobnicate a0\n");
  await page.getByRole("button", { name: "Assemble & run" }).click();
  await expect(page.getByRole("alert")).toContainText("line 2: unknown instruction 'frobnicate'");
});

test("another preset prints its answer", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Program").selectOption("fib");
  await page.getByRole("button", { name: "Assemble & run" }).click();
  await page.getByRole("button", { name: "Go to end" }).click();
  await expect(page.locator("pre").filter({ hasText: "6765" })).toBeVisible();
  await expect(halted(page)).toBeVisible();
});

test("the hazard lab shows the measured forwarding difference", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "L3 Hazard lab" }).click();
  await page.getByRole("button", { name: "ALU to ALU, distance 1" }).click();
  await expect(page.getByRole("cell", { name: "5-stage, forwarding on" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "single-cycle" })).toBeVisible();
});

test("the datapath view shows the instruction that retired", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "L1 Datapath" }).click();
  await page.getByRole("button", { name: "Go to end" }).click();
  await expect(page.getByRole("img", { name: /Single-cycle datapath for/ })).toBeVisible();
  await expect(page.getByText(/retire #/)).toBeVisible();
});

test("the programs view lists every preset with PASS", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "L4 Programs" }).click();
  await expect(page.getByRole("cell", { name: "PASS" })).toHaveCount(5);
  await expect(page.getByRole("img", { name: "Data memory access heatmap" })).toBeVisible();
});

test("the layout has no horizontal page scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the theme toggle switches the colour scheme", async ({ page }) => {
  await page.goto("/app/");
  await expect(recorded(page)).toBeVisible({ timeout: 60_000 });
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBe(before);
});
