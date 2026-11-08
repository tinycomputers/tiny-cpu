import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clampOpts, theme } from "../theme";
import { prog, springAt } from "./motion";

/** Fade + rise + scale entrance (never a lone fade). `delay` in frames. */
export const Entrance: React.FC<{ delay?: number; from?: number; style?: React.CSSProperties; children: React.ReactNode; spring?: object }> = ({
  delay = 0,
  from = 36,
  style,
  children,
  spring: cfg = theme.spring.smooth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = springAt(frame, fps, delay, cfg);
  return (
    <div
      style={{
        opacity: Math.min(1, p * 1.6),
        transform: `translateY(${interpolate(p, [0, 1], [from, 0])}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Wrap a scene: it slides up and fades over the last `exit` frames (faster than the entrance). */
export const SceneExit: React.FC<{ durationInFrames: number; exit?: number; children: React.ReactNode }> = ({ durationInFrames, exit = 9, children }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [durationInFrames - exit, durationInFrames - 1], [0, 1], { ...clampOpts, easing: theme.ease.in });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - p, transform: `translateY(${-24 * p}px)` }}>{children}</div>
  );
};

/**
 * Words that land at explicit frames (so they can sync with the voiceover). Each word rises out of its own
 * mask, the way a line of type is revealed in a studio title. No blur, no glow.
 */
export const SyncedWords: React.FC<{
  words: { text: string; at: number; accent?: boolean }[];
  size: number;
  gap?: number;
  style?: React.CSSProperties;
  justify?: "center" | "flex-start";
}> = ({ words, size, gap = 26, style, justify = "center" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: justify, columnGap: gap, rowGap: size * 0.06, ...style }}>
      {words.map((w, i) => {
        const p = springAt(frame, fps, w.at, theme.spring.snappy);
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.12em", marginBottom: "-0.12em" }}>
            <span
              style={{
                display: "inline-block",
                fontFamily: theme.fonts.sans,
                fontWeight: 700,
                fontSize: size,
                letterSpacing: "-0.035em",
                lineHeight: 1.04,
                color: w.accent ? theme.colors.accent : theme.colors.fgBright,
                transform: `translateY(${interpolate(p, [0, 1], [105, 0])}%)`,
              }}
            >
              {w.text}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** Section label chip in the app's own badge style (rounded-full, mono). */
export const Chip: React.FC<{ children: React.ReactNode; tone?: "accent" | "ok" | "warn" | "err" | "muted"; size?: number; style?: React.CSSProperties }> = ({
  children,
  tone = "muted",
  size = 22,
  style,
}) => {
  const color = tone === "muted" ? theme.colors.muted : theme.colors[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: theme.fonts.mono,
        fontSize: size,
        color,
        border: `1.5px solid ${tone === "muted" ? theme.colors.line : color}`,
        background: theme.colors.panel,
        borderRadius: 999,
        padding: `${size * 0.28}px ${size * 0.8}px`,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** Number that counts up with an eased curve, tabular figures so it never jitters. */
export const CountUp: React.FC<{ to: number; from?: number; start: number; end: number; format?: (n: number) => string; style?: React.CSSProperties }> = ({
  to,
  from = 0,
  start,
  end,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  style,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, start, end, theme.ease.out);
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{format(from + (to - from) * p)}</span>;
};
