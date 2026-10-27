#!/usr/bin/env bash
# cocotb suites. Usage: bash sim/run.sh unit | lockstep | pipe | fpga | all   (needs `source scripts/env.sh`)
# Each suite gets its own SIM_BUILD: cocotb does not notice a TOPLEVEL change in a shared dir.
set -euo pipefail
cd "$(dirname "$0")"
PKG=../rtl/tiny_cpu_pkg.sv
FAILED=()

run() {  # run <test module> <toplevel> <rtl files...>   (env EXTRA_COMPILE_ARGS, SIM_TAG optional)
    local mod=$1 top=$2; shift 2
    local srcs=""
    for f in "$@"; do srcs+=" ../rtl/$f"; done
    echo "=== $mod ($top)"
    if ! make COCOTB_TEST_MODULES="$mod" TOPLEVEL="$top" VERILOG_SOURCES="$PKG$srcs" WAVES=0 \
         SIM_BUILD="sim_build/$mod${SIM_TAG:-}" EXTRA_ARGS="${EXTRA_COMPILE_ARGS:-}" COCOTB_RESULTS_FILE="results_$mod.xml" > "sim_build_$mod.log" 2>&1; then
        FAILED+=("$mod"); tail -n 25 "sim_build_$mod.log"
    elif grep -q 'FAIL=[1-9]' "sim_build_$mod.log"; then
        FAILED+=("$mod"); grep -E "FAIL|Error|assert" "sim_build_$mod.log" | head -n 20
    else
        grep -E "TESTS=" "sim_build_$mod.log" | sed 's/^ *\*\* //; s/ *\*\*$//; s/  */ /g'
    fi
    rm -f "sim_build_$mod.log" "results_$mod.xml"
}

unit() {
    run test_counter      counter      spike/counter.sv   # Phase 0 toolchain check
    run test_alu          alu          alu.sv
    run test_imm_gen      imm_gen      imm_gen.sv
    run test_branch_unit  branch_unit  branch_unit.sv
    run test_lsu          lsu          lsu.sv
    run test_decoder      decoder      decoder.sv
    run test_regfile      regfile      regfile.sv
    SIM_TAG=_nobypass EXTRA_COMPILE_ARGS="-GBYPASS=0" run test_regfile_nobypass regfile regfile.sv
    run test_csr_counters csr_counters csr_counters.sv
    run test_mmio         mmio         mmio.sv
    run test_forward_unit forward_unit forward_unit.sv
    run test_hazard_unit  hazard_unit  hazard_unit.sv
    run test_mem_sync     mem_sync     mem_sync.sv
    SIM_TAG=_oldread EXTRA_COMPILE_ARGS="-GREAD_NEW=0" MEM_READ_NEW=0 run test_mem_sync mem_sync mem_sync.sv
}

lockstep() {
    run test_core_lockstep tiny_cpu_top alu.sv imm_gen.sv branch_unit.sv lsu.sv decoder.sv regfile.sv \
        csr_counters.sv mmio.sv mem_comb.sv mem_sync.sv forward_unit.sv hazard_unit.sv core_single.sv core_pipe.sv tiny_cpu_top.sv
}

pipe() {
    TINYCPU_CORE=PIPE EXTRA_COMPILE_ARGS="-G'CORE=\"PIPE\"'" SIM_TAG=_pipe run test_pipe_lockstep tiny_cpu_top \
        alu.sv imm_gen.sv branch_unit.sv lsu.sv decoder.sv regfile.sv csr_counters.sv mmio.sv mem_comb.sv \
        mem_sync.sv forward_unit.sv hazard_unit.sv core_single.sv core_pipe.sv tiny_cpu_top.sv
    TINYCPU_CORE=PIPE EXTRA_COMPILE_ARGS="-G'CORE=\"PIPE\"'" SIM_TAG=_pipe run test_pipe_hazards tiny_cpu_top \
        alu.sv imm_gen.sv branch_unit.sv lsu.sv decoder.sv regfile.sv csr_counters.sv mmio.sv mem_comb.sv \
        mem_sync.sv forward_unit.sv hazard_unit.sv core_single.sv core_pipe.sv tiny_cpu_top.sv
}

fpga() {
    # The FPGA top runs the fib image from fpga/images/ (absolute path: the simulator's working directory varies).
    local img="$(cd .. && pwd)/fpga/images"
    EXTRA_COMPILE_ARGS="-G'IMEM_INIT=\"$img/fib.imem.hex\"' -G'DMEM_INIT=\"$img/fib.dmem.hex\"' -Wno-PINMISSING" \
        SIM_TAG=_fpga run test_fpga_top fpga_top \
        alu.sv imm_gen.sv branch_unit.sv lsu.sv decoder.sv regfile.sv csr_counters.sv mmio.sv \
        mem_comb.sv mem_sync.sv forward_unit.sv hazard_unit.sv core_single.sv core_pipe.sv tiny_cpu_top.sv \
        ../fpga/ice40/fpga_top.sv
}

case "${1:-all}" in
    unit)     unit ;;
    lockstep) lockstep ;;
    pipe)     pipe ;;
    fpga)     fpga ;;
    all)      unit; lockstep; pipe; fpga ;;
    *) echo "usage: $0 unit|lockstep|pipe|all" >&2; exit 2 ;;
esac

if [ ${#FAILED[@]} -gt 0 ]; then echo "FAILED: ${FAILED[*]}"; exit 1; fi
echo "ALL SUITES PASSED"
