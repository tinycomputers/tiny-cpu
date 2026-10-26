"""Directed hazard patterns on the 5-stage core: PINNED cycle counts and the hazard debug flags.

The expected "extra cycles" in golden/hazard_cases.py were derived on paper (not from the RTL) and are
checked against the independent model in the ISS-only tests; here the RTL must hit the same numbers in
both forwarding modes, and its dbg_stall / dbg_load_use / dbg_fwd_* pins must tell the same story.
"""

import cocotb
from cocotb.triggers import ReadOnly, RisingEdge

from golden.hazard_cases import CASES, DMEM
from golden.iss import Iss
from golden.pipemodel import is_redirect, stalls
from lockstep_lib import CORE, e, lockstep, reset_and_load

assert CORE == "PIPE", "run through `bash sim/run.sh pipe`"

LOAD_USE_ONCE = {"load->use dist 1", "load->store-data dist 1", "load->store-address dist 1", "csr->use dist 1",
                 "both operands late"}
# forwarding sources seen (1 = EX/MEM, 2 = MEM/WB) when forwarding is ON; everything else must be quiet
FWD_SEEN = {"alu->alu dist 1": {1}, "alu->alu dist 2": {2}, "load->use dist 1": {2}, "load->use dist 2": {2},
            "load->store-data dist 1": {2}, "load->store-address dist 1": {2}, "csr->use dist 1": {2},
            "both operands late": {2}}


def image(insns) -> bytes:
    return b"".join(w.to_bytes(4, "little") for w in (*insns, e("ecall")))


async def observe(dut, imem, forward):
    await reset_and_load(dut, imem, DMEM, forward)
    rows = []
    for _ in range(2000):
        await RisingEdge(dut.clk)
        await ReadOnly()
        rows.append({k: int(getattr(dut, f"dbg_{k}").value) for k in ("stall", "load_use", "fwd_a", "fwd_b", "flush_ifid")}
                    | {"halted": int(dut.halted.value)})
        if rows[-1]["halted"]:
            return rows
    raise AssertionError("no halt")


@cocotb.parametrize(name=sorted(CASES), forward=[1, 0])
async def test_pinned_cycle_counts(dut, name, forward):
    insns, extra_on, extra_off = CASES[name]
    iss, _, cycles = await lockstep(dut, image(insns), DMEM, expect_fault=False, forward=forward)
    want = extra_on if forward else extra_off
    assert cycles - (iss.instret + 4) == want, (
        f"{name} forward={forward}: {cycles - (iss.instret + 4)} extra cycles, expected {want}")


@cocotb.parametrize(name=sorted(CASES), forward=[1, 0])
async def test_debug_flags(dut, name, forward):
    insns, _, _ = CASES[name]
    imem = image(insns)
    trace = Iss(imem, DMEM).run(1000)
    rows = await observe(dut, imem, forward)

    assert sum(r["stall"] for r in rows) == stalls(trace, bool(forward)), f"{name}: stall cycles"
    assert sum(r["flush_ifid"] for r in rows) == sum(is_redirect(r) for r in trace), f"{name}: flushes"
    assert sum(r["load_use"] for r in rows) == (1 if name in LOAD_USE_ONCE else 0), f"{name}: load-use pulses"
    seen = {v for r in rows for v in (r["fwd_a"], r["fwd_b"]) if v}
    assert seen == (FWD_SEEN.get(name, set()) if forward else set()), f"{name} forward={forward}: fwd sources {seen}"
