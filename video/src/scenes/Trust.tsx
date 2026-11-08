import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { RISCV_TESTS } from "../data/riscv-tests";
import { Chip, CountUp, Entrance, SceneExit } from "../fx/primitives";
import { prog, springAt } from "../fx/motion";
import { lineStart, phraseTime, sceneFrames, sceneStart, sec } from "../schedule";
import { theme } from "../theme";

const ID = "trust" as const;
const L = (t: number) => sec(t - sceneStart(ID));

const CARD_W = 540;
const CARD_H = 600;
const TOP = 170;
const XS = [110, 690, 1270];

const BigNumber: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = theme.colors.fgBright }) => (
  <div style={{ fontFamily: theme.fonts.sans, fontWeight: 800, fontSize: 168, letterSpacing: "-0.05em", lineHeight: 1, color }}>{children}</div>
);

const Card: React.FC<{ i: number; delay: number; out: number; children: React.ReactNode; active: number }> = ({ i, delay, out, children, active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = springAt(frame, fps, delay, theme.spring.smooth);
  return (
    <div
      style={{
        position: "absolute",
        left: XS[i],
        top: TOP,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 24,
        background: theme.colors.panel,
        border: `1.5px solid ${active > 0.05 ? theme.colors.ok : theme.colors.line}`,
        boxShadow: "0 30px 70px -32px rgba(0,0,0,0.75)",
        opacity: Math.min(1, p * 1.7) * (1 - out),
        transform: `translateY(${interpolate(p, [0, 1], [60, 0]) - out * 30}px) scale(${interpolate(p, [0, 1], [0.94, 1]) * (1 - out * 0.04)})`,
        padding: 44,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
};

const Check: React.FC<{ progress: number; size: number }> = ({ progress, size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="44" fill="none" stroke={theme.colors.ok} strokeWidth="6" pathLength={1} strokeDasharray={`${progress} 1`} transform="rotate(-90 50 50)" strokeLinecap="round" />
    <path d="M30 52 L45 66 L71 36" fill="none" stroke={theme.colors.ok} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={`${Math.max(0, (progress - 0.55) / 0.45)} 1`} />
  </svg>
);

export const Trust: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = sceneFrames(ID);
  const t40 = L(phraseTime(ID, 0, "Forty") - 0.08);
  const t260 = L(phraseTime(ID, 0, "Two hundred") - 0.08);
  const tGold = L(phraseTime(ID, 0, "All matched") - 0.08);
  const tFpga = L(lineStart(ID, 1) - 0.25);
  const out = prog(frame, tFpga, tFpga + 12, theme.ease.in);

  // FPGA fill: 4,958 of 5,280 logic cells, painted row by row
  const COLS = 80;
  const ROWS = 66;
  const fill = prog(frame, tFpga + 16, tFpga + 74, theme.ease.inOut);
  const used = Math.round(4958 * fill);
  const fpgaIn = springAt(frame, useVideoConfig().fps, tFpga + 8, theme.spring.smooth);

  return (
    <AbsoluteFill>
      <SceneExit durationInFrames={dur} exit={9}>
        {/* A: 40 official tests */}
        <Card i={0} delay={t40 - 6} out={out} active={prog(frame, t40 + 20, t40 + 50)}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 21, color: theme.colors.muted, letterSpacing: "0.04em" }}>riscv-tests · rv32ui-p-*</div>
          <div style={{ marginTop: 14 }}>
            <BigNumber color={theme.colors.ok}>
              <CountUp to={40} start={t40} end={t40 + 52} />
            </BigNumber>
          </div>
          <div style={{ fontFamily: theme.fonts.sans, fontWeight: 600, fontSize: 36, color: theme.colors.fgBright, marginTop: 8, letterSpacing: "-0.02em" }}>official tests, all passing</div>
          <div style={{ marginTop: "auto", display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 10 }}>
            {RISCV_TESTS.map((n, i) => {
              const on = prog(frame, t40 + 4 + i * 1.2, t40 + 14 + i * 1.2);
              return (
                <div key={n} title={n} style={{ height: 40, borderRadius: 8, background: `rgba(63,185,80,${0.12 + on * 0.78})`, border: `1px solid rgba(63,185,80,${0.2 + on * 0.5})`, transform: `scale(${0.8 + on * 0.2})` }} />
              );
            })}
          </div>
        </Card>

        {/* B: 260 random programs */}
        <Card i={1} delay={t260 - 6} out={out} active={prog(frame, t260 + 30, t260 + 60)}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 21, color: theme.colors.muted, letterSpacing: "0.04em" }}>forwarding on and off</div>
          <div style={{ marginTop: 14 }}>
            <BigNumber color={theme.colors.accent}>
              <CountUp to={260} start={t260} end={t260 + 56} />
            </BigNumber>
          </div>
          <div style={{ fontFamily: theme.fonts.sans, fontWeight: 600, fontSize: 36, color: theme.colors.fgBright, marginTop: 8, letterSpacing: "-0.02em" }}>random programs</div>
          <div style={{ marginTop: "auto", display: "grid", gridTemplateColumns: "repeat(26, 1fr)", gap: 5 }}>
            {Array.from({ length: 260 }, (_, i) => {
              const on = prog(frame, t260 + 2 + i * 0.22, t260 + 10 + i * 0.22);
              return <div key={i} style={{ aspectRatio: "1", borderRadius: 3, background: `rgba(88,166,255,${0.1 + on * 0.85})` }} />;
            })}
          </div>
        </Card>

        {/* C: golden model */}
        <Card i={2} delay={tGold - 6} out={out} active={prog(frame, tGold + 18, tGold + 40)}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 21, color: theme.colors.muted, letterSpacing: "0.04em" }}>lockstep, every retired instruction</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 22, marginTop: 28 }}>
            <Check progress={prog(frame, tGold + 6, tGold + 40, theme.ease.inOut)} size={120} />
            <div style={{ fontFamily: theme.fonts.sans, fontWeight: 800, fontSize: 60, letterSpacing: "-0.04em", lineHeight: 1.02, color: theme.colors.fgBright }}>
              Matches the
              <br />
              golden model
            </div>
          </div>
          <div style={{ marginTop: "auto", fontFamily: theme.fonts.mono, fontSize: 18, lineHeight: "30px", color: theme.colors.fg }}>
            {["add   a3, a1, a2", "lw    a1, 0(t1)", "sw    a2, 0(t1)", "bge   a2, a1, 0x38", "addi  t0, t0, 1"].map((t, i) => {
              const on = prog(frame, tGold + 10 + i * 5, tGold + 22 + i * 5);
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", opacity: on, transform: `translateX(${(1 - on) * 24}px)`, borderTop: `1px solid ${theme.colors.line}`, padding: "2px 0" }}>
                  <span>{t}</span>
                  <span style={{ color: theme.colors.ok }}>RTL = ISS ✓</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* FPGA hero */}
        <div style={{ position: "absolute", inset: 0, opacity: Math.min(1, fpgaIn * 1.6), transform: `translateY(${(1 - fpgaIn) * 40}px) scale(${0.96 + 0.04 * fpgaIn})`, pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 150, top: 190, width: 640, height: 600, borderRadius: 24, background: theme.colors.panel, border: `1.5px solid ${theme.colors.line}`, boxShadow: "0 40px 100px -30px rgba(0,0,0,0.85)", padding: 40 }}>
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 20, color: theme.colors.muted, marginBottom: 20 }}>iCE40UP5K · logic cells used</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 2, width: 560 }}>
              {Array.from({ length: COLS * ROWS }, (_, i) => {
                const lit = i < used;
                const real = i < 4958;
                return <div key={i} style={{ aspectRatio: "1", borderRadius: 1.5, background: lit ? theme.colors.accent : real ? "#1b2330" : "#141a22", opacity: lit ? 0.9 : 1 }} />;
              })}
            </div>
          </div>
          <div style={{ position: "absolute", left: 880, top: 170, width: 900 }}>
            <Entrance delay={tFpga + 10} from={30}>
              <Chip tone="accent" size={22}>
                real FPGA · synthesized with Yosys + nextpnr
              </Chip>
            </Entrance>
            <Entrance delay={tFpga + 16} from={40} style={{ marginTop: 28 }}>
              <div style={{ fontFamily: theme.fonts.sans, fontWeight: 800, fontSize: 150, letterSpacing: "-0.05em", lineHeight: 1, color: theme.colors.fgBright }}>
                <CountUp to={4958} start={tFpga + 16} end={tFpga + 74} />
                <span style={{ fontSize: 72, color: theme.colors.muted, fontWeight: 600 }}> / 5,280</span>
              </div>
              <div style={{ fontFamily: theme.fonts.sans, fontWeight: 600, fontSize: 38, color: theme.colors.fgBright, marginTop: 10, letterSpacing: "-0.02em" }}>logic cells: the whole pipelined core fits</div>
            </Entrance>
            <div style={{ display: "flex", gap: 22, marginTop: 56 }}>
              {[
                ["14.98 MHz", "post-route clock"],
                ["17 / 30", "block RAMs"],
                ["0", "latches"],
              ].map(([v, k], i) => (
                <Entrance key={k} delay={tFpga + 40 + i * 5} from={30}>
                  <div style={{ width: 268, borderRadius: 16, border: `1.5px solid ${theme.colors.line}`, background: theme.colors.panel, padding: "22px 26px" }}>
                    <div style={{ fontFamily: theme.fonts.mono, fontWeight: 700, fontSize: 40, color: theme.colors.fgBright, letterSpacing: "-0.03em" }}>{v}</div>
                    <div style={{ fontFamily: theme.fonts.sans, fontSize: 22, color: theme.colors.muted, marginTop: 4 }}>{k}</div>
                  </div>
                </Entrance>
              ))}
            </div>
          </div>
        </div>
      </SceneExit>
    </AbsoluteFill>
  );
};
