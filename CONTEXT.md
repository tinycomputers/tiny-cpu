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
- Next: Phase 2 (building blocks + single-cycle core).

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
| Forwarding | EX/MEM->EX and MEM/WB->EX for rs1 and rs2; runtime pin `cfg_forward_en` |
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
