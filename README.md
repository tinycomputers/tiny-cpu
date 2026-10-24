<div align="center">

# TinyCPU

**A real, synthesizable RV32I RISC-V CPU in SystemVerilog,<br>compiled to WebAssembly and running your assembly live in the browser.**

Third in the series after [tiny-gpu](https://github.com/deaneeth/tiny-gpu) and [tiny-tpu](https://github.com/deaneeth/tiny-tpu).

[![RTL CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml)
[![WASM Build](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml)
[![Web CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

> **Status: Phase 3 done (5-stage pipeline datapath).** Both RV32I cores retire instructions identically to the Python golden ISS: the single-cycle core on all 40 official `rv32ui-p-*` tests plus 5 programs, the 5-stage core on hazard-free programs. Next: forwarding and hazard stalls so the pipeline runs arbitrary code.
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
| `web/` | Astro + React visualizer |
| `fpga/` | Yosys/nextpnr flows (Phase 9) |
| `docs/` | plan, architecture, state schema |

## Dev quickstart

```bash
# RTL + cocotb (needs Verilator >= 5.036)
python3 -m venv ~/.venvs/tinycpu && source ~/.venvs/tinycpu/bin/activate
pip install -r sim/requirements.txt
verilator --lint-only -Wall --top-module counter rtl/spike/counter.sv
bash scripts/lint.sh && bash sim/run.sh all     # needs: make -C sw all

# WASM spike (needs Verilator + Emscripten)
bash wasm/spike/build.sh && node wasm/spike/test.mjs

# Web
cd web && pnpm install && pnpm dev     # open /spike after building the WASM
```

## License

MIT
