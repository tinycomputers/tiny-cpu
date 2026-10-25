// Hazard lab: short programs, each isolating one kind of pipeline hazard. Each is run on the pipeline with
// forwarding on and off, and on the single-cycle core as the baseline. The expected shape of the result is
// written next to each case; the Vitest suite checks the measured numbers against it.
import type { AsmResult } from "./assembler";
import { runProgram, type RunResult } from "./runner";
import type { TinyCpuModule } from "./wasm-loader";
import { assemble } from "./assembler";

export interface HazardCase {
  id: string;
  title: string;
  /** what the case isolates */
  why: string;
  /** what to look for in the numbers */
  expect: string;
  source: string;
}

const DATA = "lui t0, 0x10          # t0 = 0x0001_0000 (data memory)\n";

export const HAZARD_CASES: HazardCase[] = [
  {
    id: "independent",
    title: "No dependency",
    why: "Two instructions that do not touch each other's registers.",
    expect: "Full throughput: no stalls, and the same cycles with and without forwarding.",
    source: "addi t0, zero, 5\naddi t1, zero, 6\nnop\nnop\nadd t2, t0, t1\necall\n",
  },
  {
    id: "alu-raw-1",
    title: "ALU to ALU, distance 1",
    why: "The next instruction reads a register written by the one just before it.",
    expect: "Forwarding removes the stall: the forwarded run needs fewer cycles.",
    source: "addi t0, zero, 5\naddi t1, t0, 1\necall\n",
  },
  {
    id: "alu-raw-2",
    title: "ALU to ALU, distance 2",
    why: "One instruction sits between the producer and the consumer.",
    expect: "Smaller penalty than distance 1 without forwarding; none with it.",
    source: "addi t0, zero, 5\nnop\naddi t1, t0, 1\necall\n",
  },
  {
    id: "load-use",
    title: "Load-use",
    why: "A load's value exists only after the MEM stage, so the next instruction must wait one cycle even with forwarding.",
    expect: "One load-use stall with forwarding on; the stalled run is the slower one.",
    source: DATA + "lw t1, 0(t0)\naddi t2, t1, 1\necall\n",
  },
  {
    id: "store-after-load",
    title: "Store of a loaded value",
    why: "The stored register is only needed in EX, so the store can take the value forwarded from WB.",
    expect: "The load-use stall still happens; the store itself adds none.",
    source: DATA + "lw t1, 0(t0)\nsw t1, 4(t0)\necall\n",
  },
  {
    id: "store-then-load",
    title: "Store then load of the same word",
    why: "A load that reads the word a store just wrote: the data memory must return the new value.",
    expect: "No stall in this design: data memory is write-first, so the load sees the store.",
    source: DATA + "addi t1, zero, 7\nsw t1, 8(t0)\nlw t2, 8(t0)\naddi t3, t2, 1\necall\n",
  },
  {
    id: "branch-taken",
    title: "Taken branch",
    why: "Branches resolve in EX and are predicted not-taken, so a taken one flushes the two instructions behind it.",
    expect: "Two extra cycles on the pipeline, with or without forwarding; the single-cycle core has none.",
    source: "beq zero, zero, skip\naddi t0, zero, 1\naddi t0, zero, 2\nskip: addi t1, zero, 3\necall\n",
  },
  {
    id: "branch-not-taken",
    title: "Not-taken branch",
    why: "The prediction is right, so the instructions behind it keep flowing.",
    expect: "No flush and no extra cycles.",
    source: "bne zero, zero, skip\naddi t0, zero, 1\nskip: addi t1, zero, 3\necall\n",
  },
];

export interface HazardOutcome {
  caseId: string;
  asm: AsmResult;
  pipeFwd: RunResult;
  pipeNoFwd: RunResult;
  single: RunResult;
}

export function runHazardCase(mod: TinyCpuModule, c: HazardCase): HazardOutcome {
  const asm = assemble(c.source);
  const opts = { maxCycles: 2000 };
  return {
    caseId: c.id,
    asm,
    pipeFwd: runProgram(mod, asm, { core: "PIPE", forwarding: true, ...opts }),
    pipeNoFwd: runProgram(mod, asm, { core: "PIPE", forwarding: false, ...opts }),
    single: runProgram(mod, asm, { core: "SINGLE", forwarding: true, ...opts }),
  };
}
