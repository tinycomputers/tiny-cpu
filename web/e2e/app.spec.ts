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
