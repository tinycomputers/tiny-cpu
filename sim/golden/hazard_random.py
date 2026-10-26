"""Hazard-heavy random programs for Phase 4: dense code (pad=0), few registers so nearly every
instruction depends on a recent one, loads feeding uses, store->load on the same word, forward branches,
jumps, indirect jumps and instret reads. Always terminates (branches only go forward)."""

from __future__ import annotations

import random

from golden.hazard_free import BRANCH_OPS, I_OPS, R_OPS, SH_OPS
from golden.progbuild import Prog

POOL = [1, 2, 3, 4, 5]  # small register pool => constant dependencies
BASE = 8  # holds the DMEM base address; never written after setup


def random_hazard_program(seed: int, n: int = 70) -> Prog:
    rng = random.Random(seed)
    p = Prog(pad=0)
    buf = p.space(128)
    p.li(BASE, buf)
    for r in POOL:
        p.li(r, rng.getrandbits(32))
    p.nop(3)
    pending: list[tuple[int, str]] = []  # (emit label before instruction #, name)
    for i in range(n):
        for lab in [x for x in pending if x[0] <= i]:
            p.label(lab[1])
            pending.remove(lab)
        rd, a, b = (rng.choice(POOL) for _ in range(3))
        kind = rng.choices(
            ["r", "i", "sh", "lui", "load", "store", "branch", "jal", "jalr", "csr"],
            [6, 5, 2, 1, 5, 4, 3, 1, 1, 1],
        )[0]
        if kind == "r":
            p.op(rng.choice(R_OPS), rd, a, b)
        elif kind == "i":
            p.op(rng.choice(I_OPS), rd, a, rng.randint(-2048, 2047))
        elif kind == "sh":
            p.op(rng.choice(SH_OPS), rd, a, rng.randrange(32))
        elif kind == "lui":
            p.op(rng.choice(["lui", "auipc"]), rd, rng.getrandbits(20))
        elif kind == "load":
            p.op(rng.choice(["lb", "lbu", "lh", "lhu", "lw"]), rd, BASE, rng.randrange(0, 124))
        elif kind == "store":
            p.op(rng.choice(["sb", "sh", "sw"]), a, BASE, rng.randrange(0, 124))
        elif kind == "branch":
            name = f"B{i}"
            pending.append((i + rng.randint(2, 4), name))  # >= 2 ahead: a taken branch is never +4
            p.op(rng.choice(BRANCH_OPS), a, b, name)
        elif kind == "jal":
            name = f"J{i}"
            pending.append((i + rng.randint(2, 4), name))
            p.jal(rng.choice([0, rd]), name)
        elif kind == "jalr":
            name = f"R{i}"
            pending.append((i + rng.randint(3, 5), name))
            p.li_label(6, name, rng.choice([0, 1]))  # x6 is the jump register: odd targets exercise bit 0
            p.jalr(rng.choice([0, rd]), 6, 0)
        else:
            p.csrrs(rd, 0xC02)  # instret: exact in the ISS, so safe to consume
    for _, name in pending:
        p.label(name)
    p.nop(3)
    return p.exit()
