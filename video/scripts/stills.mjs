// Fast visual check: bundle once, render stills of TinyCpuDemo at the given times (seconds) with one browser.
//   node scripts/stills.mjs 1.5 4.2 16.5      -> out/check/t_1.50.png ...
import path from "node:path";
import { mkdirSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { webpackOverride } from "../webpack-override.mjs";

const BR = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
const id = process.env.COMP ?? "TinyCpuDemo";
const times = process.argv.slice(2).map(Number);
mkdirSync("out/check", { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), webpackOverride });
const browser = await openBrowser("chrome", { browserExecutable: BR });
const composition = await selectComposition({ serveUrl, id, puppeteerInstance: browser });
for (const t of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(t * composition.fps));
  const output = `out/check/t_${t.toFixed(2)}.png`;
  await renderStill({ composition, serveUrl, output, frame, puppeteerInstance: browser, imageFormat: "jpeg", jpegQuality: 88, timeoutInMilliseconds: 180000 });
  console.log("still", output, "frame", frame);
}
await browser.close({ silent: true });
process.exit(0);
