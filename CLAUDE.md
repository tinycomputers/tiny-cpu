# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Always read `CONTEXT.md` before any task.** The full roadmap is in `docs/PLAN.md`.

## Project Summary

TinyCPU is a real, synthesizable RV32I RISC-V CPU in SystemVerilog (single-cycle and 5-stage pipelined),
compiled to WASM via Verilator + Emscripten and visualized live in the browser.

Pipeline: `rtl/*.sv` -> Verilator C++ -> Emscripten -> `web/public/tiny_cpu.wasm` -> React island -> SVG.

## Commands

Toolchains are project-local (no root needed). Bootstrap once, then source the env in every shell:

```bash
bash .tools/setup.sh && bash .tools/emsdk.sh && bash .tools/riscv-gcc.sh   # Verilator 5.036, Emscripten, RISC-V GCC
git submodule update --init --depth 1                                         # sw/riscv-tests
python3 -m venv .venv && .venv/bin/pip install -r sim/requirements.txt
source scripts/env.sh
```

Note: `.tools/setup.sh` builds Verilator via CMake, which leaves `PACKAGE_STRING` empty; cocotb parses it,
so the script patches `src/config_package.h.in` first. Never export `VERILATOR_ROOT`.

### Software images and golden model (Phase 1)
```bash
make -C sw all                                  # rv32ui riscv-tests + sim/programs -> sw/build/{riscv-tests,programs}/
python -m pytest sim/golden -q                  # ISS unit tests, rv32ui-p-*, programs, GNU cross-check
cd sim && python -m golden.cli run ../sw/build/programs/fib --trace-last 10
cd sim && python -m golden.gen_isa_ts           # regenerate web/src/lib/isa.ts after editing decode.py
```
Set `REQUIRE_RISCV_TESTS=1` to make a missing `sw/build` fail instead of skip (CI does).

### RTL lint
```bash
verilator --lint-only -Wall --top-module counter rtl/spike/counter.sv   # Phase 0; becomes rtl/*.sv
```

### Simulation (cocotb, run from `sim/`)
```bash
cd sim && make MODULE=test_counter TOPLEVEL=counter VERILOG_SOURCES="$PWD/../rtl/spike/counter.sv" WAVES=0
```

### WASM
```bash
bash wasm/spike/build.sh      # Phase 0 toolchain spike -> web/public/spike/
node wasm/spike/test.mjs      # headless check of the spike build
```

### Frontend (from `web/`)
```bash
pnpm dev | build | lint | typecheck | format
```

## Branching
`main` is protected: work on `feat/*`, `fix/*`, `docs/*` branches and open PRs.
