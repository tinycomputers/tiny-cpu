"""Fixtures for the WASM harness tests (wasm/test.mjs), generated from the golden ISS.

    cd sim && python -m golden.wasm_fixtures          # rewrite wasm/test/fixtures.json
    cd sim && python -m golden.wasm_fixtures --check  # exit 1 if stale (pytest does this too)

Each fixture carries the ISS's expected console output, instruction count, final registers, memory
expectations and a SHA-256 digest of the retire stream. The Node test compares the WASM build against
all of them, so the browser build is checked against the Python reference, not against itself.

Cycle counts come from the independent pipeline model (golden/pipemodel.py). They are stored per fixture
and must agree with sim/perf_baseline.json wherever both list the program (test_wasm_fixtures.py checks it).
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

from golden.hazard_free import PROGRAMS
from golden.hazard_random import random_hazard_program
from golden.iss import DMEM_BASE, Iss
from golden.pipemodel import pipe_cycles

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "wasm" / "test" / "fixtures.json"
# Hazard-free programs take the same cycles with forwarding on and off (that is their point), so one
# hazard-dense program is included: it is the only fixture on which the forwarding pin is observable.
HAZARD_SEED = 3
FIXTURE_PROGRAMS = ["fib", "console_and_csr", "bubble_sort", f"hazard_dense/{HAZARD_SEED}"]

# The retire-record fields hashed into the digest, in order. Cycle-dependent values (rdcycle,
# rdtime, CYCLE MMIO) are replaced by 0 because they are timing, not architecture.
DIGEST_FMT = "<13I"


def retire_digest(trace) -> str:
    h = hashlib.sha256()
    for r in trace:
        rd = 0 if r.cycle_dependent else r.rd_wdata
        md = 0 if r.cycle_dependent else r.mem_rdata
        h.update(
            struct.pack(
                DIGEST_FMT,
                r.order, r.pc, r.insn, r.rd_addr, rd, r.pc_wdata, r.mem_addr,
                r.mem_rmask, r.mem_wmask, md, r.mem_wdata, int(r.misaligned), int(r.halt),
            )
        )
    return h.hexdigest()


def timing_registers(trace) -> list[int]:
    """Registers whose final value depends on timing (last written by a cycle-dependent retire)."""
    timing: set[int] = set()
    for r in trace:
        if r.rd_addr:
            (timing.add if r.cycle_dependent else timing.discard)(r.rd_addr)
    return sorted(timing)


def _program(name: str):
    if name.startswith("hazard_dense/"):
        return random_hazard_program(int(name.split("/")[1]))
    return PROGRAMS[name]()


def build_fixture(name: str) -> dict:
    imem, dmem = _program(name).build()
    iss = Iss(imem, dmem)
    trace = iss.run(200_000)
    assert iss.passed, f"{name}: fixture program does not pass on the ISS"
    cycles = {
        "single": iss.instret,
        "pipeFwd": pipe_cycles(trace, True),
        "pipeNoFwd": pipe_cycles(trace, False),
    }
    if name.startswith("hazard_dense/"):
        assert cycles["pipeFwd"] != cycles["pipeNoFwd"], "hazard fixture must show the forwarding pin"
    expect = {}
    if name == "fib":
        expect = {"dmemAddr": DMEM_BASE, "dmemHex": (6765).to_bytes(4, "little").hex()}
    elif name == "bubble_sort":
        values = sorted([42, 7, 99, 3, 18, 64, 1, 27])
        expect = {"dmemAddr": DMEM_BASE, "dmemHex": struct.pack("<8I", *values).hex()}
    return {
        "imem": imem.hex(),
        "dmem": dmem.hex(),
        "console": iss.console_text,
        "instret": iss.instret,
        "cycles": cycles,
        "regs": iss.regs,
        "timingRegs": timing_registers(trace),
        "digest": retire_digest(trace),
        "expect": expect,
    }


def render() -> str:
    data = {(n if n.startswith("hazard_dense/") else f"hazard_free/{n}"): build_fixture(n)
            for n in FIXTURE_PROGRAMS}
    return json.dumps(data, indent=1, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT} is stale: run `cd sim && python -m golden.wasm_fixtures`", file=sys.stderr)
            return 1
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
