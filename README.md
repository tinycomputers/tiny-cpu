<div align="center">

# TinyCPU

**A real, synthesizable RV32I RISC-V CPU in SystemVerilog,<br>compiled to WebAssembly and running your assembly live in the browser.**

Third in the series after [tiny-gpu](https://github.com/deaneeth/tiny-gpu) and [tiny-tpu](https://github.com/deaneeth/tiny-tpu).

[![RTL CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml)
[![WASM Build](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml)
[![Web CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

> **Status: Phase 6 done (web app, first slice).** The browser app at `/app` assembles RV32I, runs it on either core in the browser, and steps through every cycle with the pipeline, registers, memory and console. Next: the remaining views.
>
> *Previous: Phase 5 done (WASM harness).* Both cores run in one WebAssembly module (`wasm/build.sh`, 77 KB gzipped) and pass the golden fixtures in Node (`node wasm/test.mjs`). Next: the web app.
>
> *Previous: Phase 4 done (hazards).* Both RV32I cores retire instructions identically to the Python golden ISS on all 40 official `rv32ui-p-*` tests, 5 programs and hundreds of random programs. The 5-stage core has forwarding and load-use stalls (switchable at runtime) and matches an independent timing model cycle for cycle. Next: the WASM harness.
> See [`docs/PLAN.md`](docs/PLAN.md) for the full roadmap.

Every pipeline register, forwarding path and stall the UI will draw is a live `dbg_*` signal from the
compiled RTL. Nothing on screen is faked.

```
rtl/*.sv -> Verilator C++ -> Emscripten -> web/public/tiny_cpu.wasm -> React island -> SVG
```

## Planned

- Single-cycle and 5-stage pipelined RV32I cores sharing one ALU/decoder/regfile
- Verified against a Python golden ISS, the official `riscv-tests` and random hazard-heavy programs
- In-browser assembler, step/rewind, datapath / pipeline / hazard-lab / programs views
- FPGA synthesis numbers (iCE40 / ECP5)

## Layout

| Path | Contents |
|---|---|
| `rtl/` | SystemVerilog: single-cycle and 5-stage cores + building blocks (`spike/counter.sv` is the Phase 0 toolchain check) |
| `sim/` | golden ISS (`sim/golden/`), cocotb tests, asm programs (`sim/programs/`) |
| `sw/` | linker script, crt0, riscv-tests port + Makefile |
| `wasm/` | Verilator -> Emscripten harness |
| `web/` | Astro + React app: assembler, editor, pipeline view, cycle controls |
| `fpga/` | Yosys/nextpnr flows (Phase 9) |
| `docs/` | plan, architecture, state schema |

## Dev quickstart

```bash
# RTL + cocotb (needs Verilator >= 5.036)
python3 -m venv ~/.venvs/tinycpu && source ~/.venvs/tinycpu/bin/activate
pip install -r sim/requirements.txt
verilator --lint-only -Wall --top-module counter rtl/spike/counter.sv
bash scripts/lint.sh && bash sim/run.sh all     # needs: make -C sw all

# WASM (needs Verilator + Emscripten)
bash wasm/build.sh && node wasm/test.mjs

# Web
cd web && pnpm install && pnpm dev     # then open /app (or `pnpm build && pnpm test:e2e` for the smoke tests)
```

## License

MIT
