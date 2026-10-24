#!/usr/bin/env bash
# Verilator -Wall lint of every RTL module standalone, plus the whole design from tiny_cpu_top.
# Usage: bash scripts/lint.sh   (needs `source scripts/env.sh`). Prints only failures.
set -uo pipefail
cd "$(dirname "$0")/.."

PKG=rtl/tiny_cpu_pkg.sv
LEAVES="alu imm_gen branch_unit lsu decoder regfile csr_counters mmio mem_comb"
ALL="$PKG"; for m in $LEAVES core_single tiny_cpu_top; do ALL+=" rtl/$m.sv"; done
status=0

lint() {  # lint <top> <files...>
    local top=$1; shift
    if ! out=$(verilator --lint-only -Wall --top-module "$top" "$@" 2>&1); then
        echo "LINT FAILED: $top"; echo "$out"; status=1
    elif echo "$out" | grep -q '^%Warning'; then
        echo "LINT WARNINGS: $top"; echo "$out"; status=1
    else
        echo "ok  $top"
    fi
}

for m in $LEAVES; do lint "$m" "$PKG" "rtl/$m.sv"; done
lint core_single $ALL
lint tiny_cpu_top $ALL
lint counter rtl/spike/counter.sv
exit $status
