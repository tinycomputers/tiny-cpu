import { useEffect, useMemo, useState } from "react";
import { DatapathView } from "./DatapathView";
import { HazardLab } from "./HazardLab";
import { LevelTabs, type Level } from "./LevelTabs";
import { ProgramsView } from "./ProgramsView";
import { AsmEditor } from "./AsmEditor";
import { ConsolePanel } from "./ConsolePanel";
import { Controls } from "./Controls";
import { MemoryView } from "./MemoryView";
import { Panel } from "./Panel";
import { PipelineView } from "./PipelineView";
import { RegisterFile } from "./RegisterFile";
import { StatsBar } from "./StatsBar";
import { PRESETS } from "../lib/programs";
import { MAX_CYCLES, useTinyCpu } from "../hooks/useTinyCpu";
import { DATA_BASE } from "../lib/run-model";
import { datapathFor, lastRetireOrder } from "../lib/datapath";
import { runProgram } from "../lib/runner";

export default function CpuApp() {
  const cpu = useTinyCpu(PRESETS[0]?.source ?? "");
  const [presetId, setPresetId] = useState(PRESETS[0]?.id ?? "");
  const [autoRan, setAutoRan] = useState(false);
  const [level, setLevel] = useState<Level>("pipeline");

  // Run the first preset once the WASM module is ready, so the page opens with a trace to step through.
  useEffect(() => {
    if (cpu.wasm.kind === "ready" && !autoRan) {
      setAutoRan(true);
      cpu.assembleAndRun();
    }
  }, [cpu.wasm.kind, autoRan, cpu]);

  const session = cpu.session;
  const preset = PRESETS.find((p) => p.id === presetId);
  const stale =
    session !== null &&
    (session.config.source !== cpu.source ||
      session.config.core !== cpu.core ||
      session.config.forwarding !== cpu.forwarding);

  // The datapath view shows the single-cycle core. For a pipeline run, the same program is run once on SINGLE, so
  // operand values are exact for the instruction that retired most recently.
  const singleRun = useMemo(() => {
    if (level !== "datapath" || !session || !cpu.mod) return null;
    if (session.config.core === "SINGLE") return session.run;
    return runProgram(cpu.mod, session.asm, { core: "SINGLE", forwarding: true, maxCycles: MAX_CYCLES });
  }, [level, session, cpu.mod]);
  const order = session ? lastRetireOrder(session.run.states, cpu.index) : undefined;
  const dp = singleRun && order !== undefined ? datapathFor(singleRun.states, order) : null;

  const state = cpu.current;
  const prev = cpu.previous;
  const activePc = state ? (state.stages[2]?.valid ? state.stages[2].pc : state.stages[0]?.pc) : undefined;
  const activeLine = session && activePc !== undefined ? session.asm.lineOf[activePc] : undefined;
  const stats = session ? session.model.stats(cpu.index) : null;
  const consoleText = session ? session.model.consoleAt(cpu.index) : "";
  const memLength = Math.min(4096, Math.max(128, Math.ceil((session?.asm.dataBytes ?? 0) / 16) * 16 + 64));

  const status = (() => {
    if (cpu.wasm.kind === "loading") return "Loading the WebAssembly core…";
    if (cpu.wasm.kind === "error") return `Could not load the core: ${cpu.wasm.message}`;
    if (cpu.errors.length > 0) return `Not assembled: ${cpu.errors.length} error${cpu.errors.length === 1 ? "" : "s"}. Fix them and press Assemble & run.`;
    if (!session) return "Ready. Press Assemble & run.";
    if (state?.fault) return `Fault at cycle ${state.cycle}: nothing after this instruction ran.`;
    if (session.run.truncated) return `Stopped at ${MAX_CYCLES.toLocaleString()} cycles without halting.`;
    if (state?.halted) return `Halted at cycle ${state.cycle}${state.tohost === 1 ? " — PASS" : state.tohost !== null ? ` — exit ${state.tohost}` : ""}.`;
    return `Cycle ${state?.cycle ?? 0} of ${session.run.states.length}.`;
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Program
          <select
            aria-label="Program"
            value={presetId}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) {
                setPresetId(p.id);
                cpu.setSource(p.source);
              }
            }}
            className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--fg)]"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Core
          <select
            aria-label="Core"
            value={cpu.core}
            onChange={(e) => cpu.setCore(e.target.value as "SINGLE" | "PIPE")}
            className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--fg)]"
          >
            <option value="PIPE">5-stage pipeline</option>
            <option value="SINGLE">single-cycle</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1 text-sm text-[var(--fg)]">
          <input
            type="checkbox"
            checked={cpu.forwarding}
            disabled={cpu.core !== "PIPE"}
            onChange={(e) => cpu.setForwarding(e.target.checked)}
          />
          forwarding
        </label>
        <button
          onClick={cpu.assembleAndRun}
          disabled={cpu.wasm.kind !== "ready"}
          className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-40"
        >
          Assemble & run
        </button>
        {preset && <p className="ml-auto max-w-md text-sm text-[var(--muted)]">{preset.description}</p>}
        {stale && (
          <p className="w-full rounded border border-[var(--warn)] px-2 py-1 text-sm text-[var(--warn)]">
            The source or settings changed since this run. Press Assemble & run to update the trace.
          </p>
        )}
      </div>

      {cpu.errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-[var(--err)] bg-[var(--panel)] p-3 font-mono text-sm text-[var(--err)]">
          {cpu.errors.map((e, i) => (
            <div key={i}>
              line {e.line}: {e.message}
            </div>
          ))}
        </div>
      )}

      <LevelTabs value={level} onChange={setLevel} />

      {(level === "pipeline" || level === "datapath") && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Source">
            <AsmEditor value={cpu.source} onChange={cpu.setSource} errors={cpu.errors} activeLine={activeLine} />
          </Panel>
          <div role="tabpanel" id={`panel-${level}`} aria-labelledby={`tab-${level}`} className="min-w-0">
            {level === "pipeline" ? (
              <Panel title="Pipeline">
                <PipelineView
                  state={state}
                  asm={session?.asm ?? emptyAsm}
                  model={session?.model ?? emptyModel}
                  index={cpu.index}
                  core={cpu.core}
                />
              </Panel>
            ) : (
              <Panel title="Datapath (single-cycle core)">
                <DatapathView info={dp} />
              </Panel>
            )}
          </div>
        </div>
      )}

      {level === "hazards" && (
        <div role="tabpanel" id="panel-hazards" aria-labelledby="tab-hazards">
          <Panel title="Hazard lab">
            <HazardLab mod={cpu.mod} />
          </Panel>
        </div>
      )}

      {level === "programs" && (
        <div role="tabpanel" id="panel-programs" aria-labelledby="tab-programs">
          <Panel title="Programs: single-cycle vs pipeline">
            <ProgramsView mod={cpu.mod} />
          </Panel>
        </div>
      )}

      {(level === "pipeline" || level === "datapath") && (
        <>
          <Panel title="Cycle">
            <div className="flex flex-col gap-3">
              <Controls
                index={cpu.index}
                last={cpu.last}
                playing={cpu.playing}
                speed={cpu.speed}
                onGoTo={cpu.goTo}
                onStep={cpu.stepBy}
                onPlay={cpu.setPlaying}
                onSpeed={cpu.setSpeed}
                disabled={!session}
              />
              <StatsBar stats={stats} core={cpu.core} forwarding={cpu.forwarding} status={status} />
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Registers">
              <RegisterFile state={state} previous={prev} />
            </Panel>
            <Panel title="Data memory">
              {session ? (
                <MemoryView
                  bytes={session.model.memoryAt(cpu.index)}
                  previous={cpu.index > 0 ? session.model.memoryAt(cpu.index - 1) : null}
                  length={memLength}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">Data starts at 0x{DATA_BASE.toString(16)}.</p>
              )}
            </Panel>
            <Panel title="Console">
              <ConsolePanel text={consoleText} status={session ? `${session.run.states.length} cycles recorded` : ""} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

const emptyAsm = { ok: false, errors: [], imem: new Uint32Array(0), dmem: new Uint8Array(0), symbols: {}, lineOf: {}, textBytes: 0, dataBytes: 0 };
const emptyModel = { states: [], stats: () => ({ cycles: 0, instret: 0, cpi: 0, stalls: 0, loadUse: 0, flushes: 0, forwards: 0 }), memoryAt: () => new Uint8Array(0), consoleAt: () => "" };
