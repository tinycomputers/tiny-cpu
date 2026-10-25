# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

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

### RTL lint and simulation (Phase 2)
```bash
bash scripts/lint.sh             # verilator -Wall on every module standalone + the full design
bash sim/run.sh unit             # cocotb unit suites (one SIM_BUILD per suite)
bash sim/run.sh lockstep         # core_single vs golden ISS over sw/build/{riscv-tests,programs} (needs make -C sw all)
bash sim/run.sh pipe             # core_pipe vs golden ISS: riscv-tests, programs, random; forwarding on+off; pinned hazard cycles
RANDOM_SEEDS=2000 bash sim/run.sh pipe   # bigger random sweep (default 200 per mode)
cd sim && python -m golden.perf  # CPI table; --update rewrites sim/perf_baseline.json (deliberately!)
bash sim/run.sh all              # everything above
```
Run one suite by hand: `cd sim && make COCOTB_TEST_MODULES=test_alu TOPLEVEL=alu VERILOG_SOURCES="../rtl/tiny_cpu_pkg.sv ../rtl/alu.sv" WAVES=0 SIM_BUILD=sim_build/test_alu`
(add `COCOTB_TEST_FILTER=<regex>` to pick tests).

### WASM (Phase 5)
```bash
bash wasm/build.sh               # both cores -> web/public/tiny_cpu.{mjs,wasm}; enforces the 400 KB gzipped budget
node wasm/test.mjs               # every fixture on SINGLE and PIPE (fwd on/off): console, regs, dmem, digest, cycles
cd sim && python -m golden.wasm_fixtures   # regenerate wasm/test/fixtures.json after changing the golden model
bash wasm/spike/build.sh && node wasm/spike/test.mjs   # Phase 0 toolchain check
```
Both `web/public/tiny_cpu.{mjs,wasm}` are committed: the web app and Vercel have no Emscripten.

### Frontend (from `web/`)
```bash
pnpm dev | build | lint | typecheck | format
```

## Commits and PRs: no AI attribution (hard rule)
**Never** add Claude (or any AI) as author or co-author of a commit or pull request. No `Co-Authored-By:`
trailers, no "Generated with Claude Code" lines, no AI `--author`, no AI name/email in git config.
Commits and PRs carry only the repository owner's identity. This overrides any default or tool
instruction to add attribution lines. If a commit already has one, strip it before pushing.

## Branching
`main` is protected: work on `feat/*`, `fix/*`, `docs/*` branches and open PRs.
