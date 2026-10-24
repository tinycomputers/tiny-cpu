"""Decoder: control bundle per instruction, and legality identical to the golden ISS."""

import random

import cocotb
from cocotb.triggers import Timer

from consts import ALU, IMM, SZ, WB
from golden.decode import CSR_NAMES, INSNS, decode, encode

SIGNALS = ["alu_op", "a_pc", "b_imm", "imm_sel", "reg_we", "wb_sel", "mem_re", "mem_we", "mem_size",
           "mem_unsigned", "is_branch", "is_jal", "is_jalr", "uses_rs1", "uses_rs2", "is_halt", "illegal"]
DEFAULT = dict(alu_op=ALU["ADD"], a_pc=0, b_imm=0, imm_sel=IMM["I"], reg_we=0, wb_sel=WB["ALU"], mem_re=0,
               mem_we=0, mem_size=SZ["WORD"], mem_unsigned=0, is_branch=0, is_jal=0, is_jalr=0, uses_rs1=0,
               uses_rs2=0, is_halt=0, illegal=0)


def expected(name):
    """Independent description of the control bundle for each instruction."""
    e = dict(DEFAULT)
    if name == "lui":
        e.update(alu_op=ALU["COPY_B"], b_imm=1, imm_sel=IMM["U"], reg_we=1)
    elif name == "auipc":
        e.update(a_pc=1, b_imm=1, imm_sel=IMM["U"], reg_we=1)
    elif name == "jal":
        e.update(imm_sel=IMM["J"], is_jal=1, reg_we=1, wb_sel=WB["PC4"])
    elif name == "jalr":
        e.update(b_imm=1, is_jalr=1, reg_we=1, wb_sel=WB["PC4"], uses_rs1=1)
    elif name in ("beq", "bne", "blt", "bge", "bltu", "bgeu"):
        e.update(imm_sel=IMM["B"], is_branch=1, uses_rs1=1, uses_rs2=1)
    elif name in ("lb", "lh", "lw", "lbu", "lhu"):
        size = {"b": "BYTE", "h": "HALF", "w": "WORD"}[name[1]]
        e.update(b_imm=1, mem_re=1, reg_we=1, wb_sel=WB["MEM"], uses_rs1=1, mem_size=SZ[size],
                 mem_unsigned=int(name.endswith("u")))
    elif name in ("sb", "sh", "sw"):
        size = {"b": "BYTE", "h": "HALF", "w": "WORD"}[name[1]]
        e.update(b_imm=1, imm_sel=IMM["S"], mem_we=1, uses_rs1=1, uses_rs2=1, mem_size=SZ[size])
    elif name in ("addi", "slti", "sltiu", "xori", "ori", "andi", "slli", "srli", "srai"):
        op = {"addi": "ADD", "slti": "SLT", "sltiu": "SLTU", "xori": "XOR", "ori": "OR", "andi": "AND",
              "slli": "SLL", "srli": "SRL", "srai": "SRA"}[name]
        e.update(alu_op=ALU[op], b_imm=1, reg_we=1, uses_rs1=1)
    elif name in ("add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and"):
        e.update(alu_op=ALU[name.upper()], reg_we=1, uses_rs1=1, uses_rs2=1)
    elif name == "fence":
        pass
    elif name in ("ecall", "ebreak"):
        e.update(is_halt=1)
    elif name == "csrrs":
        e.update(reg_we=1, wb_sel=WB["CSR"])
    else:
        raise AssertionError(name)
    return e


def legal(word):
    """The golden ISS's notion of an executable instruction."""
    x = decode(word)
    if x is None:
        return False
    return x.rs1 == 0 and x.csr in CSR_NAMES if x.name == "csrrs" else True


async def sample(dut, word):
    dut.insn.value = word
    await Timer(1, "ns")
    return {s: int(getattr(dut, s).value) for s in SIGNALS}


@cocotb.test()
async def every_instruction_control_bundle(dut):
    rng = random.Random(42)
    for d in INSNS:
        for _ in range(60):
            imm = {"I": rng.randint(-2048, 2047), "SH": rng.randrange(32), "S": rng.randint(-2048, 2047),
                   "B": rng.randrange(-2048, 2048) * 2, "U": rng.randrange(1 << 20) << 12,
                   "J": rng.randrange(-(1 << 19), 1 << 19) * 2}.get(d.fmt, 0)
            word = encode(d.name, rng.randrange(32), rng.randrange(32), rng.randrange(32), imm,
                          csr=rng.choice(list(CSR_NAMES)))
            if d.name == "csrrs":
                word = encode("csrrs", rng.randrange(32), 0, csr=rng.choice(list(CSR_NAMES)))
            got = await sample(dut, word)
            want = expected(d.name)
            assert got == want, f"{d.name} {word:#010x}: " + ", ".join(
                f"{k}={got[k]} (want {want[k]})" for k in SIGNALS if got[k] != want[k])


@cocotb.test()
async def legality_matches_iss_and_illegal_is_inert(dut):
    rng = random.Random(1234)
    words = [0x00000000, 0xFFFFFFFF, 0x00000073, 0x00100073, 0x00200073, 0x30200073]
    words += [rng.getrandbits(32) for _ in range(4000)]
    # single-bit and field mutations of legal instructions probe the funct3/funct7 boundaries
    for d in INSNS:
        base = d.match | (rng.getrandbits(32) & ~d.mask & ~0x7F & 0xFFFFFFFF)
        for bit in range(32):
            words.append(base ^ (1 << bit))
    for w in words:
        got = await sample(dut, w)
        assert got["illegal"] == int(not legal(w)), f"{w:#010x}: illegal={got['illegal']}, ISS legal={legal(w)}"
        if not legal(w):
            for s in ("reg_we", "mem_re", "mem_we", "is_branch", "is_jal", "is_jalr", "is_halt"):
                assert got[s] == 0, f"{w:#010x}: illegal instruction has {s}=1"
        else:
            assert {k: v for k, v in got.items()} == expected(decode(w).name), f"{w:#010x} {decode(w).name}"
