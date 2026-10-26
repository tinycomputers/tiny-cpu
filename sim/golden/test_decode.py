import random

import pytest

from golden.decode import (
    BY_NAME,
    INSNS,
    REG_NAMES,
    decode,
    disasm,
    encode,
    imm_b,
    imm_i,
    imm_j,
    imm_s,
    imm_u,
    lookup,
)


def rand_fields(rng, d):
    a = dict(rd=rng.randrange(32), rs1=rng.randrange(32), rs2=rng.randrange(32))
    imm = {
        "I": lambda: rng.randint(-2048, 2047),
        "SH": lambda: rng.randrange(32),
        "S": lambda: rng.randint(-2048, 2047),
        "B": lambda: rng.randrange(-2048, 2048) * 2,
        "U": lambda: rng.randrange(1 << 20) << 12,
        "J": lambda: rng.randrange(-(1 << 19), 1 << 19) * 2,
    }.get(d.fmt, lambda: 0)()
    return a, imm


def test_table_has_every_rv32i_instruction():
    names = {d.name for d in INSNS}
    # 38 RV32I base (37 + fence) + ecall/ebreak + the Zicntr csrrs read
    assert len(INSNS) == 41 and len(names) == 41
    assert {"lui", "auipc", "jal", "jalr", "sltiu", "srai", "sra", "fence", "ecall"} <= names


def test_no_two_definitions_overlap():
    for i, a in enumerate(INSNS):
        for b in INSNS[i + 1 :]:
            common = a.mask & b.mask
            assert a.match & common != b.match & common, f"{a.name} overlaps {b.name}"


@pytest.mark.parametrize("d", INSNS, ids=lambda d: d.name)
def test_encode_decode_roundtrip(d):
    rng = random.Random(42)
    for _ in range(300):
        a, imm = rand_fields(rng, d)
        w = encode(d.name, imm=imm, csr=0xC00, **a)
        x = decode(w)
        assert x is not None and x.name == d.name and x.insn == w
        assert lookup(w) is BY_NAME[d.name]
        if d.fmt in ("I", "SH", "S", "B", "U", "J"):
            assert x.imm == (imm if d.fmt != "U" else (imm if imm < 1 << 31 else imm - (1 << 32)))
        if d.fmt in ("R", "I", "SH", "U", "J", "CSR"):
            assert x.rd == a["rd"]
        if d.fmt in ("R", "I", "SH", "S", "B", "CSR"):
            assert x.rs1 == a["rs1"]
        if d.fmt in ("R", "S", "B"):
            assert x.rs2 == a["rs2"]


def test_immediate_extremes():
    assert imm_i(encode("addi", imm=-2048)) == -2048
    assert imm_i(encode("addi", imm=2047)) == 2047
    assert imm_s(encode("sw", imm=-1)) == -1
    assert imm_b(encode("beq", imm=-4096)) == -4096 and imm_b(encode("beq", imm=4094)) == 4094
    assert imm_j(encode("jal", imm=-(1 << 20))) == -(1 << 20)
    assert imm_j(encode("jal", imm=(1 << 20) - 2)) == (1 << 20) - 2
    assert imm_u(encode("lui", imm=0xFFFFF000)) == -4096


@pytest.mark.parametrize(
    "name,kw",
    [
        ("addi", dict(imm=2048)),
        ("addi", dict(imm=-2049)),
        ("beq", dict(imm=3)),  # odd offset
        ("jal", dict(imm=1 << 20)),
        ("slli", dict(imm=32)),
        ("add", dict(rd=32)),
    ],
)
def test_encode_rejects_bad_operands(name, kw):
    with pytest.raises(ValueError):
        encode(name, **kw)


def test_known_encodings():
    # Reference words produced by GNU as (riscv-none-elf-gcc 15.2).
    assert encode("addi", 1, 0, imm=5) == 0x00500093
    assert encode("add", 3, 1, 2) == 0x002081B3
    assert encode("sub", 3, 1, 2) == 0x402081B3
    assert encode("lw", 5, 2, imm=8) == 0x00812283
    assert encode("sw", 0, 2, 5, imm=8) == 0x00512423
    assert encode("lui", 1, imm=0x12345000) == 0x123450B7
    assert encode("jal", 0, imm=0) == 0x0000006F
    assert encode("ecall") == 0x00000073 and encode("ebreak") == 0x00100073


def test_illegal_words_do_not_decode():
    for w in (0x00000000, 0xFFFFFFFF, 0x0000007F, 0x40001033, 0x00100073 | 1 << 7):
        assert decode(w) is None, hex(w)


def test_disassembly():
    assert disasm(0x00500093) == "addi ra, zero, 5"
    assert disasm(encode("lw", 10, 2, imm=-4)) == "lw a0, -4(sp)"
    assert disasm(encode("sw", 0, 2, 10, imm=12)) == "sw a0, 12(sp)"
    assert disasm(encode("beq", 0, 1, 2, imm=-8), pc=0x20) == "beq ra, sp, 0x18"
    assert disasm(encode("lui", 3, imm=0x12345000)) == "lui gp, 0x12345"
    assert disasm(encode("slli", 1, 2, imm=3)) == "slli ra, sp, 3"
    assert disasm(0) == ".word 0x00000000"
    assert disasm(encode("csrrs", 5, 0, csr=0xC00)) == "csrrs t0, cycle, zero"
    assert len(REG_NAMES) == 32


def test_generated_isa_ts_is_up_to_date():
    from golden.gen_isa_ts import OUT, render

    assert OUT.exists() and OUT.read_text() == render(), "run: cd sim && python -m golden.gen_isa_ts"
