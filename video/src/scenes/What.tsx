import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CodeLine } from "../fx/Highlight";
import { Chip, Entrance, SceneExit } from "../fx/primitives";
import { prog, springAt } from "../fx/motion";
import { lineStart, phraseTime, sceneFrames, sceneStart, sec } from "../schedule";
import { theme } from "../theme";

const ID = "what" as const;
const L = (t: number) => sec(t - sceneStart(ID));

// Verbatim lines of rtl/forward_unit.sv (elided with comments), the module whose output drives the badge in the UI.
const CODE = [
  "// Operand forwarding into EX.",
  "module forward_unit (",
  "    input  logic       forward_en,",
  "    input  logic [4:0] ex_rs1,",
  "    output logic [1:0] fwd_a,",
  "    // ...",
  "    else if (mm_wr && mm_rd == rs) pick = FWD_EXMEM;",
  "    else if (wb_wr && wb_rd == rs) pick = FWD_MEMWB;",
  "    assign fwd_a = pick(ex_uses_rs1, ex_rs1);",
];
const LINE_H = 31;
const TOP = 250;
const CARD_H = 440;
const ROW_Y = TOP + CARD_H / 2;

const Card: React.FC<{ x: number; w: number; delay: number; glowAt: number; children: React.ReactNode; accent?: string }> = ({ x, w, delay, glowAt, children, accent = theme.colors.accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = springAt(frame, fps, delay, theme.spring.smooth);
  const g = prog(frame, glowAt, glowAt + 12) * (1 - prog(frame, glowAt + 40, glowAt + 70, theme.ease.inOut) * 0.6);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: TOP,
        width: w,
        height: CARD_H,
        opacity: Math.min(1, p * 1.7),
        transform: `translateY(${interpolate(p, [0, 1], [48, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})`,
        borderRadius: 20,
        background: theme.colors.panel,
        border: `1.5px solid ${g > 0.02 ? accent : theme.colors.line}`,
        boxShadow: "0 24px 60px -28px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
};

const CardHead: React.FC<{ left: string; right?: React.ReactNode }> = ({ left, right }) => (
  <div
    style={{
      height: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 22px",
      borderBottom: `1px solid ${theme.colors.line}`,
      fontFamily: theme.fonts.mono,
      fontSize: 19,
      color: theme.colors.muted,
    }}
  >
    <span>{left}</span>
    {right}
  </div>
);

/** Dashed link between two cards with a pulse that travels when `at` is reached. */
const Link: React.FC<{ x1: number; x2: number; at: number }> = ({ x1, x2, at }) => {
  const frame = useCurrentFrame();
  const draw = prog(frame, at, at + 14);
  const pulse = prog(frame, at + 6, at + 30, theme.ease.soft);
  return (
    <svg style={{ position: "absolute", left: x1, top: ROW_Y - 20, overflow: "visible" }} width={x2 - x1} height={40}>
      <line x1={0} y1={20} x2={(x2 - x1) * draw} y2={20} stroke={theme.colors.line} strokeWidth={3} strokeDasharray="8 8" />
      <path d={`M${x2 - x1 - 16} 10 L${x2 - x1 - 4} 20 L${x2 - x1 - 16} 30`} fill="none" stroke={theme.colors.accent} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" opacity={draw} />
      <circle cx={(x2 - x1 - 24) * pulse} cy={20} r={7} fill={theme.colors.accent} opacity={pulse > 0 && pulse < 1 ? 1 : 0} />
    </svg>
  );
};

const Badge: React.FC<{ label: string; tone: "accent" | "warn" | "err"; style?: React.CSSProperties }> = ({ label, tone, style }) => {
  const color = theme.colors[tone];
  return (
    <span style={{ display: "inline-block", border: `1.5px solid ${color}`, color, borderRadius: 999, padding: "5px 16px", fontFamily: theme.fonts.mono, fontSize: 20, ...style }}>{label}</span>
  );
};

export const What: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = sceneFrames(ID);
  const tCode = L(phraseTime(ID, 0, "written in") - 0.35);
  const tVerilate = L(phraseTime(ID, 0, "compiled") - 0.25);
  const tWasm = L(phraseTime(ID, 0, "WebAssembly") - 0.2);
  const tBrowser = L(phraseTime(ID, 0, "running live") - 0.25);
  const tProof = L(lineStart(ID, 1) - 0.05);

  const proof = prog(frame, tProof, tProof + 46, theme.ease.inOut);
  const proofLabel = prog(frame, tProof + 18, tProof + 34);
  const badgeOn = prog(frame, tProof + 40, tProof + 52);
  const hl = prog(frame, tProof, tProof + 10);

  // proof path: from the assign line of the code card, under the middle cards, up into the badge of the browser card
  const codeY = TOP + 54 + 22 + 9 * LINE_H + LINE_H / 2;
  const path = `M 640 ${codeY} V 770 H 1690 V 648`;
  const stageRows = [
    { name: "IF", text: "lw  a2, 4(t1)" },
    { name: "ID", text: "lw  a1, 0(t1)" },
    { name: "EX", text: "addi t0, t0, 1" },
    { name: "MEM", text: "add t2, sp, t3" },
    { name: "WB", text: "sw  a2, 0(t1)" },
  ];

  return (
    <AbsoluteFill>
      <SceneExit durationInFrames={dur} exit={9}>
        {/* section label */}
        <Entrance delay={L(sceneStart(ID) + 0.1)} from={20} style={{ position: "absolute", left: 80, top: 120 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Chip tone="accent" size={22}>
              rtl → wasm → you
            </Chip>
            <span style={{ fontFamily: theme.fonts.sans, fontWeight: 700, fontSize: 50, letterSpacing: "-0.03em", color: theme.colors.fgBright }}>Real hardware, in a web page</span>
          </div>
        </Entrance>

        {/* 1: SystemVerilog */}
        <Card x={70} w={620} delay={tCode} glowAt={tCode + 8}>
          <CardHead left="rtl/forward_unit.sv" right={<Chip tone="muted" size={15}>SystemVerilog</Chip>} />
          <div style={{ padding: "22px 22px 0", fontFamily: theme.fonts.mono, fontSize: 17.2, lineHeight: `${LINE_H}px` }}>
            {CODE.map((l, i) => {
              const on = i === CODE.length - 1;
              return (
                <div key={i} style={{ position: "relative", background: on ? `rgba(88,166,255,${0.16 * hl})` : undefined, margin: "0 -22px", padding: "0 22px", boxShadow: on ? `inset 3px 0 0 rgba(88,166,255,${hl})` : undefined }}>
                  <CodeLine text={l} style={{ opacity: Math.min(1, prog(frame, tCode + 6 + i * 3, tCode + 18 + i * 3)) }} />
                </div>
              );
            })}
          </div>
        </Card>

        <Link x1={700} x2={780} at={tVerilate - 6} />

        {/* 2: Verilator */}
        <Card x={790} w={270} delay={tVerilate} glowAt={tVerilate + 8} accent={theme.colors.stage[3]}>
          <CardHead left="verilator 5" />
          <div style={{ padding: "52px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
            <div style={{ width: 120, height: 120, borderRadius: 28, background: "#0d1117", border: `1.5px solid ${theme.colors.line}`, display: "grid", placeItems: "center", fontFamily: theme.fonts.mono, fontWeight: 700, fontSize: 46, color: theme.colors.stage[3] }}>C++</div>
            <div style={{ fontFamily: theme.fonts.sans, fontWeight: 700, fontSize: 32, color: theme.colors.fgBright, letterSpacing: "-0.02em" }}>Verilator</div>
            <div style={{ fontFamily: theme.fonts.sans, fontSize: 22, color: theme.colors.muted, textAlign: "center", lineHeight: 1.35 }}>RTL becomes a<br />cycle-exact C++ model</div>
            <Chip size={17}>Vcpu_pipe</Chip>
          </div>
        </Card>

        <Link x1={1070} x2={1150} at={tWasm - 6} />

        {/* 3: WebAssembly */}
        <Card x={1160} w={270} delay={tWasm} glowAt={tWasm + 8} accent={theme.colors.stage[2]}>
          <CardHead left="emscripten" />
          <div style={{ padding: "52px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
            <div style={{ width: 120, height: 120, borderRadius: 28, background: "#0d1117", border: `1.5px solid ${theme.colors.line}`, display: "grid", placeItems: "center", fontFamily: theme.fonts.mono, fontWeight: 700, fontSize: 46, color: theme.colors.stage[2] }}>WA</div>
            <div style={{ fontFamily: theme.fonts.sans, fontWeight: 700, fontSize: 32, color: theme.colors.fgBright, letterSpacing: "-0.02em" }}>WebAssembly</div>
            <div style={{ fontFamily: theme.fonts.sans, fontSize: 22, color: theme.colors.muted, textAlign: "center", lineHeight: 1.35 }}>Both cores in one module,<br />about 77 KB gzipped</div>
            <Chip size={17}>tiny_cpu.wasm</Chip>
          </div>
        </Card>

        <Link x1={1440} x2={1520} at={tBrowser - 6} />

        {/* 4: the browser */}
        <Card x={1530} w={320} delay={tBrowser} glowAt={tBrowser + 8}>
          <div style={{ height: 54, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: `1px solid ${theme.colors.line}` }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.85 }} />
            ))}
            <span style={{ marginLeft: 8, fontFamily: theme.fonts.mono, fontSize: 15, color: theme.colors.muted }}>tiny-cpu.vercel.app</span>
          </div>
          <div style={{ padding: "18px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            {stageRows.map((s, i) => {
              const live = prog(frame, tBrowser + 10 + i * 4, tBrowser + 24 + i * 4);
              const on = Math.floor(frame / 8) % 5 === i;
              return (
                <div
                  key={s.name}
                  style={{
                    border: `1.5px solid ${on ? theme.colors.stage[i] : theme.colors.line}`,
                    borderRadius: 8,
                    padding: "7px 12px",
                    fontFamily: theme.fonts.mono,
                    fontSize: 14.5,
                    color: theme.colors.fg,
                    display: "flex",
                    justifyContent: "space-between",
                    opacity: live,
                    background: on ? `${theme.colors.stage[i]}14` : "transparent",
                  }}
                >
                  <span style={{ color: theme.colors.muted, fontWeight: 600 }}>{s.name}</span>
                  <span>{s.text}</span>
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 372, display: "flex", justifyContent: "center", opacity: badgeOn }}>
            <Badge label="A ← EX/MEM" tone="accent" />
          </div>
        </Card>

        {/* proof: the RTL signal travels to the badge it drives */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
          <path d={path} pathLength={1} fill="none" stroke={theme.colors.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${proof} 2`} opacity={proof > 0 ? 1 : 0} />
        </svg>
        <div style={{ position: "absolute", left: 960, top: 732, transform: "translateX(-50%)", opacity: proofLabel }}>
          <div style={{ transform: `translateY(${(1 - proofLabel) * 10}px)` }}>
            <Chip tone="accent" size={24}>
              dbg_fwd_a → the badge you see
            </Chip>
          </div>
        </div>
      </SceneExit>
    </AbsoluteFill>
  );
};
