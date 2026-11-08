// The persistent "screen recording" of the real app: one continuous camera move through the real UI,
// with a cursor that clicks the real controls. Everything is a pure function of global time, so
// a still at any frame is exactly what the video shows there.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Cursor } from "../fx/Cursor";
import { keys, prog } from "../fx/motion";
import { FPS, lineStart, phraseTime, sceneEnd, sceneStart } from "../schedule";
import { clampOpts, theme } from "../theme";
import { AppPage, type PressKey } from "./AppPage";
import { HELLO_SOURCE, HERO, NOFWD, EVENTS, PRESET_LIST } from "./runData";
import LAYOUT_RAW from "./layout.json";

type Rect = [number, number, number, number]; // x, y, w, h in page coordinates
type Layout = Record<string, Record<string, Rect>>;
const LAYOUT = LAYOUT_RAW as unknown as Layout;
const CHROME_H = 52; // browser bar height above the page
const PAGE_W = 1536;

const R = (level: keyof Layout, name: string): Rect => {
  const r = LAYOUT[level]?.[name];
  if (!r) throw new Error(`missing layout ${level}/${name}`);
  return r;
};
const center = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const union = (...rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r[0]));
  const y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const pad = (r: Rect, p: number): Rect => [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];

interface Cam {
  cx: number;
  cy: number;
  z: number;
}
/** Camera that frames a page rect inside the 1920x(1080 minus caption band) safe area. */
const fit = (level: keyof Layout, r: Rect, maxZ = 3.2): Cam => {
  const [cx, cy] = center(r);
  const z = Math.min((1920 * 0.9) / r[2], 800 / r[3], maxZ);
  return { cx, cy: cy + CHROME_H, z };
};

// ---------------------------------------------------------------------------------------------------------------
// Timeline (seconds, global). Narration phrases pin the moments that matter.
const T = {
  appIn: sceneStart("write") - 0.5,
  openSelect: 15.6,
  pickSort: 16.75,
  assembleClick: phraseTime("write", 1, "and run") + 0.05,
  // pipeline scene: four steps on the beat, then play
  stepStart: sceneStart("pipeline"), // 21.0, 21.5, 22.0, 22.5
  playStart: sceneStart("pipeline") + 2.0, // 23.0
  speedUp: sceneStart("pipeline") + 7.1, // free-run faster for the register / memory tour
  endClick: sceneStart("pipeline") + 9.9, // 30.9
  // hazards
  startClick: sceneStart("hazards") + 0.3,
  playHaz: sceneStart("hazards") + 1.0,
  fwdHold: phraseTime("hazards", 1, "Forwarding paths") - 0.05,
  stallHold: phraseTime("hazards", 1, "Load-use stalls") - 0.15,
  flushHold: phraseTime("hazards", 1, "Branch flushes") - 0.15,
  uncheck: phraseTime("hazards", 2, "forwarding off") + 0.02,
  rerun: phraseTime("hazards", 2, "watch the cycle count") - 0.55,
  endClick2: phraseTime("hazards", 2, "watch the cycle count") + 0.05,
  // views
  tabDatapath: phraseTime("views", 0, "Zoom into") - 0.25,
  datapathSwap: phraseTime("views", 0, "Zoom into") + 0.95,
  tabPrograms: phraseTime("views", 0, "Compare programs") - 0.3,
  heatStart: phraseTime("views", 0, "Explore memory") + 0.1,
  appOut: sceneEnd("views") - 0.45,
};
export const STAGE_T = T;
const STEP_TIMES = [0, 1, 2, 3].map((i) => T.stepStart + i * 0.5);

const idxHero = (t: number): number => {
  const total = HERO.total - 1;
  if (t < T.assembleClick + 0.25) return 0;
  // four ▶ clicks on the beat
  if (t < T.playStart) return STEP_TIMES.filter((s) => t >= s).length;
  if (t < T.endClick) {
    // free-running: 4 cycles/s, then faster, easing to a near-stop on the first store, then on
    const f = t * FPS;
    return Math.round(
      keys(
        f,
        [
          [T.playStart * FPS, 4],
          [T.speedUp * FPS, 24],
          [(T.speedUp + 0.8) * FPS, 37],
          [(T.speedUp + 1.35) * FPS, 41],
          [(T.speedUp + 1.75) * FPS, 42],
          [T.endClick * FPS - 2, 52],
        ],
        theme.ease.soft,
      ),
    );
  }
  if (t < T.startClick) return total;
  // hazards: ⏮ then a run that eases to a stop on each real event
  if (t < T.playHaz) return 0;
  if (t < T.flushHold + 0.9) {
    const k: [number, number][] = [
      [T.playHaz * FPS, 0],
      [(T.fwdHold - 0.35) * FPS, 2],
      [T.fwdHold * FPS, EVENTS.forward],
      [(T.fwdHold + 0.5) * FPS, EVENTS.forward],
      [(T.stallHold - 0.1) * FPS, EVENTS.stall - 1],
      [T.stallHold * FPS, EVENTS.stall],
      [(T.stallHold + 0.55) * FPS, EVENTS.stall],
      [(T.flushHold - 0.1) * FPS, EVENTS.flush - 1],
      [T.flushHold * FPS, EVENTS.flush],
      [(T.flushHold + 0.8) * FPS, EVENTS.flush],
    ];
    return Math.round(keys(t * FPS, k, theme.ease.inOut));
  }
  return EVENTS.flush;
};

// ---------------------------------------------------------------------------------------------------------------

export const AppStage: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // ---- app state at time t
  const rerun = t >= T.rerun;
  const run = t < T.assembleClick + 0.2 ? null : rerun ? NOFWD : HERO;
  const index = rerun ? (t >= T.endClick2 ? NOFWD.total - 1 : 0) : idxHero(t);
  const forwarding = t < T.uncheck;
  const stale = t >= T.uncheck && t < T.rerun;
  const level = t >= T.tabPrograms ? "programs" : t >= T.tabDatapath ? "datapath" : "pipeline";
  const presetId = t >= T.pickSort ? "sort" : "hello";
  const sourceText = t >= T.pickSort ? HERO.source : HELLO_SOURCE;
  const typed = t >= T.pickSort ? Math.round(interpolate(t, [T.pickSort + 0.05, T.pickSort + 1.0], [0, HERO.source.length], { ...clampOpts, easing: theme.ease.out })) : undefined;
  const typedDone = typed === undefined || typed >= HERO.source.length;
  const playing = (() => {
    if (t >= T.playStart && t < T.endClick) return true;
    if (t >= T.playHaz && t < T.flushHold + 0.9) return idxHero(t) !== idxHero(t + 0.12);
    return false;
  })();
  const speed = t >= T.speedUp && t < T.endClick ? 16 : playing ? 4 : 1;

  // ---- cursor script (page coords) + clicks
  const programSel = R("pipeline", "program");
  const assembleBtn = R("pipeline", "assemble");
  const fwdChk = R("pipeline", "forwarding");
  const startBtn = R("pipeline", "start");
  const stepBtn = R("pipeline", "step");
  const playBtn = R("pipeline", "play");
  const endBtn = R("pipeline", "end");
  const tabDp = R("pipeline", "tab-datapath");
  const tabPr = R("pipeline", "tab-programs");
  const pt = (r: Rect, dx = 0.5, dy = 0.5): [number, number] => [r[0] + r[2] * dx, r[1] + r[3] * dy];

  // [time, x, y] keyframes; clicks listed separately
  const stops: { t: number; p: [number, number] }[] = [
    { t: T.appIn + 0.3, p: [pt(programSel)[0] + 320, pt(programSel)[1] + 190] },
    { t: T.openSelect - 0.08, p: pt(programSel, 0.5, 0.5) },
    { t: T.pickSort - 0.1, p: [pt(programSel)[0] + 8, programSel[1] + programSel[3] + 4 + 4 + 28 * 2 + 14] },
    { t: T.assembleClick - 0.1, p: pt(assembleBtn) },
    { t: STEP_TIMES[0] as number - 0.25, p: pt(stepBtn) },
    { t: T.playStart - 0.1, p: pt(playBtn) },
    { t: T.endClick - 0.12, p: pt(endBtn) },
    { t: T.startClick - 0.12, p: pt(startBtn) },
    { t: T.playHaz - 0.1, p: pt(playBtn) },
    { t: T.uncheck - 0.1, p: pt(fwdChk, 0.1, 0.5) },
    { t: T.rerun - 0.1, p: pt(assembleBtn) },
    { t: T.endClick2 - 0.1, p: pt(endBtn) },
    { t: T.tabDatapath - 0.12, p: pt(tabDp) },
    { t: T.tabPrograms - 0.12, p: pt(tabPr) },
    { t: T.appOut, p: [pt(tabPr)[0] + 120, pt(tabPr)[1] + 220] },
  ];
  const clicks = [T.openSelect, T.pickSort, T.assembleClick, ...STEP_TIMES, T.playStart, T.endClick, T.startClick, T.playHaz, T.uncheck, T.rerun, T.endClick2, T.tabDatapath, T.tabPrograms];
  const cx = keys(frame, stops.map((s) => [s.t * FPS, s.p[0]]), theme.ease.soft);
  const cy = keys(frame, stops.map((s) => [s.t * FPS, s.p[1]]), theme.ease.soft);
  const lastClick = clicks.filter((c) => c * FPS <= frame).pop();
  const since = lastClick === undefined ? undefined : frame - lastClick * FPS;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const press: PressKey = (() => {
    if (since === undefined || since > 8 || lastClick === undefined) return null;
    const c = lastClick;
    if (near(c, T.assembleClick) || near(c, T.rerun)) return "assemble";
    if (near(c, T.playStart) || near(c, T.playHaz)) return "play";
    if (near(c, T.endClick) || near(c, T.endClick2)) return "end";
    if (near(c, T.startClick)) return "start";
    if (STEP_TIMES.some((s) => near(c, s))) return "step";
    return null;
  })();

  // ---- camera
  const L = "pipeline" as const;
  const toolbarTabs = pad(union(R(L, "toolbar"), R(L, "tabs")), 30);
  const overview = pad(union(R(L, "source"), R(L, "view"), R(L, "cycle")), 14);
  const pipeRect = pad(R(L, "pipeline"), 16);
  const hm = R("programs", "heatmap");
  const heatRect: Rect = [hm[0], hm[1] - 20, 820, 250];
  const lowerRight: Rect = [640, 790, 880, 335];
  const cams: { t: number; cam: Cam }[] = [
    { t: T.appIn - 0.2, cam: fit(L, [R(L, "toolbar")[0], R(L, "toolbar")[1], 900, 560], 1.9) },
    { t: T.appIn + 1.0, cam: fit(L, [R(L, "toolbar")[0], R(L, "toolbar")[1], 900, 560], 1.9) },
    { t: T.assembleClick + 0.5, cam: fit(L, [R(L, "toolbar")[0], R(L, "toolbar")[1], 900, 560], 1.9) },
    { t: T.assembleClick + 1.3, cam: fit(L, overview, 1.2) },
    { t: STEP_TIMES[3] as number + 0.4, cam: fit(L, overview, 1.2) },
    { t: T.playStart + 0.9, cam: fit(L, pipeRect, 2.3) },
    { t: T.speedUp - 0.3, cam: fit(L, pipeRect, 2.3) },
    { t: T.speedUp + 0.5, cam: fit(L, pad(R(L, "registers"), 14), 2.3) },
    { t: T.speedUp + 1.0, cam: fit(L, pad(R(L, "registers"), 14), 2.3) },
    { t: T.speedUp + 1.6, cam: fit(L, pad(R(L, "memory"), 14), 2.3) },
    { t: T.endClick - 0.55, cam: fit(L, pad(union(R(L, "cycle"), R(L, "lower")), 14), 1.2) },
    { t: T.endClick + 0.9, cam: fit(L, pad(union(R(L, "cycle"), R(L, "lower")), 14), 1.2) },
    { t: T.endClick + 1.7, cam: fit(L, lowerRight, 2.5) },
    { t: T.startClick - 0.1, cam: fit(L, lowerRight, 2.5) },
    { t: T.startClick + 0.5, cam: fit(L, overview, 1.2) },
    { t: T.playHaz + 0.1, cam: fit(L, overview, 1.2) },
    { t: T.playHaz + 1.0, cam: fit(L, pipeRect, 2.3) },
    { t: T.flushHold + 0.8, cam: fit(L, pipeRect, 2.3) },
    { t: T.uncheck - 0.7, cam: fit(L, overview, 1.2) },
    { t: T.endClick2 + 0.5, cam: fit(L, overview, 1.2) },
    { t: T.endClick2 + 1.1, cam: fit(L, [R(L, "controls")[0] + 600, R(L, "controls")[1] - 10, 900, 160], 2.1) },
    { t: T.tabDatapath - 0.55, cam: fit(L, toolbarTabs, 1.35) },
    { t: T.tabDatapath + 0.45, cam: fit("datapath", pad(R("datapath", "view"), 14), 2.0) },
    { t: T.tabPrograms - 0.55, cam: fit("datapath", pad(R("datapath", "view"), 14), 2.0) },
    { t: T.tabPrograms - 0.15, cam: fit(L, toolbarTabs, 1.35) },
    { t: T.tabPrograms + 0.6, cam: fit("programs", pad(R("programs", "view"), 8), 1.2) },
    { t: T.heatStart + 0.5, cam: fit("programs", heatRect, 2.1) },
    { t: T.appOut, cam: fit("programs", heatRect, 2.1) },
  ];
  const seg = (() => {
    for (let i = 0; i < cams.length - 1; i++) {
      const a = cams[i] as { t: number; cam: Cam };
      const b = cams[i + 1] as { t: number; cam: Cam };
      if (t >= a.t && t <= b.t) return { a, b };
    }
    return t < (cams[0] as { t: number }).t ? { a: cams[0], b: cams[0] } : { a: cams[cams.length - 1], b: cams[cams.length - 1] };
  })() as { a: { t: number; cam: Cam }; b: { t: number; cam: Cam } };
  const sp = seg.a === seg.b ? 1 : interpolate(t, [seg.a.t, seg.b.t], [0, 1], { ...clampOpts, easing: theme.ease.inOut });
  const cam: Cam = {
    cx: seg.a.cam.cx + (seg.b.cam.cx - seg.a.cam.cx) * sp,
    cy: seg.a.cam.cy + (seg.b.cam.cy - seg.a.cam.cy) * sp,
    z: seg.a.cam.z * Math.pow(seg.b.cam.z / seg.a.cam.z, sp),
  };
  // idle drift keeps the shot alive during holds
  const driftX = Math.sin(frame / 70) * 5;
  const driftY = Math.cos(frame / 90) * 4;
  const tx = 960 - cam.cx * cam.z + driftX;
  const ty = 520 - cam.cy * cam.z + driftY;
  const toScreen = (p: [number, number]): [number, number] => [tx + p[0] * cam.z, ty + (p[1] + CHROME_H) * cam.z];
  const [sx, sy] = toScreen([cx, cy]);

  // ---- window entrance / exit
  const enter = interpolate(t, [T.appIn, T.appIn + 0.9], [0, 1], { ...clampOpts, easing: theme.ease.out });
  const exit = interpolate(t, [T.appOut, T.appOut + 0.35], [0, 1], { ...clampOpts, easing: theme.ease.in });
  const visible = enter > 0 && exit < 1;
  if (!visible) return null;
  const winScale = interpolate(enter, [0, 1], [0.86, 1]) * (1 + exit * 0.06);

  // ---- editor scroll: follow the line being executed (never scroll while the new source is still typing)
  const win = run ? run.at(index) : null;
  const pc = win ? (win.state.stages[2]?.valid ? win.state.stages[2].pc : win.state.stages[0]?.pc) : undefined;
  const execLine = run && pc !== undefined ? run.asm.lineOf[pc] : undefined;
  const editorScroll = typedDone && execLine ? Math.min(Math.max(0, (execLine - 9) * 24), 520) : 0;

  // ---- dropdown overlay
  const selOpen = t >= T.openSelect + 0.05 && t < T.pickSort + 0.12;
  const listProg = prog(t * FPS, (T.openSelect + 0.05) * FPS, (T.openSelect + 0.3) * FPS);
  const hoverRow = t < T.pickSort - 0.5 ? 0 : Math.min(2, Math.floor((t - (T.pickSort - 0.5)) / 0.2));

  // ---- guide overlays in page coordinates
  const stageNames = ["Fetch", "Decode", "Execute", "Memory", "Write-back"];
  const stageGlow = stageNames.map((n, i) => {
    const at = phraseTime("pipeline", 1, n === "Write-back" ? "Write-back" : n);
    return prog(t * FPS, (at - 0.05) * FPS, (at + 0.1) * FPS) * (1 - prog(t * FPS, (at + 0.38) * FPS, (at + 0.62) * FPS));
  });
  const badgePulse = (() => {
    const evs = [T.fwdHold, T.stallHold, T.flushHold];
    let best = 0;
    for (const e of evs) best = Math.max(best, prog(t * FPS, e * FPS, (e + 0.18) * FPS) * (1 - prog(t * FPS, (e + 0.62) * FPS, (e + 0.85) * FPS)));
    return best;
  })();

  const heatProgress = prog(t * FPS, T.heatStart * FPS, (T.heatStart + 1.0) * FPS, theme.ease.inOut);

  // ---- cycle comparison card (screen space)
  const cmpIn = prog(t * FPS, (T.rerun + 0.3) * FPS, (T.rerun + 0.9) * FPS);
  const cmpOut = prog(t * FPS, (T.tabDatapath - 0.3) * FPS, (T.tabDatapath + 0.1) * FPS, theme.ease.in);
  const cmpCount = prog(t * FPS, T.endClick2 * FPS, (T.endClick2 + 1.1) * FPS, theme.ease.out);

  return (
    <AbsoluteFill style={{ opacity: enter * (1 - exit) }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${winScale})`, transformOrigin: "50% 50%" }}>
        {/* camera */}
        <div style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${cam.z})` }}>
          {/* browser window */}
          <div style={{ borderRadius: 16, overflow: "hidden", border: `1.5px solid ${theme.colors.line}`, boxShadow: "0 60px 140px -50px rgba(0,0,0,0.85)", background: theme.colors.bg, position: "relative" }}>
            <div style={{ height: CHROME_H, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "#10151c", borderBottom: `1px solid ${theme.colors.line}` }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />
              ))}
              <div style={{ marginLeft: 26, flex: 1, maxWidth: 560, height: 30, borderRadius: 8, background: theme.colors.bg, border: `1px solid ${theme.colors.line}`, display: "flex", alignItems: "center", padding: "0 14px", fontFamily: theme.fonts.mono, fontSize: 14.5, color: theme.colors.muted }}>
                <span style={{ color: theme.colors.ok, marginRight: 10 }}>●</span>
                tiny-cpu.vercel.app/app
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <AppPage
                presetId={presetId}
                typed={typed}
                core="PIPE"
                forwarding={forwarding}
                run={run}
                index={index}
                playing={playing}
                speed={speed}
                level={level}
                hazardId="load-use"
                datapathKey={t >= T.datapathSwap ? "load" : "add"}
                programId="sort"
                heatProgress={level === "programs" ? heatProgress : 1}
                stale={stale}
                press={press}
                editorScroll={editorScroll}
                sourceText={sourceText}
              />

              {/* stage highlights while the narration names each stage */}
              {stageGlow.map((g, i) => {
                const r = R("pipeline", `stage${i}`);
                return (
                  g > 0.01 && (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: r[0] - 6,
                        top: r[1] - 6,
                        width: r[2] + 12,
                        height: r[3] + 12,
                        borderRadius: 10,
                        border: `2.5px solid ${theme.colors.stage[i]}`,
                        background: `${theme.colors.stage[i]}12`,
                        opacity: g,
                        transform: `scale(${1 + (1 - g) * 0.06})`,
                        pointerEvents: "none",
                      }}
                    />
                  )
                );
              })}
              {badgePulse > 0.01 && level === "pipeline" && (
                <div
                  style={{
                    position: "absolute",
                    left: R("pipeline", "badges")[0] - 10,
                    top: R("pipeline", "badges")[1] - 8,
                    width: 250,
                    height: R("pipeline", "badges")[3] + 16,
                    borderRadius: 14,
                    border: `2px solid ${theme.colors.accent}`,
                    opacity: badgePulse,
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* the app prints its verdict in a small status line; call it out once the run halts */}
              {level === "pipeline" && win?.state.halted && (
                <div
                  style={{
                    position: "absolute",
                    left: R("pipeline", "console")[0],
                    top: R("pipeline", "console")[1] - 46 + (rerun ? 0 : 0),
                    opacity: prog(t * FPS, (rerun ? T.endClick2 : T.endClick) * FPS + 3, (rerun ? T.endClick2 : T.endClick) * FPS + 14),
                    transform: `translateY(${(1 - prog(t * FPS, (rerun ? T.endClick2 : T.endClick) * FPS + 3, (rerun ? T.endClick2 : T.endClick) * FPS + 14)) * 8}px)`,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${theme.colors.ok}`, color: theme.colors.ok, borderRadius: 999, padding: "5px 16px", fontFamily: theme.fonts.mono, fontSize: 15, background: "rgba(63,185,80,0.10)" }}>
                    ✓ halted at cycle {win.state.cycle} · PASS
                  </span>
                </div>
              )}

              {/* program dropdown (a native <select> popup is not capturable, so this mirrors Chrome's) */}
              {selOpen && (
                <div
                  style={{
                    position: "absolute",
                    left: programSel[0],
                    top: programSel[1] + programSel[3] + 4,
                    width: Math.max(programSel[2], 150),
                    padding: 4,
                    borderRadius: 8,
                    background: "#1c2128",
                    border: `1px solid ${theme.colors.line}`,
                    boxShadow: "0 24px 60px -10px rgba(0,0,0,0.8)",
                    opacity: listProg,
                    transform: `translateY(${(1 - listProg) * -8}px) scaleY(${0.92 + 0.08 * listProg})`,
                    transformOrigin: "50% 0%",
                    fontFamily: theme.fonts.sans,
                    fontSize: 14,
                    zIndex: 20,
                  }}
                >
                  {PRESET_LIST.map((p, i) => {
                    const hot = i === (hoverRow === 2 ? 2 : hoverRow);
                    return (
                      <div key={p.id} style={{ height: 28, display: "flex", alignItems: "center", padding: "0 10px", borderRadius: 5, color: hot ? theme.colors.bg : theme.colors.fg, background: hot ? theme.colors.accent : "transparent", fontWeight: hot ? 600 : 400 }}>
                        {p.title}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* forwarding on vs off: the numbers behind the climb */}
        {cmpIn > 0.01 && cmpOut < 0.99 && (
          <div style={{ position: "absolute", right: 70, top: 150, width: 560, opacity: cmpIn * (1 - cmpOut), transform: `translateY(${(1 - cmpIn) * 30 - cmpOut * 20}px) scale(${0.96 + 0.04 * cmpIn})` }}>
            <div style={{ borderRadius: 22, background: "#161b22", border: `1.5px solid ${theme.colors.line}`, boxShadow: "0 40px 100px -40px rgba(0,0,0,0.9)", padding: "28px 34px 30px" }}>
              <div style={{ fontFamily: theme.fonts.mono, fontSize: 19, color: theme.colors.muted, marginBottom: 16 }}>bubble sort · total cycles</div>
              {[
                { label: "forwarding on", v: HERO.total, color: theme.colors.accent, w: 1 },
                { label: "forwarding off", v: HERO.total + (NOFWD.total - HERO.total) * cmpCount, color: theme.colors.warn, w: (HERO.total + (NOFWD.total - HERO.total) * cmpCount) / NOFWD.total },
              ].map((b) => (
                <div key={b.label} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.fonts.sans, fontSize: 24, color: theme.colors.fgBright, fontWeight: 600, marginBottom: 8 }}>
                    <span>{b.label}</span>
                    <span style={{ fontFamily: theme.fonts.mono, fontVariantNumeric: "tabular-nums" }}>{Math.round(b.v).toLocaleString("en-US")}</span>
                  </div>
                  <div style={{ height: 22, borderRadius: 11, background: "#0d1117", overflow: "hidden", border: `1px solid ${theme.colors.line}` }}>
                    <div style={{ width: `${(b.label === "forwarding on" ? HERO.total / NOFWD.total : b.w) * 100}%`, height: "100%", borderRadius: 11, background: b.color }} />
                  </div>
                </div>
              ))}
              <div style={{ fontFamily: theme.fonts.sans, fontWeight: 800, fontSize: 58, letterSpacing: "-0.04em", color: theme.colors.warn, opacity: cmpCount }}>
                +{Math.round((NOFWD.total - HERO.total) * cmpCount)} cycles <span style={{ fontSize: 34, fontWeight: 600, color: theme.colors.muted }}>(+{Math.round(((NOFWD.total - HERO.total) / HERO.total) * 100 * cmpCount)}%)</span>
              </div>
            </div>
          </div>
        )}

        <Cursor x={sx} y={sy} sinceClick={since} opacity={prog(t * FPS, (T.appIn + 0.3) * FPS, (T.appIn + 0.7) * FPS) * (1 - exit)} />
      </div>
    </AbsoluteFill>
  );
};
