"""RV32I decode tables, encoder and disassembler. Single source of truth for the ISA.

`web/src/lib/isa.ts` is generated from INSNS by gen_isa_ts.py, and the RTL decoder tests
(Phase 2) derive their expected control bundles from here, so Python, TypeScript and
SystemVerilog all agree on one opcode table.
"""

from __future__ import annotations

from dataclasses import dataclass

M32 = 0xFFFFFFFF

REG_NAMES = (
    "zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 "
    "s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6"
).split()

# Formats. SH = shift-immediate (shamt in the rs2 field), CSR = Zicntr read, SYS = ecall/ebreak.
FORMATS = ("R", "I", "S", "B", "U", "J", "SH", "FENCE", "CSR", "SYS")

# CSRs the core implements (read-only counters, Zicntr subset).
CSR_NAMES = {
    0xC00: "cycle",
    0xC01: "time",
    0xC02: "instret",
    0xC80: "cycleh",
    0xC81: "timeh",
    0xC82: "instreth",
}


@dataclass(frozen=True)
class InsnDef:
    name: str
    fmt: str
    mask: int
    match: int


def _def(name: str, fmt: str, opcode: int, f3: int | None = None, f7: int | None = None) -> InsnDef:
    mask, match = 0x7F, opcode
    if f3 is not None:
        mask |= 0x7 << 12
        match |= f3 << 12
    if f7 is not None:
        mask |= 0x7F << 25
        match |= f7 << 25
    return InsnDef(name, fmt, mask, match)


INSNS: tuple[InsnDef, ...] = (
    _def("lui", "U", 0x37),
    _def("auipc", "U", 0x17),
    _def("jal", "J", 0x6F),
    _def("jalr", "I", 0x67, 0),
    _def("beq", "B", 0x63, 0),
    _def("bne", "B", 0x63, 1),
    _def("blt", "B", 0x63, 4),
    _def("bge", "B", 0x63, 5),
    _def("bltu", "B", 0x63, 6),
    _def("bgeu", "B", 0x63, 7),
    _def("lb", "I", 0x03, 0),
    _def("lh", "I", 0x03, 1),
    _def("lw", "I", 0x03, 2),
    _def("lbu", "I", 0x03, 4),
    _def("lhu", "I", 0x03, 5),
    _def("sb", "S", 0x23, 0),
    _def("sh", "S", 0x23, 1),
    _def("sw", "S", 0x23, 2),
    _def("addi", "I", 0x13, 0),
    _def("slti", "I", 0x13, 2),
    _def("sltiu", "I", 0x13, 3),
    _def("xori", "I", 0x13, 4),
    _def("ori", "I", 0x13, 6),
    _def("andi", "I", 0x13, 7),
    _def("slli", "SH", 0x13, 1, 0x00),
    _def("srli", "SH", 0x13, 5, 0x00),
    _def("srai", "SH", 0x13, 5, 0x20),
    _def("add", "R", 0x33, 0, 0x00),
    _def("sub", "R", 0x33, 0, 0x20),
    _def("sll", "R", 0x33, 1, 0x00),
    _def("slt", "R", 0x33, 2, 0x00),
    _def("sltu", "R", 0x33, 3, 0x00),
    _def("xor", "R", 0x33, 4, 0x00),
    _def("srl", "R", 0x33, 5, 0x00),
    _def("sra", "R", 0x33, 5, 0x20),
    _def("or", "R", 0x33, 6, 0x00),
    _def("and", "R", 0x33, 7, 0x00),
    _def("fence", "FENCE", 0x0F, 0),
    InsnDef("ecall", "SYS", 0xFFFFFFFF, 0x00000073),
    InsnDef("ebreak", "SYS", 0xFFFFFFFF, 0x00100073),
    _def("csrrs", "CSR", 0x73, 2),
)

BY_NAME = {d.name: d for d in INSNS}
LOADS = {"lb", "lh", "lw", "lbu", "lhu"}
STORES = {"sb", "sh", "sw"}
BRANCHES = {"beq", "bne", "blt", "bge", "bltu", "bgeu"}


def sext(value: int, bits: int) -> int:
    value &= (1 << bits) - 1
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


def s32(value: int) -> int:
    return sext(value, 32)


@dataclass(frozen=True)
class Decoded:
    name: str
    fmt: str
    rd: int
    rs1: int
    rs2: int
    imm: int  # signed Python int; shamt for SH; unused (0) for R/FENCE/SYS
    csr: int
    insn: int


def imm_i(insn: int) -> int:
    return sext(insn >> 20, 12)


def imm_s(insn: int) -> int:
    return sext(((insn >> 25) << 5) | ((insn >> 7) & 0x1F), 12)


def imm_b(insn: int) -> int:
    raw = (
        ((insn >> 31) << 12)
        | (((insn >> 7) & 1) << 11)
        | (((insn >> 25) & 0x3F) << 5)
        | (((insn >> 8) & 0xF) << 1)
    )
    return sext(raw, 13)


def imm_u(insn: int) -> int:
    return s32(insn & 0xFFFFF000)


def imm_j(insn: int) -> int:
    raw = (
        ((insn >> 31) << 20)
        | (((insn >> 12) & 0xFF) << 12)
        | (((insn >> 20) & 1) << 11)
        | (((insn >> 21) & 0x3FF) << 1)
    )
    return sext(raw, 21)


def lookup(insn: int) -> InsnDef | None:
    insn &= M32
    for d in INSNS:
        if insn & d.mask == d.match:
            return d
    return None


def decode(insn: int) -> Decoded | None:
    """Decode a 32-bit word; None if it is not a valid RV32I (+Zicntr read) instruction."""
    insn &= M32
    d = lookup(insn)
    if d is None:
        return None
    rd, rs1, rs2 = (insn >> 7) & 31, (insn >> 15) & 31, (insn >> 20) & 31
    imm = csr = 0
    f = d.fmt
    if f == "R":
        pass
    elif f == "I":
        imm, rs2 = imm_i(insn), 0
    elif f == "SH":
        imm, rs2 = rs2, 0
    elif f == "S":
        imm, rd = imm_s(insn), 0
    elif f == "B":
        imm, rd = imm_b(insn), 0
    elif f == "U":
        imm, rs1, rs2 = imm_u(insn), 0, 0
    elif f == "J":
        imm, rs1, rs2 = imm_j(insn), 0, 0
    elif f == "CSR":
        csr, rs2 = (insn >> 20) & 0xFFF, 0
    else:  # FENCE, SYS: no architectural operands for this core
        rd = rs1 = rs2 = 0
    return Decoded(d.name, f, rd, rs1, rs2, imm, csr, insn)


# ---------------------------------------------------------------- encoder


def _check_imm(name: str, imm: int, bits: int, align: int = 1) -> None:
    lo, hi = -(1 << (bits - 1)), (1 << (bits - 1)) - 1
    if not lo <= imm <= hi or imm % align:
        raise ValueError(f"{name}: immediate {imm} out of range/alignment ({bits}-bit, x{align})")


def encode(name: str, rd: int = 0, rs1: int = 0, rs2: int = 0, imm: int = 0, csr: int = 0) -> int:
    """Encode one instruction. `imm` is signed (U-type: the 20-bit field value << 12 as signed
    or unsigned, B/J: byte offsets). For SH the shift amount is `imm`."""
    d = BY_NAME[name]
    for r in (rd, rs1, rs2):
        if not 0 <= r < 32:
            raise ValueError(f"{name}: register {r} out of range")
    w, f = d.match, d.fmt
    if f == "R":
        w |= (rd << 7) | (rs1 << 15) | (rs2 << 20)
    elif f == "I":
        _check_imm(name, imm, 12)
        w |= (rd << 7) | (rs1 << 15) | ((imm & 0xFFF) << 20)
    elif f == "SH":
        if not 0 <= imm < 32:
            raise ValueError(f"{name}: shamt {imm} out of range")
        w |= (rd << 7) | (rs1 << 15) | (imm << 20)
    elif f == "S":
        _check_imm(name, imm, 12)
        w |= ((imm & 0x1F) << 7) | (rs1 << 15) | (rs2 << 20) | (((imm >> 5) & 0x7F) << 25)
    elif f == "B":
        _check_imm(name, imm, 13, 2)
        w |= (
            (((imm >> 11) & 1) << 7)
            | (((imm >> 1) & 0xF) << 8)
            | (rs1 << 15)
            | (rs2 << 20)
            | (((imm >> 5) & 0x3F) << 25)
            | (((imm >> 12) & 1) << 31)
        )
    elif f == "U":
        w |= (rd << 7) | (imm & 0xFFFFF000)
    elif f == "J":
        _check_imm(name, imm, 21, 2)
        w |= (
            (rd << 7)
            | (((imm >> 12) & 0xFF) << 12)
            | (((imm >> 11) & 1) << 20)
            | (((imm >> 1) & 0x3FF) << 21)
            | (((imm >> 20) & 1) << 31)
        )
    elif f == "CSR":
        w |= (rd << 7) | (rs1 << 15) | ((csr & 0xFFF) << 20)
    # FENCE / SYS: fixed encodings (fence = plain `fence` with zero fields)
    return w & M32


# ---------------------------------------------------------------- disassembler


def disasm(insn: int, pc: int | None = None) -> str:
    """ABI-name disassembly. With `pc`, branch/jump targets are shown as absolute addresses."""
    x = decode(insn)
    if x is None:
        return f".word 0x{insn & M32:08x}"
    r = REG_NAMES
    n, f = x.name, x.fmt

    def target() -> str:
        return f"0x{(pc + x.imm) & M32:x}" if pc is not None else f"{x.imm:+d}"

    if f == "R":
        return f"{n} {r[x.rd]}, {r[x.rs1]}, {r[x.rs2]}"
    if f == "SH":
        return f"{n} {r[x.rd]}, {r[x.rs1]}, {x.imm}"
    if f == "I":
        if n in LOADS:
            return f"{n} {r[x.rd]}, {x.imm}({r[x.rs1]})"
        if n == "jalr":
            return f"{n} {r[x.rd]}, {x.imm}({r[x.rs1]})"
        return f"{n} {r[x.rd]}, {r[x.rs1]}, {x.imm}"
    if f == "S":
        return f"{n} {r[x.rs2]}, {x.imm}({r[x.rs1]})"
    if f == "B":
        return f"{n} {r[x.rs1]}, {r[x.rs2]}, {target()}"
    if f == "U":
        return f"{n} {r[x.rd]}, 0x{(x.imm & M32) >> 12:x}"
    if f == "J":
        return f"{n} {r[x.rd]}, {target()}"
    if f == "CSR":
        return f"{n} {r[x.rd]}, {CSR_NAMES.get(x.csr, hex(x.csr))}, {r[x.rs1]}"
    return n
