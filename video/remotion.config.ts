import { existsSync } from "node:fs";
import { Config } from "@remotion/cli/config";
// @ts-expect-error plain ESM helper shared with scripts/stills.mjs
import { webpackOverride } from "./webpack-override.mjs";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(96);
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
Config.overrideWebpackConfig(webpackOverride);

// Use a locally installed headless Chromium when one exists (skips Remotion's own ~100 MB download).
// If it is not picked up, pass --browser-executable=<path> on the command line.
const LOCAL_BROWSER = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
if (existsSync(LOCAL_BROWSER)) Config.setBrowserExecutable(LOCAL_BROWSER);
