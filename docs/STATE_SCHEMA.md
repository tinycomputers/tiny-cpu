# STATE_SCHEMA.md - the WASM per-cycle contract

The JavaScript API of `wasm/harness.cpp`, as shipped in `web/public/tiny_cpu.mjs`. Every value is read from an
output port of the Verilated model - nothing is re-computed in C++ or JavaScript - except data memory, which is
kept as a shadow copy from the retire records (see below). `wasm/test.mjs` checks this contract.

## Loading and running

```js
const { default: createTinyCpu } = await import("/tiny_cpu.mjs");
const mod = await createTinyCpu();
const sim = new mod.TinyCpuSim();          // owns BOTH cores; one instance is one simulation
sim.setForwarding(true);                    // PIPE only; takes effect at the next reset()
sim.reset("PIPE");                          // "SINGLE" or "PIPE"; false for any other name
sim.loadImem(words);                        // array of uint32, at most 1024 words
sim.loadDmem(bytes);                        // array of bytes, at most 4096, little-endian
sim.start();                                // release reset; cycle 1 is the next step
const states = sim.run(200000);             // every CycleState up to halt/fault (the last one is the halt)
sim.delete();
```

| Method | Returns | Notes |
|---|---|---|
| `reset(core)` | `boolean` | Selects the core, holds reset on both. Clears console and cycle count. |
| `setForwarding(on)` | - | `cfg_forward_en` pin. Ignored by SINGLE (it has no hazards). |
| `loadImem(words)` / `loadDmem(bytes)` | `boolean` | `false` if too large. Both cores are held in reset while loading, and the whole memory is written (zero-padded), so a previous program never leaks. |
| `start()` | - | Releases reset. The next `step()` is cycle 1. |
| `step()` | CycleState \| `null` | One clock edge. `null` before `start()`. After halt or fault it returns the same state without advancing. |
| `run(maxCycles)` | CycleState[] | Steps until halt, fault or the limit. |
| `runFast(maxCycles)` | summary | `{cycles, instret, halted, fault, tohost, console}` without per-cycle states. |
| `getRegs()` | `number[32]` | Architectural registers from the register-file port. |
| `readDmem(addr, len)` | `number[]` | Data memory at absolute address `addr` (base `0x0001_0000`). |
| `getConsole()` | `string` | Bytes written to CONSOLE since `reset()`. |
| `getCycleCount()`, `isHalted()`, `isFault()` | number / boolean | |

## CycleState

Returned by `step()` and `run()`. Each value is the state **after** the clock edge that produced it.

```ts
interface CycleState {
  cycle: number;                       // clock edges since start(); 1 for the first step
  halted: boolean;                     // the halting instruction has retired (ecall, ebreak or a TOHOST store)
  fault: boolean;                      // illegal instruction, bus fault or misaligned jump; nothing retired
  stages: Stage[5];                    // index 0..4 = IF, ID, EX, MEM, WB
  hazard: Hazard;
  regs: number[32];                    // x0..x31 from the register file
  retired: Retire | null;              // the instruction that retired on this edge, if any
  console: number | null;              // byte written to CONSOLE on this edge, else null
  tohost: number | null;               // TOHOST value once written (sticky), else null
  counters: { cycle: number; instret: number };
}

interface Stage {
  name: "IF" | "ID" | "EX" | "MEM" | "WB";
  valid: boolean;                      // a real instruction (false = bubble)
  pc: number;                          // pc of the instruction in this stage
  insn: number;                        // 32-bit instruction word; 0 for IF on PIPE (fetch is synchronous)
}

interface Hazard {
  stall: boolean;                      // ID is stalled this edge
  loadUse: boolean;                    // the stall is a load-use stall (PIPE with forwarding)
  flushIFID: boolean;                  // a taken branch or jump squashed IF/ID this edge
  flushIDEX: boolean;                  // ... and ID/EX
  fwdA: 0 | 1 | 2;                     // operand A forwarded from: 0 none, 1 EX/MEM, 2 MEM/WB
  fwdB: 0 | 1 | 2;
}

interface Retire {                     // RVFI-lite, docs/PLAN.md section 2.4 (field meanings match sim/golden/iss.py)
  order: number;                       // index of this instruction in the retire stream, from 0
  pc: number; insn: number;
  rdAddr: number; rdWdata: number;     // rdAddr 0 = no register written
  pcWdata: number;                     // address of the next instruction
  memAddr: number;                     // word-aligned; 0 if no memory access
  memRmask: number; memWmask: number;  // byte lanes (4 bits)
  memRdata: number; memWdata: number;  // lane-positioned 32-bit words
  misaligned: boolean;                 // a load/store that was forced into alignment
  halt: boolean;
  cycleDep: boolean;                   // value depends on timing (rdcycle/rdtime, CYCLE MMIO)
}
```

### Semantics the UI relies on

* **Cycle numbering.** `cycle` counts clock edges from `start()`. The halting instruction is visible on the edge
  that makes `halted` true, so a run's length in cycles is `run().length`. SINGLE: exactly `instret` cycles. PIPE:
  the value from the timing model `golden/pipemodel.py`, which the RTL suites check cycle for cycle.
* **Stages.** Stage index 0 is IF through index 4 is WB. On SINGLE only IF is populated, and it shows the instruction
  being executed, so SINGLE's `stages[0].insn` is the real word.
* **Console and TOHOST.** `console` is the byte written on that edge; `tohost` stays set after the write.
  A PASS run has `tohost === 1`.
* **Timing-dependent values.** A register last written by a `cycleDep` retire holds a cycle count. Its value
  differs between SINGLE and PIPE and from the ISS. Compare those with care.
* **States after halt or fault.** No instruction retires and no memory changes; the state is frozen.

## Data memory

The RTL keeps data memory inside its memories, so the harness keeps a shadow copy. It is updated from the retire
records (`memWmask` lanes and `memWdata`) for stores into DMEM, and from `loadDmem`. Stores to CONSOLE and TOHOST
are excluded by address. Stores that have not yet retired are not visible, which is the architectural view a
program sees at a halt. Loads never change memory, so the shadow is exact.

## Sync requirements

This document and the ISS (`sim/golden/iss.py`), the timing model (`sim/golden/pipemodel.py`) and the fixtures
(`wasm/test/fixtures.json`, generated by `sim/golden/wasm_fixtures.py`) must agree. `sim/golden/test_wasm_fixtures.py`
checks the fixtures; `wasm/test.mjs` checks the built module against them.

The TypeScript mirror for the web app (`web/src/lib/state-schema.ts`) lands in Phase 6.
