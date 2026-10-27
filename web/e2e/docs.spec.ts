// Smoke tests for the landing page and the five docs pages, against the production build. The embedded runs
// start when they scroll into view (client:visible), so each test scrolls the embed first.
import { expect, test } from "@playwright/test";

test("the landing page runs fib live and reports PASS", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A real RISC-V CPU");
  const embed = page.locator("figure").first();
  await embed.scrollIntoViewIfNeeded();
  await expect(embed.getByText(/^Cycle 1 of \d+/)).toBeVisible({ timeout: 60_000 });
  await embed.getByRole("button", { name: "Go to end" }).click();
  await expect(embed.getByText(/Halted at cycle \d+/)).toBeVisible();
  await expect(embed.getByText(/PASS/)).toBeVisible();
});

for (const [path, heading] of [
  ["/docs/how-it-works", "How it works"],
  ["/docs/architecture", "Architecture"],
  ["/docs/the-pipeline", "The pipeline"],
  ["/docs/hazards", "Hazards"],
  ["/docs/verification", "Verification"],
] as const) {
  test(`${path} renders with navigation`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the CPU" }).first()).toBeVisible();
    await expect(page.locator('a[aria-current="page"]')).toHaveText(heading);
  });
}

test("the how-it-works embed runs on the single-cycle core", async ({ page }) => {
  await page.goto("/docs/how-it-works");
  const embed = page.locator("figure").first();
  await embed.scrollIntoViewIfNeeded();
  await expect(embed.getByText(/^Cycle 1 of \d+/)).toBeVisible({ timeout: 60_000 });
  await embed.getByRole("button", { name: "Go to end" }).click();
  await expect(embed.getByText(/Halted at cycle \d+ — PASS/)).toBeVisible();
});

test("the landing page carries the social card, canonical link and structured data", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og-image\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /tiny-cpu\.vercel\.app\/$/);
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(jsonLd ?? "{}")["@type"]).toBe("SoftwareSourceCode");
  const image = await request.get("/og-image.png");
  expect(image.ok()).toBeTruthy();
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).toContain("/docs/verification/");
});

test("docs pages have no horizontal scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/verification");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
