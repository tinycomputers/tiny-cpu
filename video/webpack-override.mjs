// Shared webpack override: used by remotion.config.ts (CLI, studio, render) and by scripts/stills.mjs.
import path from "node:path";
import { enableTailwind } from "@remotion/tailwind-v4";

// The video reuses the web app's real React components, so they must resolve from here:
//   @web   -> ../web/src
//   react  -> ONE copy (this project's), never web/node_modules/react, or hooks break
//   ?raw   -> source text, the same trick Vite uses for the .s presets
export const webpackOverride = (config) => {
  const withTailwind = enableTailwind(config);
  const here = process.cwd();
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        "@web": path.resolve(here, "../web/src"),
        react: path.resolve(here, "node_modules/react"),
        "react-dom": path.resolve(here, "node_modules/react-dom"),
      },
    },
    module: {
      ...withTailwind.module,
      rules: [{ resourceQuery: /raw/, type: "asset/source" }, ...(withTailwind.module?.rules ?? [])],
    },
  };
};
