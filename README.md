<div align="center">

# TinyCPU

**A real, synthesizable RV32I RISC-V CPU in SystemVerilog,<br>compiled to WebAssembly and running your assembly live in the browser.**

Third in the series after [tiny-gpu](https://github.com/deaneeth/tiny-gpu) and [tiny-tpu](https://github.com/deaneeth/tiny-tpu).

[![RTL CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/rtl.yml)
[![WASM Build](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/wasm.yml)
[![Web CI](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml/badge.svg)](https://github.com/deaneeth/tiny-cpu/actions/workflows/web.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

> **Status: Phase 1 done (golden model).** A Python RV32I ISS passes all 40 official `rv32ui-p-*` tests; the RTL starts in Phase 2.
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
| `rtl/` | SystemVerilog (`spike/counter.sv` is the Phase 0 toolchain check) |
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
cd sim && make WAVES=0

# WASM spike (needs Verilator + Emscripten)
bash wasm/spike/build.sh && node wasm/spike/test.mjs

# Web
cd web && pnpm install && pnpm dev     # open /spike after building the WASM
```

## License

MIT
