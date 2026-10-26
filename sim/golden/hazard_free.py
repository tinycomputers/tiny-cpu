"""Programs the Phase 3 pipeline (no forwarding, no load-use stall) can run correctly.

Every program is built with Prog(pad=2) except `mem_raw_adjacent`, which is hand-scheduled. They are
checked twice: on the ISS alone (test_progbuild.py: result + no dynamic RAW closer than 3), and on
the RTL in lockstep with the ISS (sim/test_pipe_lockstep.py). Once Phase 4 adds forwarding the same
programs keep working (a faster core still runs hazard-free code correctly).
"""

from __future__ import annotations

import random

from golden.decode import BY_NAME
from golden.iss import CONSOLE_ADDR, CYCLE_ADDR, DMEM_BASE
from golden.progbuild import Prog

R_OPS = ["add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and"]
I_OPS = ["addi", "slti", "sltiu", "xori", "ori", "andi"]
SH_OPS = ["slli", "srli", "srai"]
BRANCH_OPS = ["beq", "bne", "blt", "bge", "bltu", "bgeu"]
VALUES = [0, 1, 0xFFFFFFFF, 0x7FFFFFFF, 0x80000000, 0x12345678, 0xDEADBEEF, 0x000000FF, 0xFFFF8001]


def alu_zoo() -> Prog:
    """Every ALU operation on awkward operands; each result is stored so it is also seen as write data."""
    p = Prog()
    out = p.space(4 * 64)
    p.li(1, 0x80000001)
    p.li(2, 0xFFFFFFF3)
    p.li(3, out)
    k = 0
    for op in R_OPS:
        p.op(op, 4, 1, 2)
        p.sw(4, 3, 4 * k)
        k += 1
    for op in I_OPS:
        for imm in (-1, 0x7FF, -2048):
            p.op(op, 5, 1, imm)
            p.sw(5, 3, 4 * k)
            k += 1
    for op in SH_OPS:
        for sh in (0, 1, 31):
            p.op(op, 6, 2, sh)
            p.sw(6, 3, 4 * k)
            k += 1
    p.lui(7, 0xFFFFF)
    p.auipc(8, 0x1)
    p.sw(7, 3, 4 * k)
    p.sw(8, 3, 4 * k + 4)
    return p.exit()


def mem_zoo() -> Prog:
    """Every load/store size at every offset, including misaligned ones that get forced into alignment."""
    p = Prog()
    buf = p.word(0x80FF7F01, 0xAABBCCDD, 0x00000000, 0xFFFFFFFF)
    p.li(1, buf)
    for i, op in enumerate(["lb", "lbu", "lh", "lhu", "lw"]):
        for off in range(8):
            p.op(op, 2, 1, off)
            p.sw(2, 1, 32 + 4 * (i * 8 + off) % 64)
    p.li(3, 0x11223344)
    for off in range(8):
        p.sb(3, 1, 16 + off)
    p.lw(4, 1, 16)
    p.lw(5, 1, 20)
    for off in (0, 2, 5):
        p.sh(3, 1, 24 + off)
    p.lw(6, 1, 24)
    p.lw(7, 1, 28)
    p.sw(3, 1, 9)  # misaligned word store -> forced to offset 8
    p.lw(8, 1, 8)
    return p.exit()


def mem_raw_adjacent() -> Prog:
    """Hand-scheduled (pad=0): a load directly after a store to the same word. The store writes DMEM
    in MEM at the same edge the load reads it in EX, so this only works because mem_sync is write-first."""
    p = Prog(pad=0)
    buf = p.space(64)
    p.li(1, buf)
    p.li(2, 0xA1B2C3D4)
    p.li(9, 0x5A)
    p.nop(3)
    p.sw(2, 1, 0).lw(3, 1, 0).nop(3)  # word store, word load
    p.sb(2, 1, 5).lw(4, 1, 4).nop(3)  # byte store merged into a later word read
    p.sh(2, 1, 10).lhu(5, 1, 10).nop(3)
    p.sw(2, 1, 16).sw(9, 1, 20).lw(6, 1, 16).lw(7, 1, 20).nop(3)  # back-to-back stores and loads
    p.sb(9, 1, 33).sb(9, 1, 34).lw(8, 1, 32).nop(3)  # two byte stores then a word load
    p.sw(3, 1, 40).nop(3)  # consume an earlier load result
    p.sw(8, 1, 44).nop(3)
    p.exit(1)
    return p


def branches() -> Prog:
    """All six conditions, taken and not taken, forward and backward; x10 counts the taken paths."""
    p = Prog()
    p.li(1, 5)
    p.li(2, 0xFFFFFFFD)  # -3 signed, huge unsigned
    p.li(3, 5)
    p.li(10, 0)
    n = 0
    for op in BRANCH_OPS:
        for a, b in ((1, 3), (1, 2), (2, 1)):
            p.op(op, a, b, f"t{n}")
            p.addi(10, 10, 100)  # executes only when NOT taken
            p.label(f"t{n}")
            p.addi(10, 10, 1)
            n += 1
    p.li(4, 7)  # backward loop: sum 7+6+...+1
    p.li(5, 0)
    p.label("loop")
    p.add(5, 5, 4)
    p.addi(4, 4, -1)
    p.bne(4, 0, "loop")
    p.li(6, DMEM_BASE)
    p.sw(5, 6, 0)
    p.sw(10, 6, 4)
    return p.exit()


def calls() -> Prog:
    """jal/jalr: nested calls, return via ra, a computed jump, and jalr clearing bit 0 of its target."""
    p = Prog()
    out = p.space(32)
    p.li(20, out)
    p.li(5, 3)
    p.jal(1, "double")
    p.sw(5, 20, 0)
    p.jal(1, "double")
    p.jal(1, "double")
    p.sw(5, 20, 4)
    p.li_label(6, "far")
    p.jalr(2, 6, 0)  # indirect jump with link
    p.addi(7, 0, 111)  # skipped
    p.label("far")
    p.nop(2)  # the jump's padding was flushed, so the link register (x2) is only 1 instruction old here
    p.sw(2, 20, 8)
    p.li_label(6, "odd", 1)  # odd target: bit 0 must be ignored
    p.jalr(0, 6, 0)
    p.addi(7, 0, 222)  # skipped
    p.label("odd")
    p.sw(7, 20, 12)
    p.jal(0, "end")  # unconditional forward jump with no link
    p.addi(7, 0, 333)  # skipped
    p.label("double")  # x5 *= 2 then return; nested call through x3
    p.add(5, 5, 5)
    p.jalr(0, 1, 0)
    p.label("end")
    return p.exit()


def console_and_csr() -> Prog:
    """MMIO: print text through CONSOLE, read instret/cycle CSRs and the CYCLE register."""
    p = Prog()
    out = p.space(16)
    p.li(20, out)
    for ch in "Hi, pipe!\n":
        p.putc(ch)
    p.csrrs(21, 0xC02)  # instret: exact, unmasked in lockstep
    p.sw(21, 20, 0)
    p.csrrs(22, 0xC00)  # cycle: timing-dependent, masked
    p.csrrs(23, 0xC01)
    p.csrrs(24, 0xC82)  # instreth: zero
    p.sw(24, 20, 4)
    p.li(25, CYCLE_ADDR)
    p.lw(26, 25, 0)
    p.fence()
    p.putc("!")
    return p.exit()


def fib() -> Prog:
    p = Prog()
    out = p.space(4)
    p.li(5, 20)
    p.li(6, 0)
    p.li(7, 1)
    p.label("loop")
    p.beq(5, 0, "end")
    p.add(28, 6, 7)
    p.addi(6, 7, 0)
    p.addi(7, 28, 0)
    p.addi(5, 5, -1)
    p.jal(0, "loop")
    p.label("end")
    p.li(8, out)
    p.sw(6, 8, 0)  # fib(20) = 6765
    return p.exit()


def bubble_sort() -> Prog:
    p = Prog()
    base = p.word(42, 7, 99, 3, 18, 64, 1, 27)
    n = 8
    p.li(8, base)
    p.li(18, n - 1)
    p.label("outer")
    p.bge(0, 18, "done")
    p.li(5, 0)
    p.addi(6, 8, 0)
    p.label("inner")
    p.bge(5, 18, "next")
    p.lw(11, 6, 0)
    p.lw(12, 6, 4)
    p.bge(12, 11, "noswap")
    p.sw(12, 6, 0)
    p.sw(11, 6, 4)
    p.label("noswap")
    p.addi(5, 5, 1)
    p.addi(6, 6, 4)
    p.jal(0, "inner")
    p.label("next")
    p.addi(18, 18, -1)
    p.jal(0, "outer")
    p.label("done")
    return p.exit()


def memcpy_sum() -> Prog:
    p = Prog()
    src = p.word(*[(i * 0x01010101) ^ 0xA5A5A5A5 for i in range(12)])
    dst = p.space(48)
    p.li(1, dst)
    p.li(2, src)
    p.li(3, 48)  # byte copy loop
    p.label("copy")
    p.beq(3, 0, "sum")
    p.lbu(4, 2, 0)
    p.sb(4, 1, 0)
    p.addi(1, 1, 1)
    p.addi(2, 2, 1)
    p.addi(3, 3, -1)
    p.jal(0, "copy")
    p.label("sum")
    p.li(1, dst)
    p.li(3, 12)
    p.li(9, 0)
    p.label("acc")
    p.beq(3, 0, "fin")
    p.lw(4, 1, 0)
    p.add(9, 9, 4)
    p.addi(1, 1, 4)
    p.addi(3, 3, -1)
    p.jal(0, "acc")
    p.label("fin")
    p.li(1, dst)
    p.sw(9, 1, 0)
    return p.exit()


def random_program(seed: int, n: int = 60) -> Prog:
    """Random straight-line-ish code with forward-only branches (always terminates), padded hazard-free.
    x1 holds a DMEM base that is never overwritten; x2..x15 are scratch."""
    rng = random.Random(seed)
    p = Prog()
    buf = p.space(256)
    p.li(1, buf)
    for r in range(2, 16):
        p.li(r, rng.choice(VALUES) ^ rng.getrandbits(8))
    labels_open: list[tuple[int, str]] = []
    for i in range(n):
        for pending in [x for x in labels_open if x[0] <= i]:
            p.label(pending[1])
            labels_open.remove(pending)
        rd, a, b = (rng.randrange(2, 16) for _ in range(3))
        kind = rng.choices(["r", "i", "sh", "lui", "load", "store", "branch"], [5, 4, 2, 1, 3, 3, 2])[0]
        if kind == "r":
            p.op(rng.choice(R_OPS), rd, a, b)
        elif kind == "i":
            p.op(rng.choice(I_OPS), rd, a, rng.randint(-2048, 2047))
        elif kind == "sh":
            p.op(rng.choice(SH_OPS), rd, a, rng.randrange(32))
        elif kind == "lui":
            p.op(rng.choice(["lui", "auipc"]), rd, rng.getrandbits(20))
        elif kind == "load":
            p.op(rng.choice(["lb", "lbu", "lh", "lhu", "lw"]), rd, 1, rng.randrange(0, 250))
        elif kind == "store":
            p.op(rng.choice(["sb", "sh", "sw"]), a, 1, rng.randrange(0, 250))
        else:
            name = f"L{i}"
            labels_open.append((i + rng.randint(2, 4), name))  # skip >= 2 slots: never a +4 branch
            p.op(rng.choice(BRANCH_OPS), a, b, name)
    for _, name in labels_open:
        p.label(name)
    return p.exit()


PROGRAMS = {
    "alu_zoo": alu_zoo,
    "mem_zoo": mem_zoo,
    "mem_raw_adjacent": mem_raw_adjacent,
    "branches": branches,
    "calls": calls,
    "console_and_csr": console_and_csr,
    "fib": fib,
    "bubble_sort": bubble_sort,
    "memcpy_sum": memcpy_sum,
}

assert all(n in BY_NAME for n in R_OPS + I_OPS + SH_OPS + BRANCH_OPS)
