// Runs an assembled program on the WASM model from a clean reset. One TinyCpuSim per run; the states
// are returned in full so the UI can move backwards and forwards through them without re-running.
import type { AsmResult } from "./assembler";
import type { RawSim, TinyCpuModule } from "./wasm-loader";
import type { CoreName, CycleState } from "./state-schema";
import { isCycleState } from "./state-schema";

export interface RunOptions {
  core: CoreName;
  forwarding: boolean;
  maxCycles: number;
}

export interface RunResult {
  states: CycleState[];
  halted: boolean;
  fault: boolean;
  /** true when the program was cut off at maxCycles before halting */
  truncated: boolean;
  tohost: number | null;
}

export function runProgram(mod: TinyCpuModule, asm: AsmResult, opts: RunOptions): RunResult {
  const sim: RawSim = new mod.TinyCpuSim();
  try {
    sim.setForwarding(opts.forwarding);
    if (!sim.reset(opts.core)) throw new Error(`unknown core ${opts.core}`);
    sim.loadImem(asm.imem);
    sim.loadDmem(asm.dmem);
    sim.start();
    const states = sim.run(opts.maxCycles);
    const bad = states.findIndex((s) => !isCycleState(s));
    if (bad !== -1) throw new Error(`WASM returned an invalid CycleState at cycle ${bad + 1}`);
    const last = states[states.length - 1];
    return {
      states,
      halted: last?.halted ?? false,
      fault: last?.fault ?? false,
      truncated: !(last?.halted || last?.fault),
      tohost: last?.tohost ?? null,
    };
  } finally {
    sim.delete();
  }
}
