"""Program builder + hazard-free program set, checked on the ISS alone (no RTL, no toolchain)."""

import struct

import pytest

from golden.decode import encode as e
from golden.hazard_free import PROGRAMS, random_program
from golden.iss import CONSOLE_ADDR, DMEM_BASE, Iss
from golden.progbuild import NOP, Prog, raw_hazards, reads


def run(prog):
    imem, dmem = prog.build()
    iss = Iss(imem, dmem)
    trace = iss.run(200_000)
    return iss, trace


def test_pad_inserts_nops_after_every_instruction_and_labels_resolve():
    p = Prog(pad=2)
    p.label("top").addi(1, 0, 1).beq(0, 0, "top")
    imem, _ = p.build()
    words = [int.from_bytes(imem[i : i + 4], "little") for i in range(0, len(imem), 4)]
    assert words[0] == e("addi", 1, 0, imm=1) and words[1:3] == [NOP, NOP]
    assert words[3] == e("beq", 0, 0, 0, imm=-12) and words[4:] == [NOP, NOP]


def test_li_and_li_label_reconstruct_any_value():
    for v in (0, 1, 0x7FF, 0x800, 0xFFF, 0x1000, 0x80000000, 0x7FFFFFFF, 0xFFFFF800, 0xDEADBEEF, 0xFFFFFFFF):
        p = Prog(pad=0)
        p.li(5, v)
        imem = p.build()[0]
        iss = Iss(imem)
        while iss.pc < len(imem):  # li may include gap NOPs at pad=0
            iss.step()
        assert iss.regs[5] == v, hex(v)
    p = Prog(pad=0)
    p.nop(3).label("here").li_label(6, "here", 1)
    imem = p.build()[0]
    iss = Iss(imem)
    while iss.pc < len(imem):
        iss.step()
    assert iss.regs[6] == 13


def test_data_section_layout():
    p = Prog()
    a = p.word(1, 2)
    b = p.bytes_(b"xyz")
    c = p.word(7)  # re-aligned
    assert (a, b, c) == (DMEM_BASE, DMEM_BASE + 8, DMEM_BASE + 12)
    assert p.build()[1] == struct.pack("<II", 1, 2) + b"xyz\0" + struct.pack("<I", 7)


def test_raw_hazard_checker_finds_exactly_the_close_pairs():
    p = Prog(pad=0)
    p.addi(1, 0, 5).addi(2, 1, 1).nop(2).addi(3, 1, 1).nop(1).addi(4, 3, 0)
    _, trace = run(p.exit())
    bad = raw_hazards(trace)
    assert (0, 1, 1) in bad  # x1 read the very next instruction
    assert (0, 4, 1) not in bad  # 4 apart: fine
    assert all(c - pr < 3 for pr, c, _ in bad)
    assert reads(e("sw", 0, 2, 3, imm=0)) == (2, 3) and reads(e("lui", 1, imm=0)) == ()
    assert reads(e("addi", 1, 0, imm=1)) == ()  # x0 is never a hazard


@pytest.mark.parametrize("name", sorted(PROGRAMS))
def test_hazard_free_program_runs_and_is_hazard_free(name):
    iss, trace = run(PROGRAMS[name]())
    assert iss.passed, f"{name}: tohost={iss.tohost}"
    assert raw_hazards(trace) == [], f"{name}: RAW closer than 3 instructions: {raw_hazards(trace)[:3]}"


def test_known_results():
    _, dmem = PROGRAMS["fib"]().build()
    iss, _ = run(PROGRAMS["fib"]())
    assert int.from_bytes(iss.dmem[0:4], "little") == 6765

    iss, _ = run(PROGRAMS["bubble_sort"]())
    assert list(struct.unpack("<8I", iss.dmem[:32])) == sorted([42, 7, 99, 3, 18, 64, 1, 27])

    iss, _ = run(PROGRAMS["memcpy_sum"]())
    words = [(i * 0x01010101) ^ 0xA5A5A5A5 for i in range(12)]
    assert int.from_bytes(iss.dmem[48:52], "little") == sum(words) & 0xFFFFFFFF
    assert [int.from_bytes(iss.dmem[48 + 4 * i : 52 + 4 * i], "little") for i in range(1, 12)] == words[1:]

    iss, _ = run(PROGRAMS["console_and_csr"]())
    assert iss.console_text == "Hi, pipe!\n!"

    iss, _ = run(PROGRAMS["calls"]())
    out = struct.unpack("<4I", iss.dmem[:16])
    assert out[0] == 6 and out[1] == 24  # 3*2, then *2*2
    assert out[3] == 0  # both skipped addi(7, ...) really were skipped


def test_branches_count_taken_paths():
    """x10 = 1 per case (the marker after each label) + 100 per case that was NOT taken."""
    from golden.decode import s32

    vals = {1: 5, 2: 0xFFFFFFFD, 3: 5}
    cond = {"beq": lambda a, b: a == b, "bne": lambda a, b: a != b,
            "blt": lambda a, b: s32(a) < s32(b), "bge": lambda a, b: s32(a) >= s32(b),
            "bltu": lambda a, b: a < b, "bgeu": lambda a, b: a >= b}
    want = 0
    for op in cond:
        for a, b in ((1, 3), (1, 2), (2, 1)):
            want += 1 + (0 if cond[op](vals[a], vals[b]) else 100)
    iss, _ = run(PROGRAMS["branches"]())
    loop_sum, count = struct.unpack("<II", iss.dmem[0:8])
    assert loop_sum == 28  # 7+6+...+1
    assert count == want


@pytest.mark.parametrize("seed", range(40))
def test_random_programs_terminate_and_are_hazard_free(seed):
    iss, trace = run(random_program(seed))
    assert iss.passed
    assert raw_hazards(trace) == []
