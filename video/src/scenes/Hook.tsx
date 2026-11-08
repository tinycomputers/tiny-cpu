import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { LogoMark } from "../fx/Logo";
import { SceneExit, SyncedWords } from "../fx/primitives";
import { prog, springAt } from "../fx/motion";
import { lineEnd, lineStart, sceneFrames, sceneLines, sceneStart, sec } from "../schedule";
import { theme } from "../theme";

const ID = "hook" as const;
const local = (t: number) => sec(t - sceneStart(ID));

/** Square clock wave scrolling left; each rising edge brightens the marker and advances the cycle counter. */
const ClockWave: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const period = 200;
  const amp = 44;
  const speed = 5.2;
  const shift = (frame * speed) % period;
  const pts: string[] = [];
  for (let x = -period; x <= 1920 + period; x += period) {
    const a = x - shift;
    pts.push(`${a},${amp} ${a},0 ${a + period / 2},0 ${a + period / 2},${amp}`);
  }
  const cycles = Math.floor((frame * speed) / period);
  const nearest = (960 + shift) % period;
  const flash = Math.max(0, 1 - Math.min(nearest, period - nearest) / 26);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 790, opacity }}>
      <div style={{ position: "relative", height: amp + 4 }}>
        <svg width={1920} height={amp + 4} style={{ position: "absolute", left: 0, top: 2 }}>
          <polyline points={pts.join(" ")} fill="none" stroke={theme.colors.line} strokeWidth={3} strokeLinejoin="miter" />
          <clipPath id="center-clip">
            <rect x={760} y={-10} width={400} height={amp + 20} />
          </clipPath>
          <polyline points={pts.join(" ")} fill="none" stroke={theme.colors.accent} strokeWidth={3} strokeLinejoin="miter" clipPath="url(#center-clip)" />
        </svg>
        <div style={{ position: "absolute", left: 959, top: -20, width: 2, height: amp + 40, background: theme.colors.accent, opacity: 0.25 + flash * 0.75 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 34, fontFamily: theme.fonts.mono, fontSize: 26, letterSpacing: "0.12em", color: theme.colors.muted }}>
        <span>CLK&nbsp;&nbsp;·&nbsp;&nbsp;CYCLE&nbsp;</span>
        <span style={{ color: theme.colors.accent, fontVariantNumeric: "tabular-nums" }}>{String(1 + cycles).padStart(4, "0")}</span>
      </div>
    </div>
  );
};

const STAGES = ["IF", "ID", "EX", "MEM", "WB"];

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = sceneFrames(ID);
  const line0 = sceneLines(ID)[0];
  const t0 = lineStart(ID, 0);
  const d0 = lineEnd(ID, 0) - t0;
  const text = line0?.show ?? "";

  // words land when they are spoken
  let idx = 0;
  const words = text.split(" ").map((w) => {
    const at = text.indexOf(w, idx);
    idx = at + w.length;
    return { text: w, at: local(t0 + (at / text.length) * d0 - 0.06), accent: w.startsWith("think") };
  });

  const headlineOut = prog(frame, local(lineEnd(ID, 0)) + 4, local(lineEnd(ID, 0)) + 14, theme.ease.in);
  const waveOut = 1 - prog(frame, local(lineStart(ID, 1)) - 4, local(lineStart(ID, 1)) + 10, theme.ease.in);
  const waveIn = prog(frame, 0, 14);
  const lockT = local(lineStart(ID, 1)) - 8; // logo begins just before "This is"
  const wordT = local(lineStart(ID, 1) + 0.62); // wordmark on "TinyCPU"
  const lock = springAt(frame, fps, lockT, theme.spring.smooth);
  const wordmark = "TinyCPU".split("");
  const tagIn = prog(frame, wordT + 14, wordT + 34);

  return (
    <AbsoluteFill>
      <SceneExit durationInFrames={dur} exit={10}>
        <ClockWave opacity={waveIn * waveOut} />

        {/* headline */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 250,
            display: "flex",
            justifyContent: "center",
            opacity: 1 - headlineOut,
            transform: `translateY(${-30 * headlineOut}px)`,
          }}
        >
          <div style={{ width: 1560 }}>
            <SyncedWords words={words} size={124} gap={30} />
          </div>
        </div>

        {/* five stage bars: the logo's colours, ticking along the clock */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 940, display: "flex", justifyContent: "center", gap: 14, opacity: waveIn * waveOut }}>
          {STAGES.map((s, i) => {
            const on = Math.floor(frame / 6) % 5 === i;
            return (
              <div
                key={s}
                style={{
                  width: 74,
                  height: 10,
                  borderRadius: 5,
                  background: theme.colors.stage[i],
                  opacity: on ? 1 : 0.2,
                  transform: `scaleY(${on ? 1.5 : 1})`,
                }}
              />
            );
          })}
        </div>

        {/* lockup */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 64, opacity: Math.min(1, lock * 2) }}>
          <div style={{ transform: `translateX(${interpolate(lock, [0, 1], [90, 0])}px)` }}>
            <LogoMark size={290} delay={lockT} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", fontFamily: theme.fonts.sans, fontWeight: 700, fontSize: 196, letterSpacing: "-0.05em", lineHeight: 1 }}>
              {wordmark.map((ch, i) => {
                const p = springAt(frame, fps, wordT + i * 2, theme.spring.snappy);
                return (
                  <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.1em", marginBottom: "-0.1em" }}>
                    <span style={{ display: "inline-block", color: theme.colors.fgBright, transform: `translateY(${interpolate(p, [0, 1], [105, 0])}%)` }}>{ch}</span>
                  </span>
                );
              })}
            </div>
            <div
              style={{
                fontFamily: theme.fonts.sans,
                fontWeight: 500,
                fontSize: 46,
                letterSpacing: "-0.01em",
                color: theme.colors.muted,
                opacity: tagIn,
                transform: `translateY(${(1 - tagIn) * 16}px)`,
              }}
            >
              A real RISC-V CPU, running in your browser
            </div>
          </div>
        </AbsoluteFill>
      </SceneExit>
    </AbsoluteFill>
  );
};
