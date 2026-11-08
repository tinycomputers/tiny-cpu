import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Cursor } from "../fx/Cursor";
import { LogoMark } from "../fx/Logo";
import { Chip, Entrance, SyncedWords } from "../fx/primitives";
import { keys, prog, springAt } from "../fx/motion";
import { lineEnd, lineStart, sceneLines, sceneStart, sec } from "../schedule";
import { theme } from "../theme";

const ID = "cta" as const;
const L = (t: number) => sec(t - sceneStart(ID));

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = sceneLines(ID)[0]?.show ?? "";
  const t0 = lineStart(ID, 0);
  const d0 = lineEnd(ID, 0) - t0;
  let idx = 0;
  const words = text.split(" ").map((w) => {
    const at = text.indexOf(w, idx);
    idx = at + w.length;
    return { text: w, at: L(t0 + (at / text.length) * d0 - 0.06), accent: w.startsWith("computer") };
  });

  const tOpen = L(lineStart(ID, 1));
  const tClick = L(lineStart(ID, 1) + 1.15);
  const tUrl = tClick + 6;
  const tFirst = L(lineStart(ID, 2));
  const urlChars = "tiny-cpu.vercel.app";
  const typed = Math.round(interpolate(frame, [tUrl, tUrl + 26], [0, urlChars.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const press = frame >= tClick && frame < tClick + 14;
  const btn = springAt(frame, fps, tOpen, theme.spring.bouncy);
  const cursorX = keys(frame, [[tOpen - 14, 1500], [tClick - 4, 962]], theme.ease.soft);
  const cursorY = keys(frame, [[tOpen - 14, 880], [tClick - 4, 702]], theme.ease.soft);
  const cursorO = prog(frame, tOpen - 14, tOpen - 4) * (1 - prog(frame, tClick + 30, tClick + 46));
  const cyc = 1 + Math.floor(Math.max(0, frame - tFirstLocal(tFirst)) / 12);
  const blink = Math.floor(frame / 15) % 2 === 0;
  const first = prog(frame, tFirst, tFirst + 16);

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 96, display: "flex", justifyContent: "center" }}>
        <Entrance delay={4} from={30}>
          <LogoMark size={176} delay={4} stagger={1.6} />
        </Entrance>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 316, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 1500 }}>
          <SyncedWords words={words} size={104} gap={26} />
        </div>
      </div>

      {/* the app's primary button, scaled up: this is exactly the "Open the CPU" link on the landing page */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 630, display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <div
          style={{
            opacity: Math.min(1, btn * 1.6),
            transform: `translateY(${interpolate(btn, [0, 1], [40, 0])}px) scale(${interpolate(btn, [0, 1], [0.9, 1]) * (press ? 0.95 : 1)})`,
          }}
        >
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontWeight: 700,
              fontSize: 44,
              letterSpacing: "-0.01em",
              padding: "26px 68px",
              borderRadius: 18,
              background: theme.colors.accent,
              color: theme.colors.bg,
              boxShadow: "0 22px 44px -22px rgba(88,166,255,0.55)",
              filter: press ? "brightness(1.18)" : undefined,
            }}
          >
            Open the CPU
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: theme.fonts.mono,
            fontWeight: 600,
            fontSize: 54,
            letterSpacing: "-0.02em",
            color: theme.colors.fgBright,
            height: 70,
            opacity: prog(frame, tUrl - 2, tUrl + 4),
          }}
        >
          <span style={{ color: theme.colors.muted }}>https://</span>
          <span>{urlChars.slice(0, typed)}</span>
          <span style={{ width: 4, height: 54, background: theme.colors.accent, opacity: blink && typed < urlChars.length + 40 ? 1 : 0 }} />
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 934, display: "flex", justifyContent: "center", gap: 18, opacity: first }}>
        <div style={{ transform: `translateY(${(1 - first) * 14}px)`, display: "flex", gap: 18, alignItems: "center" }}>
          <Chip tone="ok" size={22}>
            ▸ cycle {String(cyc).padStart(4, "0")}
          </Chip>
          <Chip size={22}>free · open source · no install</Chip>
          <Chip size={22}>github.com/tinycomputers/tiny-cpu</Chip>
        </div>
      </div>

      <Cursor x={cursorX} y={cursorY} sinceClick={frame >= tClick ? frame - tClick : undefined} opacity={cursorO} />
    </AbsoluteFill>
  );
};

const tFirstLocal = (t: number) => t;
