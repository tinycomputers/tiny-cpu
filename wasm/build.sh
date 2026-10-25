#!/usr/bin/env bash
# Phase 5: Verilate tiny_cpu_top twice - CORE="SINGLE" and CORE="PIPE", distinct --prefix - and link both
# into one WebAssembly module. Outputs web/public/tiny_cpu.mjs + tiny_cpu.wasm and checks the size budget.
#
# Prerequisites (run `source scripts/env.sh` first): Verilator >= 5.036 on PATH, Emscripten (em++).
# Emscripten's temporary files go under wasm/build, not /tmp, so a full system disk cannot break the build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD="$SCRIPT_DIR/build"
OUT_DIR="$PROJECT_ROOT/web/public"
SIZE_BUDGET_KB=400   # gzipped .wasm, docs/PLAN.md section 7

export TMPDIR="$BUILD/tmp"
mkdir -p "$TMPDIR" "$OUT_DIR"

VROOT="$(verilator --getenv VERILATOR_ROOT)"
echo "[info] VERILATOR_ROOT = $VROOT"

RTL=""
for f in tiny_cpu_pkg alu imm_gen branch_unit lsu decoder regfile csr_counters mmio mem_comb mem_sync \
         forward_unit hazard_unit core_single core_pipe tiny_cpu_top; do
    RTL+=" $PROJECT_ROOT/rtl/$f.sv"
done

verilate() {  # verilate <CORE> <prefix> <Mdir>
    rm -rf "$3"
    mkdir -p "$3"
    # shellcheck disable=SC2086
    verilator --cc $RTL --top-module tiny_cpu_top --prefix "$2" -G"CORE=\"$1\"" \
        --Mdir "$3" -Wall -Wno-DECLFILENAME
}

echo "[1/3] Verilating tiny_cpu_top for CORE=SINGLE and CORE=PIPE ..."
verilate SINGLE Vcpu_single "$BUILD/obj_single"
verilate PIPE Vcpu_pipe "$BUILD/obj_pipe"

echo "[2/3] Compiling and linking WASM with Emscripten ..."
em++ -O2 -std=c++17 -DVL_IGNORE_UNKNOWN_ARCH \
  -I "$BUILD/obj_single" -I "$BUILD/obj_pipe" -I "$SCRIPT_DIR" -I "$VROOT/include" \
  "$SCRIPT_DIR/bindings.cpp" \
  "$BUILD"/obj_single/Vcpu_single*.cpp \
  "$BUILD"/obj_pipe/Vcpu_pipe*.cpp \
  "$VROOT/include/verilated.cpp" \
  "$VROOT/include/verilated_threads.cpp" \
  "$SCRIPT_DIR/emscripten_stubs.cpp" \
  -lembind \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORT_NAME=createTinyCpu \
  -o "$OUT_DIR/tiny_cpu.mjs"

echo "[3/3] Checking the size budget ..."
WASM="$OUT_DIR/tiny_cpu.wasm"
RAW=$(wc -c < "$WASM")
GZ=$(gzip -9 -c "$WASM" | wc -c)
echo "      tiny_cpu.wasm: $RAW bytes raw, $GZ bytes gzipped (budget ${SIZE_BUDGET_KB} KB gzipped)"
if [ "$GZ" -gt $((SIZE_BUDGET_KB * 1024)) ]; then
    echo "ERROR: gzipped WASM exceeds the ${SIZE_BUDGET_KB} KB budget" >&2
    exit 1
fi
echo "Done: $OUT_DIR/tiny_cpu.mjs + tiny_cpu.wasm"
