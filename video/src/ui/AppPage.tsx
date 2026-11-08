// The /app page of the web app, driven by props instead of the WASM hook. Layout, classes and sub-components are
// the app's own (web/src/components/*, web/src/pages/app.astro, CpuApp.tsx); only the state is fed from the
// exported run data, so every pixel of the interface is the real interface.
import React, { useLayoutEffect, useRef } from "react";
import { AsmEditor } from "@web/components/AsmEditor";
import { ConsolePanel } from "@web/components/ConsolePanel";
import { DatapathView } from "@web/components/DatapathView";
import { LevelTabs, type Level } from "@web/components/LevelTabs";
import { MemoryView } from "@web/components/MemoryView";
import { Panel } from "@web/components/Panel";
import { PipelineView } from "@web/components/PipelineView";
import { RegisterFile } from "@web/components/RegisterFile";
import { StatsBar } from "@web/components/StatsBar";
import { DATAPATH, PRESET_LIST, type RunBundle } from "./runData";
import { HazardLabView } from "./HazardLabView";
import { ProgramsTableView } from "./ProgramsTableView";

export type PressKey = "assemble" | "start" | "back" | "play" | "step" | "end" | null;

export interface AppProps {
  presetId: string;
  /** characters of the source currently typed in (undefined = all of it) */
  typed?: number;
  core: "PIPE" | "SINGLE";
  forwarding: boolean;
  /** is there a finished run to look at? */
  run: RunBundle | null;
  index: number;
  playing: boolean;
  speed: number;
  level: Level;
  hazardId: string;
  hazardRow?: number;
  datapathKey: "add" | "load" | "branch";
  programId: string;
  heatProgress: number;
  stale: boolean;
  press: PressKey;
  /** editor scroll position in px */
  editorScroll: number;
  /** the line of the program being executed gets a soft band behind it */
  bandLine?: number;
  /** badge pulse: highlights the hazard badges row */
  badgePulse?: number;
  sourceText: string;
}

const button = "rounded-md border border-[var(--line)] px-3 py-1 font-mono text-sm hover:bg-[var(--active)] disabled:opacity-40";
const pressStyle = (on: boolean): React.CSSProperties => (on ? { background: "var(--active)", borderColor: "var(--accent)", transform: "scale(0.94)" } : {});

/** The app's stage timeline scrolls sideways; keep the newest cycles (the highlighted column) in view. */
function ScrollRight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Keep the "stage" column and the newest 4 cycles, hide older columns, so the highlighted current cycle is never off-screen.
    ref.current?.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.children) as HTMLElement[];
      cells.forEach((c, i) => {
        c.style.display = i >= 1 && i < cells.length - 4 ? "none" : "";
      });
    });
  });
  return (
    <div ref={ref} data-focus="pipeline">
      {children}
    </div>
  );
}

function EditorBox({ value, activeLine, scroll, band }: { value: string; activeLine?: number; scroll: number; band?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ta = el.querySelector("textarea");
    const gutter = el.querySelector("[aria-hidden]");
    if (ta) ta.scrollTop = scroll;
    if (gutter) gutter.scrollTop = scroll;
  });
  const top = band !== undefined ? (band - 1) * 24 - scroll + 1 : -100;
  return (
    <div ref={ref} className="relative" data-focus="editor">
      <AsmEditor value={value} onChange={() => {}} errors={[]} activeLine={activeLine} />
      {band !== undefined && top > -24 && top < 416 && (
        <div
          style={{
            position: "absolute",
            left: 49,
            right: 1,
            top,
            height: 24,
            background: "linear-gradient(90deg, rgba(88,166,255,0.2), rgba(88,166,255,0.05))",
            borderLeft: "2px solid var(--accent)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

export function AppPage(p: AppProps) {
  const run = p.run;
  const win = run ? run.at(p.index) : null;
  const prevWin = run && p.index > 0 ? run.at(p.index - 1) : null;
  const state = win?.state ?? null;
  const prev = prevWin?.state ?? null;
  const stats = win ? win.stats : null;
  const consoleText = win?.console ?? "";
  const activePc = state ? (state.stages[2]?.valid ? state.stages[2].pc : state.stages[0]?.pc) : undefined;
  const activeLine = run && activePc !== undefined ? run.asm.lineOf[activePc] : undefined;
  const preset = PRESET_LIST.find((x) => x.id === p.presetId);
  const status = (() => {
    if (!run) return "Ready. Press Assemble & run.";
    if (state?.halted) return `Halted at cycle ${state.cycle}${state.tohost === 1 ? " — PASS" : state.tohost !== null ? ` — exit ${state.tohost}` : ""}.`;
    return `Cycle ${state?.cycle ?? 0} of ${run.total}.`;
  })();
  const last = run ? run.total - 1 : 0;
  const dp = DATAPATH[p.datapathKey];
  const descriptions: Record<string, string> = {
    hello: "Prints a string with a byte loop and a call.",
    fib: "fib(20) in a loop, printed in decimal by repeated subtraction.",
    sort: "Sorts 12 words in data memory, then prints them. Data hazards everywhere.",
    memcpy: "Byte copy, then a word-by-word check that prints OK.",
    primes: "Sieve of Eratosthenes up to 60.",
  };
  const shown = p.typed === undefined ? p.sourceText : p.sourceText.slice(0, p.typed);
  const memLength = 128;

  return (
    <div className="box-border w-[1536px] bg-[var(--bg)] font-sans text-[var(--fg)]" data-page>
      <main className="mx-auto flex max-w-[1536px] flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2" data-focus="header">
          <h1 className="text-2xl font-bold">TinyCPU</h1>
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md border border-[var(--line)] px-2 py-1 text-sm text-[var(--fg)]">
              Light theme
            </button>
            <a className="text-sm underline" style={{ color: "var(--accent)" }}>
              About
            </a>
          </div>
        </header>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3" data-focus="toolbar">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]" data-focus="program">
              Program
              <select
                aria-label="Program"
                value={p.presetId}
                onChange={() => {}}
                className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--fg)]"
              >
                {PRESET_LIST.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Core
              <select
                aria-label="Core"
                value={p.core}
                onChange={() => {}}
                className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--fg)]"
              >
                <option value="PIPE">5-stage pipeline</option>
                <option value="SINGLE">single-cycle</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1 text-sm text-[var(--fg)]" data-focus="forwarding">
              <input type="checkbox" checked={p.forwarding} disabled={p.core !== "PIPE"} onChange={() => {}} />
              forwarding
            </label>
            <button
              data-focus="assemble"
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-40"
              style={p.press === "assemble" ? { transform: "scale(0.95)", filter: "brightness(1.18)" } : undefined}
            >
              Assemble & run
            </button>
            {preset && <p className="ml-auto max-w-md text-sm text-[var(--muted)]">{descriptions[preset.id]}</p>}
            {p.stale && (
              <p className="w-full rounded border border-[var(--warn)] px-2 py-1 text-sm text-[var(--warn)]">
                The source or settings changed since this run. Press Assemble & run to update the trace.
              </p>
            )}
          </div>

          <div data-focus="tabs">
            <LevelTabs value={p.level} onChange={() => {}} />
          </div>

          {(p.level === "pipeline" || p.level === "datapath") && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div data-focus="source">
                <Panel title="Source">
                  <EditorBox value={shown} activeLine={activeLine} scroll={p.editorScroll} band={p.bandLine ?? activeLine} />
                </Panel>
              </div>
              <div role="tabpanel" id={`panel-${p.level}`} aria-labelledby={`tab-${p.level}`} className="min-w-0" data-focus="view">
                {p.level === "pipeline" ? (
                  <Panel title="Pipeline">
                    <ScrollRight>
                      <PipelineView
                        state={state}
                        asm={run?.asm ?? emptyAsm}
                        model={run?.model ?? emptyModel}
                        index={p.index}
                        core={p.core}
                      />
                    </ScrollRight>
                  </Panel>
                ) : (
                  <Panel title="Datapath (single-cycle core)">
                    <DatapathView info={dp} />
                  </Panel>
                )}
              </div>
            </div>
          )}

          {p.level === "hazards" && (
            <div role="tabpanel" id="panel-hazards" aria-labelledby="tab-hazards" data-focus="view">
              <Panel title="Hazard lab">
                <HazardLabView id={p.hazardId} highlightRow={p.hazardRow} />
              </Panel>
            </div>
          )}

          {p.level === "programs" && (
            <div role="tabpanel" id="panel-programs" aria-labelledby="tab-programs" data-focus="view">
              <Panel title="Programs: single-cycle vs pipeline">
                <ProgramsTableView id={p.programId} heatProgress={p.heatProgress} />
              </Panel>
            </div>
          )}

          {(p.level === "pipeline" || p.level === "datapath") && (
            <>
              <div data-focus="cycle">
                <Panel title="Cycle">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2" data-focus="controls">
                      <button className={button} style={pressStyle(p.press === "start")} data-btn="start" aria-label="Go to start">⏮</button>
                      <button className={button} style={pressStyle(p.press === "back")} data-btn="back" aria-label="Step back">◀</button>
                      <button className={button} style={pressStyle(p.press === "play")} data-btn="play" aria-label={p.playing ? "Pause" : "Play"}>
                        {p.playing ? "❚❚" : "▶︎"}
                      </button>
                      <button className={button} style={pressStyle(p.press === "step")} data-btn="step" aria-label="Step forward">▶</button>
                      <button className={button} style={pressStyle(p.press === "end")} data-btn="end" aria-label="Go to end">⏭</button>
                      <input
                        type="range"
                        aria-label="Cycle"
                        min={0}
                        max={Math.max(0, last)}
                        value={Math.min(p.index, last)}
                        readOnly
                        onChange={() => {}}
                        className="min-w-32 flex-1"
                      />
                      <label className="flex items-center gap-1 font-mono text-xs text-[var(--muted)]">
                        speed
                        <select
                          aria-label="Playback speed"
                          value={p.speed}
                          onChange={() => {}}
                          className="rounded border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-[var(--fg)]"
                        >
                          {[1, 2, 4, 8, 16, 32].map((s) => (
                            <option key={s} value={s}>
                              {s}/s
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div data-focus="stats">
                      <StatsBar stats={stats} core={p.core} forwarding={p.forwarding} status={status} />
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[640px_450px_minmax(0,1fr)]" data-focus="lower">
                <div data-focus="registers">
                  <Panel title="Registers">
                    <RegisterFile state={state} previous={prev} />
                  </Panel>
                </div>
                <div data-focus="memory">
                  <Panel title="Data memory">
                    {run ? (
                      <MemoryView bytes={win?.mem ?? new Uint8Array(0)} previous={prevWin?.mem ?? null} length={memLength} />
                    ) : (
                      <p className="text-sm text-[var(--muted)]">Data starts at 0x10000.</p>
                    )}
                  </Panel>
                </div>
                <div data-focus="console">
                  <Panel title="Console">
                    <ConsolePanel text={consoleText} status={run ? `${run.total} cycles recorded` : ""} />
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const emptyAsm = { ok: false, errors: [], imem: new Uint32Array(0), dmem: new Uint8Array(0), symbols: {}, lineOf: {}, textBytes: 0, dataBytes: 0 };
const emptyModel = { states: [], stats: () => ({ cycles: 0, instret: 0, cpi: 0, stalls: 0, loadUse: 0, flushes: 0, forwards: 0 }), memoryAt: () => new Uint8Array(0), consoleAt: () => "" };
