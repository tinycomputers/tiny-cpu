// One theme for the whole video. Colors are the app's own tokens (web/src/styles/global.css) plus the five
// pipeline-stage colors from the TinyCPU logo (web/public/logo.svg). Nothing else is inlined in components.
import { Easing } from "remotion";

export const theme = {
  colors: {
    bg: "#0d1117",
    bgDeep: "#090c10",
    panel: "#161b22",
    line: "#30363d",
    fg: "#c9d1d9",
    fgBright: "#e6edf3",
    muted: "#8b949e",
    accent: "#58a6ff", // THE hero color
    ok: "#3fb950",
    err: "#f85149",
    warn: "#d29922",
    active: "#1f2d3d",
    // logo bars = the five pipeline stages IF ID EX MEM WB
    stage: ["#58a6ff", "#7ee787", "#d2a8ff", "#ffa657", "#ff7b72"],
    // GitHub-dark syntax colors for the SystemVerilog card
    syn: { keyword: "#ff7b72", type: "#79c0ff", fn: "#d2a8ff", comment: "#8b949e", num: "#79c0ff", str: "#a5d6ff", ident: "#c9d1d9" },
  },
  fonts: {
    sans: '"Inter Variable", system-ui, sans-serif',
    mono: '"JetBrains Mono Variable", ui-monospace, monospace',
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1), // entrances
    inOut: Easing.bezier(0.83, 0, 0.17, 1), // camera moves
    soft: Easing.bezier(0.45, 0, 0.15, 1), // cursor travel
    in: Easing.bezier(0.7, 0, 0.84, 0), // exits
  },
  spring: {
    snappy: { damping: 15, stiffness: 170, mass: 0.6 },
    smooth: { damping: 22, stiffness: 95, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
} as const;

export const clampOpts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
