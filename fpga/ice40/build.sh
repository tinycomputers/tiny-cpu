#!/usr/bin/env bash
# Synthesize, place and route fpga_top for the iCE40UP5K (iCEBreaker) and report utilization and fmax.
# Needs the Yosys and nextpnr packages in .venv (see fpga/README.md); run from anywhere.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
mkdir -p "$BUILD"
cd "$HERE"

YOSYS="${YOSYS:-$ROOT/.venv/bin/yowasp-yosys}"
NEXTPNR="${NEXTPNR:-$ROOT/.venv/bin/yowasp-nextpnr-ice40}"
FREQ_MHZ=12   # the iCEBreaker oscillator

# Yosys cannot read the RTL's header-level package import, so it gets a converted copy (see fpga/prepare_rtl.py).
FILES=""
for f in tiny_cpu_pkg alu imm_gen branch_unit lsu decoder regfile csr_counters mmio mem_comb mem_sync \
         forward_unit hazard_unit core_single core_pipe tiny_cpu_top; do
    FILES+=" $ROOT/rtl/$f.sv"
done
rm -rf "$BUILD/rtl"
python3 "$ROOT/fpga/prepare_rtl.py" "$BUILD/rtl" $FILES "$HERE/fpga_top.sv"
RTL=""
for f in $FILES "$HERE/fpga_top.sv"; do
    RTL+=" $BUILD/rtl/$(basename "$f")"
done

echo "[1/3] Yosys: synthesis, latch check"
"$YOSYS" -q -l "$BUILD/yosys.log" -p "
    read_verilog -sv $RTL;
    hierarchy -top fpga_top -check;
    proc;
    select -assert-none t:\$dlatch t:\$adlatch t:\$dlatchsr t:\$sr t:\$dffsr;
    synth_ice40 -top fpga_top -json $BUILD/fpga.json;
    stat;
    check -assert" 

echo "[2/3] nextpnr: place and route for iCE40UP5K at ${FREQ_MHZ} MHz"
"$NEXTPNR" --up5k --package sg48 --freq "$FREQ_MHZ" \
    --json "$BUILD/fpga.json" --pcf "$HERE/icebreaker.pcf" --asc "$BUILD/fpga.asc" \
    --pcf-allow-unconstrained --report "$BUILD/report.json" -l "$BUILD/nextpnr.log" >/dev/null

echo "[3/3] Results"
python3 - "$BUILD/report.json" "$BUILD/yosys.log" "$BUILD/nextpnr.log" <<'PY'
import json, re, sys
report = json.load(open(sys.argv[1]))
yosys_log = open(sys.argv[2]).read()
nextpnr_log = open(sys.argv[3]).read()
util = report.get("utilization", {})
def used(name):
    u = util.get(name, {})
    return u.get("used"), u.get("available")
# nextpnr prints the timing twice; the last one is after routing, the number to quote.
fmax = re.findall(r"Max frequency for clock '([^']+)': ([0-9.]+) MHz", nextpnr_log)[-1:]
print("utilization (used / available):")
for name in ("ICESTORM_LC", "ICESTORM_RAM", "SB_RAM40_4K", "ICESTORM_DSP", "SB_IO"):
    if name in util:
        u, a = used(name)
        print(f"  {name:14s} {u} / {a}")
for clk, mhz in fmax:
    print(f"fmax (post-route) for '{clk}': {mhz} MHz")
PY
echo "Logs: $BUILD/yosys.log, $BUILD/nextpnr.log"
