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
- Next: Phase 1 (Python golden ISS + riscv-tests port).

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
- SystemVerilog: 4-space indent, `logic`, `always_ff`/`always_comb`, `-Wall` lint clean.
- Python: 4-space indent, tests under `sim/`, fixed seed 42 (see `sim/conftest.py`).
- Web: Astro + React islands + Tailwind, TypeScript strict. WASM is loaded only inside
  `client:only="react"` islands, never during SSR.
- `docs/STATE_SCHEMA.md` and `web/src/lib/state-schema.ts` must stay in sync (from Phase 5).
