# wasm/

`harness.cpp` and `bindings.cpp` build both microarchitectures of `tiny_cpu_top` into one WebAssembly module
(`web/public/tiny_cpu.{mjs,wasm}`). The JavaScript contract is `docs/STATE_SCHEMA.md`.

```bash
source ../scripts/env.sh   # Verilator 5.036 and Emscripten (see CLAUDE.md for the one-time bootstrap)
bash wasm/build.sh         # two Verilations (CORE=SINGLE, CORE=PIPE) + em++ + size budget (400 KB gzipped)
node wasm/test.mjs         # every fixture on both cores, forwarding on and off: console, regs, dmem, digest, cycles
```

- `test/fixtures.json` is generated from the golden ISS: `cd sim && python -m golden.wasm_fixtures`.
  `sim/golden/test_wasm_fixtures.py` fails if it is stale.
- `build.sh` keeps Emscripten's temporaries under `wasm/build/` so a full system disk can't break it.
- `spike/` is the Phase 0 toolchain check (one model per prefix, two counters); kept as a regression of the setup.
- `emscripten_stubs.cpp` supplies the pthread affinity calls that `verilated_threads.cpp` references.

Mutation checks (see CONTEXT.md): dropping a console byte, a cycle off by one, ignoring the forwarding pin and
reversing the shadow-memory byte order each fail `wasm/test.mjs`.
