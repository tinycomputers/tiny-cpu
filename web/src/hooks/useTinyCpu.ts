// Owns the session: source, assembly, one run on the WASM core, and the cursor through its cycles.
// A run is computed once; stepping, scrubbing and playback only move the index into the saved states.
import { useCallback, useEffect, useState } from "react";
import { assemble, type AsmError, type AsmResult } from "../lib/assembler";
import { buildRunModel, type RunModel } from "../lib/run-model";
import { runProgram, type RunResult } from "../lib/runner";
import { loadTinyCpu, type TinyCpuModule } from "../lib/wasm-loader";
import type { CoreName } from "../lib/state-schema";

export const MAX_CYCLES = 20_000;

export type WasmStatus = { kind: "loading" } | { kind: "ready"; mod: TinyCpuModule } | { kind: "error"; message: string };

export interface Session {
  asm: AsmResult;
  run: RunResult;
  model: RunModel;
  /** what this run was made from; the UI shows a notice when the controls differ from it */
  config: { source: string; core: CoreName; forwarding: boolean };
}

export function useTinyCpu(initialSource: string) {
  const [source, setSource] = useState(initialSource);
  const [core, setCore] = useState<CoreName>("PIPE");
  const [forwarding, setForwarding] = useState(true);
  const [wasm, setWasm] = useState<WasmStatus>({ kind: "loading" });
  const [errors, setErrors] = useState<AsmError[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  useEffect(() => {
    let alive = true;
    loadTinyCpu(`${import.meta.env.BASE_URL}tiny_cpu.mjs`)
      .then((mod) => alive && setWasm({ kind: "ready", mod }))
      .catch((e: unknown) => alive && setWasm({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  const last = session ? Math.max(0, session.run.states.length - 1) : 0;

  const assembleAndRun = useCallback(() => {
    if (wasm.kind !== "ready") return;
    const asm = assemble(source);
    setErrors(asm.errors);
    setPlaying(false);
    if (!asm.ok) {
      setSession(null);
      return;
    }
    const run = runProgram(wasm.mod, asm, { core, forwarding, maxCycles: MAX_CYCLES });
    setSession({ asm, run, model: buildRunModel(run.states, asm.dmem), config: { source, core, forwarding } });
    setIndex(0);
  }, [wasm, source, core, forwarding]);

  // Playback: advance one cycle per tick and stop at the end of the run.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, last]);

  const clamp = (i: number) => Math.max(0, Math.min(i, last));
  const current = session ? session.run.states[Math.min(index, last)] ?? null : null;
  const previous = session && index > 0 ? session.run.states[index - 1] ?? null : null;

  return {
    source,
    setSource,
    core,
    setCore,
    forwarding,
    setForwarding,
    wasm,
    mod: wasm.kind === "ready" ? wasm.mod : null,
    errors,
    session,
    index: clamp(index),
    last,
    current,
    previous,
    playing,
    setPlaying,
    speed,
    setSpeed,
    assembleAndRun,
    goTo: (i: number) => setIndex(clamp(i)),
    stepBy: (d: number) => setIndex((i) => clamp(i + d)),
  };
}
