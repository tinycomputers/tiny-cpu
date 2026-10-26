// Runs every preset on the single-cycle core and on the pipeline (forwarding on), and summarizes each run.
import { assemble } from "./assembler";
import { PRESETS } from "./programs";
import { runProgram, type RunResult } from "./runner";
import type { TinyCpuModule } from "./wasm-loader";
import { buildRunModel } from "./run-model";

export interface CompareRow {
  id: string;
  title: string;
  instructions: number;
  singleCycles: number;
  pipeCycles: number;
  pipeCpi: number;
  stalls: number;
  flushes: number;
  pass: boolean;
  output: string;
  pipeRun: RunResult;
  dmem: Uint8Array;
}

export function comparePresets(mod: TinyCpuModule, maxCycles = 200_000): CompareRow[] {
  return PRESETS.map((p) => {
    const asm = assemble(p.source);
    const single = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles });
    const pipe = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles });
    const model = buildRunModel(pipe.states, asm.dmem);
    const stats = model.stats(pipe.states.length - 1);
    return {
      id: p.id,
      title: p.title,
      instructions: stats.instret,
      singleCycles: single.states.length,
      pipeCycles: pipe.states.length,
      pipeCpi: stats.cpi,
      stalls: stats.stalls,
      flushes: stats.flushes,
      pass: pipe.tohost === 1,
      output: model.consoleAt(pipe.states.length - 1),
      pipeRun: pipe,
      dmem: asm.dmem,
    };
  });
}
