"""Independent timing model of the 5-stage pipeline, computed from an ISS retire trace.

This is the oracle for the RTL's cycle counts (Phase 4). It knows nothing about the RTL - only the
pipeline's rules - so agreement is real evidence and not the RTL checking itself.

Let T(i) be the cycle in which instruction i is in EX (IF is T-2, ID is T-1, MEM is T+1, WB is T+2),
counting the first cycle after reset release as cycle 1; instruction 0 is in EX in cycle 3.

  * in order, one per cycle:              T(i) >= T(i-1) + 1
  * after a taken branch/jump (flush):    T(i) >= T(branch) + 3        (the 2-cycle penalty)
  * RAW hazard on source register s whose latest writer is p, with forwarding ON:
        loads and CSR reads (result only exists in WB):  T(i) >= T(p) + 2   (the load-use stall)
        everything else (forwarded from EX/MEM):          T(i) >= T(p) + 1   (no stall)
  * RAW hazard with forwarding OFF: T(i) >= T(p) + 3 - the consumer waits in ID until the producer
    is in WB, where the register file's write-first bypass delivers the value.

The halting instruction retires after WB, so the run takes T(last) + 2 cycles.
"""

from __future__ import annotations

from golden.decode import LOADS, decode
from golden.progbuild import reads

EX_OF_FIRST = 3  # IF in cycle 1, ID in cycle 2, EX in cycle 3
FLUSH_GAP = 3  # a redirecting instruction in EX at T lets its target reach EX at T + 3
WB_AFTER_EX = 2


def is_redirect(r) -> bool:
    """Taken branch or any jump: the pipeline flushes IF/ID for each, even a taken branch to pc+4."""
    return r.taken


def is_late(insn: int) -> bool:
    """Result is only available in WB: loads (data arrives in MEM, not forwarded) and CSR reads."""
    x = decode(insn)
    return x.name in LOADS or x.name == "csrrs"


def ex_cycles(trace, forward: bool = True) -> list[int]:
    """T(i) for every instruction in the trace."""
    T: list[int] = []
    last_writer: dict[int, int] = {}
    for i, r in enumerate(trace):
        t = EX_OF_FIRST if i == 0 else T[i - 1] + 1
        if i and is_redirect(trace[i - 1]):
            t = max(t, T[i - 1] + FLUSH_GAP)
        for s in reads(r.insn):
            p = last_writer.get(s)
            if p is None:
                continue
            if not forward:
                need = T[p] + 3
            else:
                need = T[p] + 2 if is_late(trace[p].insn) else T[p] + 1
            t = max(t, need)
        T.append(t)
        if r.rd_addr:
            last_writer[r.rd_addr] = i
    return T


def pipe_cycles(trace, forward: bool = True) -> int:
    """Cycles from reset release until the last instruction's retire is visible."""
    return ex_cycles(trace, forward)[-1] + WB_AFTER_EX if trace else 0


def stalls(trace, forward: bool = True) -> int:
    """Cycles lost to data-hazard stalls (excludes the flush penalty and pipeline fill)."""
    T = ex_cycles(trace, forward)
    lost = 0
    for i in range(1, len(T)):
        floor = T[i - 1] + (FLUSH_GAP if is_redirect(trace[i - 1]) else 1)
        lost += T[i] - floor
    return lost
