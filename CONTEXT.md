# CONTEXT.md - TinyCPU

Read this before any task. Full plan: `docs/PLAN.md`.

## What this is
A real, synthesizable RV32I RISC-V CPU in SystemVerilog (single-cycle + 5-stage pipelined cores),
compiled to WASM with Verilator + Emscripten, driven by an in-browser assembler and visualized live.
Third project after tiny-gpu and tiny-tpu; it reuses tiny-tpu's toolchain. Nothing on screen is faked:
every pipeline register, forwarding path and stall comes from a `dbg_*` port on the RTL.

## Status
- Phase 0 (scaffold + toolchain spike): DONE. Verified locally: Verilator lint, cocotb (4 tests), WASM spike with two
  Verilated models in one module (Node + browser), web lint/typecheck/build.
- Phase 1 (golden ISS + riscv-tests port): DONE. `sim/golden/` (decode, encode, disasm, ISS, CLI) passes all 40
  rv32ui-p-* tests, 5 asm programs with pinned console output and instret, and a decode/encode cross-check against
  GNU objdump. `web/src/lib/isa.ts` is generated from `decode.py`.
- Phase 2 (single-cycle core): DONE. `rtl/` has the pkg, alu, imm_gen, branch_unit, lsu, decoder, regfile, csr_counters,
  mmio, mem_comb, core_single, tiny_cpu_top. Lint clean; unit suites for every block; `core_single` passes lockstep
  against the ISS on all 40 riscv-tests + 5 programs, 13 fault cases and CPI == 1. See docs/ARCHITECTURE.md.
- Phase 3 (5-stage pipeline, no forwarding/stall): DONE. `mem_sync.sv`, `core_pipe.sv`, `CORE="PIPE"` in the top, uniform
  per-stage `dbg_*` ports on both cores, `golden/progbuild.py` + `hazard_free.py`. 74 pipe lockstep tests pass; 7 mutants killed.
  Taken-branch flush landed here (not Phase 4) because lockstep needs it. See docs/ARCHITECTURE.md.
- Phase 4 (hazards): DONE. `forward_unit`, `hazard_unit`, `cfg_forward_en` pin, dbg stall/load-use/fwd flags. The pipeline runs the
  40 riscv-tests + all programs + 260 random programs in lockstep in BOTH modes, cycle-exact against `golden/pipemodel.py`.
  11 mutants killed. `sim/perf_baseline.json` pins cycles per core/mode.
- Phase 5 (WASM harness): DONE. `wasm/harness.cpp` owns both Verilated models (`Vcpu_single`, `Vcpu_pipe`, CORE param) behind
  one `TinyCpuSim`. `wasm/build.sh` builds 194 KB raw / 77 KB gzipped. `wasm/test.mjs`: 534 checks over 4 fixtures on both cores.
  The contract is `docs/STATE_SCHEMA.md`.
- Next: Phase 6 (assembler + core UI in `web/`: `assembler.ts`, `state-schema.ts` mirror, `useTinyCpu`, L2 pipeline view first).

## Interfaces Phase 2+ must honour (defined by the ISS, `sim/golden/iss.py`)
- Retire record fields, lane/mask conventions, forced alignment, `cycle_dependent` masking: see the module docstring and PLAN 2.4.
- Image format: `NAME.imem.bin` from 0x0, `NAME.dmem.bin` from 0x10000 (raw little-endian bytes; `.rodata` is in dmem).
- Program pass/fail: write to TOHOST; 1 = PASS, riscv-tests FAIL = (testnum<<1)|1. Faults (illegal insn, bus fault,
  misaligned jump) raise in the ISS; the RTL's behaviour there is undefined, so tests never rely on it.
- `ecall`/`ebreak`/TOHOST halt after the instruction retires. Only `csrrs rd, <cycle|time|instret|*h>, x0` exists.
- Single-cycle core must retire exactly `instret` instructions in `instret` cycles (`sim/programs/expected.json`).

## Gotchas found in Phase 0
- Emscripten lacks pthread affinity APIs; `verilated_threads.cpp` is still required, so link `wasm/emscripten_stubs.cpp`.
- Verilator `--Mdir` does not create parent dirs: `mkdir -p` first.
- cocotb 2.x needs Verilator >= 5.036 and `Clock(..., unit="ns")`.

## Fixed decisions (do not re-litigate; change only via docs/ARCHITECTURE.md)
| Decision | Choice |
|---|---|
| ISA | RV32I only in v1. No M, C, privileged spec, caches or branch predictor. `ecall`/`ebreak` halt. |
| Memory | Harvard, synchronous read. IMEM `0x0000_0000` 4 KiB, DMEM `0x0001_0000` 4 KiB. |
| MMIO | `CONSOLE 0x0002_0000`, `TOHOST 0x0002_0004` (1 = PASS), `CYCLE 0x0002_0008` |
| Branches | Resolved in EX, predict not-taken, 2-cycle flush penalty |
| Forwarding | EX/MEM->EX and MEM/WB->EX for rs1 and rs2; runtime pin `cfg_forward_en` (off: stall on every RAW until WB; costs 2/1/0 for distance 1/2/3, not the 3 first planned) |
| Hazards | Only stall: 1-cycle load-use. Regfile has write-first bypass. `x0` hard-wired to 0 |
| Verification | Unit (cocotb) + golden ISS lockstep + riscv-tests rv32ui-p-* + random programs |
| Retire trace | RVFI-lite record on every core |
| WASM | Two Verilated models (`--prefix Vcpu_pipe`/`Vcpu_single`) linked into one module |

## Conventions
- NO AI attribution in commits/PRs: never `Co-Authored-By: Claude`, never a Claude author (see CLAUDE.md).
- SystemVerilog: 4-space indent, `logic`, `always_ff`/`always_comb`, `-Wall` lint clean.
- Python: 4-space indent, tests under `sim/`, fixed seed 42 (see `sim/conftest.py`).
- Web: Astro + React islands + Tailwind, TypeScript strict. WASM is loaded only inside
  `client:only="react"` islands, never during SSR.
- `docs/STATE_SCHEMA.md` and `web/src/lib/state-schema.ts` must stay in sync (from Phase 5).

## Gotchas found in Phase 1
- No RISC-V target in Emscripten's clang: `.tools/riscv-gcc.sh` downloads the xPack `riscv-none-elf-gcc` (15.2.0-1).
- Build with `-march=rv32i_zicsr_zifencei`; `sw/Makefile` needs `.SECONDARY:` or make deletes the `.imem.bin` intermediates.
- Harvard => `.rodata` must live in DMEM (see `sw/link.ld`), never in IMEM.
- Many rv32ui tests just `#include` the rv64ui source; `sw/env/tinycpu/riscv_test.h` defines `RVTEST_RV64U` for that.

## Gotchas found in Phase 2
- The regfile write-first bypass belongs to the pipeline only; `core_single` instantiates it with `BYPASS=0` (see ARCHITECTURE.md).
- cocotb 2.x: use `COCOTB_TEST_MODULES` (not `MODULE`); never pass `COMPILE_ARGS=` on the make command line (it wipes the
  Makefile's `--prefix Vtop`) - use `EXTRA_ARGS`. After `await ReadOnly()` you cannot write a signal: await a `Timer` first.
- A test that calls a helper repeatedly must start the clock once (`ensure_clock` in test_core_lockstep.py).
- Passing tests prove nothing until a mutant fails them: every suite here was mutation-checked; the jalr-bit0 gap was found that way.

## Gotchas found in Phase 3
- Pipeline needs a write-first DMEM (`mem_sync` READ_NEW=1): a load in EX reads at the same edge the store ahead of it writes.
- Run a PIPE suite with `TINYCPU_CORE=PIPE` and `-G'CORE="PIPE"'` (sim/run.sh pipe does both); `CORE` is a string parameter.
- Cycle-dependent registers must be masked in the final register compare too, not only per retire.
- Dynamic hazard distance != static: instructions at jump targets skip the jump's padding (use `raw_hazards()` on the ISS trace).
- Hazard-free means >= 3 instructions between producer and consumer (2 NOPs) for this pipeline; `Prog.li/exit/putc` add gap NOPs at pad<2.

## Gotchas found in Phase 4
- A taken branch to pc+4 is invisible in `pc_wdata`; `Retire.taken` (ISS) carries it so the timing model stays exact.
- Hand-derived expectations must separate setup from the hazard under test (`lui; lw` is itself a distance-1 RAW).
- A flush hides the stall of the squashed instruction (`jal rd; use rd` costs 2 either way).
- `RANDOM_SEEDS=N bash sim/run.sh pipe` scales the random sweep (default 200 per mode); mutation runs use 40.
- The root filesystem filled during a long mutation sweep (home caches, not this repo): keep `/tmp` and logs small.

## Gotchas found in Phase 5
- Hazard-free programs take the same cycles with forwarding on and off (that is what hazard-free means), so they cannot test
  the forwarding pin. The fixture set includes one hazard-dense program that must differ, and the generator asserts it.
- A harness that re-implements data memory would be tested against itself. The shadow copy is fed only from retire records
  (rvfi_mem_*), and `test.mjs` checks it against the ISS for every store the fixtures make.
- Emscripten's temporaries and Verilator output live under `wasm/build/` (on the project disk); the system disk was full twice
  during this project, and `/tmp` writes broke tool output.
- Both models are held in reset while `loadImem`/`loadDmem` run, so an inactive model is never clocked by accident.
