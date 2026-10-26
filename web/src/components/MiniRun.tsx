// A small, self-contained run for the landing page and docs: assembles one program, runs it once on the
// chosen core, and lets the reader step through the cycles with the same pipeline view as /app.
import { useEffect, useMemo, useState } from "react";
import { assemble, type AsmResult } from "../lib/assembler";
import { runProgram, type RunResult } from "../lib/runner";
import { buildRunModel, type RunModel } from "../lib/run-model";
import { loadTinyCpu, type TinyCpuModule } from "../lib/wasm-loader";
import type { CoreName } from "../lib/state-schema";
import { PipelineView } from "./PipelineView";

interface Props {
  source: string;
  core: CoreName;
  forwarding?: boolean;
  /** what the reader is looking at, shown above the run */
  caption: string;
  maxCycles?: number;
}

interface Ready {
  asm: AsmResult;
  run: RunResult;
  model: RunModel;
}

const button =
  "rounded-md border border-[var(--line)] px-3 py-1 font-mono text-sm hover:bg-[var(--active)] disabled:opacity-40";

export function MiniRun({ source, core, forwarding = true, caption, maxCycles = 20_000 }: Props) {
  const [mod, setMod] = useState<TinyCpuModule | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTinyCpu(`${import.meta.env.BASE_URL}tiny_cpu.mjs`)
      .then((m) => alive && setMod(m))
      .catch((e: unknown) => alive && setFailure(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const result = useMemo<Ready | { error: string } | null>(() => {
    if (!mod) return null;
    const asm = assemble(source);
    if (!asm.ok) return { error: asm.errors[0]?.message ?? "does not assemble" };
    const run = runProgram(mod, asm, { core, forwarding, maxCycles });
    return { asm, run, model: buildRunModel(run.states, asm.dmem) };
  }, [mod, source, core, forwarding, maxCycles]);

  const ok: Ready | null = result && "run" in result ? result : null;
  const last = ok ? ok.run.states.length - 1 : 0;
  const i = Math.min(index, last);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((k) => {
        if (k >= last) {
          setPlaying(false);
          return k;
        }
        return k + 1;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [playing, last]);

  const state = ok ? (ok.run.states[i] ?? null) : null;
  const stats = ok ? ok.model.stats(i) : null;
  const status = (() => {
    if (failure) return `Could not load the core: ${failure}`;
    if (!result) return "Loading the core…";
    if ("error" in result) return `Assembly error: ${result.error}`;
    if (result.run.fault) return "Fault: the program stopped on an illegal access.";
    if (state?.halted) return `Halted at cycle ${state.cycle}${state.tohost === 1 ? " — PASS" : ""}.`;
    if (result.run.truncated) return `Stopped at ${maxCycles.toLocaleString()} cycles without halting.`;
    return `Cycle ${state?.cycle ?? 0} of ${result.run.states.length}`;
  })();

  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-[var(--fg)]">{caption}</span>
        <span className="font-mono text-xs text-[var(--muted)]">{core === "PIPE" ? (forwarding ? "5-stage, forwarding" : "5-stage, no forwarding") : "single-cycle"}</span>
      </figcaption>

      {ok && state ? (
        <PipelineView state={state} asm={ok.asm} model={ok.model} index={i} core={core} />
      ) : (
        <p className="text-sm text-[var(--muted)]">{status}</p>
      )}

      {ok && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className={button} disabled={i === 0} onClick={() => setIndex(0)} aria-label="Go to start">⏮</button>
            <button className={button} disabled={i === 0} onClick={() => setIndex(Math.max(0, i - 1))} aria-label="Step back">◀</button>
            <button className={button} disabled={i >= last} onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "▶︎"}
            </button>
            <button className={button} disabled={i >= last} onClick={() => setIndex(Math.min(last, i + 1))} aria-label="Step forward">▶</button>
            <button className={button} disabled={i >= last} onClick={() => setIndex(last)} aria-label="Go to end">⏭</button>
            <span className="ml-auto font-mono text-xs text-[var(--muted)]">{status}</span>
          </div>
          {stats && (
            <p className="font-mono text-xs text-[var(--muted)]">
              {stats.instret} instructions · CPI {stats.instret ? stats.cpi.toFixed(2) : "—"}
              {core === "PIPE" ? ` · ${stats.stalls} stalls · ${stats.flushes} flushes` : ""}
            </p>
          )}
        </>
      )}
    </figure>
  );
}
