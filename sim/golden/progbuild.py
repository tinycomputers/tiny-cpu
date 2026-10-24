"""A tiny programmatic assembler for building test programs without a RISC-V toolchain.

    p = Prog(pad=2)              # pad: NOPs inserted after every instruction
    p.li(1, 0x12345678)
    p.label("loop"); p.addi(1, 1, -1); p.bne(1, 0, "loop")
    p.exit()
    imem, dmem = p.build()       # raw little-endian images, as sw/Makefile produces

With pad=2 any producer is >= 3 instructions ahead of its consumer, the distance the Phase 3
pipeline (no forwarding, write-first regfile) needs. pad=0 gives dense code for hand-scheduled
sequences (use p.nop(n) between dependent instructions) and for the Phase 4 hazard tests.

`raw_hazards()` checks a *dynamic* retire trace, so it holds for taken branches and loops too.
"""

from __future__ import annotations

from golden.decode import BY_NAME, M32, decode, encode
from golden.iss import CONSOLE_ADDR, DMEM_BASE, IMEM_SIZE, TOHOST_ADDR

NOP = encode("addi", 0, 0, imm=0)


def _lo12(value: int) -> int:
    """Signed low 12 bits, so that lui(value - lo) + addi(lo) reconstructs value."""
    return ((value & 0xFFF) ^ 0x800) - 0x800


class Prog:
    def __init__(self, pad: int = 2):
        self.pad = pad
        self._items: list[tuple] = []
        self._data = bytearray()

    # ------------------------------------------------------------ emission
    def _emit(self, item: tuple) -> "Prog":
        self._items.append(item)
        for _ in range(self.pad):
            self._items.append(("raw", NOP))
        return self

    def label(self, name: str) -> "Prog":
        self._items.append(("label", name))
        return self

    def nop(self, n: int = 1) -> "Prog":
        """Explicit NOPs, never padded further."""
        self._items.extend([("raw", NOP)] * n)
        return self

    def raw(self, word: int) -> "Prog":
        return self._emit(("raw", word & M32))

    def op(self, name: str, *args) -> "Prog":
        """Emit by mnemonic. Operand order follows assembly:
        R (rd, rs1, rs2)  I/SH/load/jalr (rd, rs1, imm)  S (rs2, rs1, imm)  B (rs1, rs2, label)
        U (rd, imm20)  J (rd, label)  CSR (rd, csr)  SYS/FENCE ()"""
        fmt = BY_NAME[name].fmt
        if fmt == "R":
            rd, rs1, rs2 = args
            kw = dict(rd=rd, rs1=rs1, rs2=rs2)
        elif fmt in ("I", "SH"):
            rd, rs1, imm = args
            kw = dict(rd=rd, rs1=rs1, imm=imm)
        elif fmt == "S":
            rs2, rs1, imm = args
            kw = dict(rs2=rs2, rs1=rs1, imm=imm)
        elif fmt == "B":
            rs1, rs2, target = args
            return self._emit(("branch", name, dict(rs1=rs1, rs2=rs2), target))
        elif fmt == "U":
            rd, imm20 = args
            kw = dict(rd=rd, imm=(imm20 << 12) & M32)
        elif fmt == "J":
            rd, target = args
            return self._emit(("branch", name, dict(rd=rd), target))
        elif fmt == "CSR":
            rd, csr = args
            kw = dict(rd=rd, rs1=0, csr=csr)
        else:
            kw = {}
        return self._emit(("insn", name, kw))

    def __getattr__(self, name: str):
        if name.startswith("_") or name not in BY_NAME:
            raise AttributeError(name)
        return lambda *args: self.op(name, *args)

    def _gap(self) -> "Prog":
        """NOPs that make a dependent pair of emitted instructions >= 3 apart at any pad."""
        return self.nop(max(0, 2 - self.pad))

    def li(self, rd: int, value: int) -> "Prog":
        value &= M32
        lo = _lo12(value)
        self.op("lui", rd, ((value - lo) & M32) >> 12)
        self._gap()
        return self.op("addi", rd, rd, lo)

    def li_label(self, rd: int, label: str, add: int = 0) -> "Prog":
        """rd = address of `label` + add (two instructions, resolved at build time)."""
        self._emit(("lui_label", rd, label, add))
        self._gap()
        return self._emit(("addi_label", rd, label, add))

    def exit(self, code: int = 1) -> "Prog":
        """Store `code` to TOHOST (1 = PASS). Uses x30/x31."""
        self.li(31, TOHOST_ADDR)
        self.li(30, code)
        self._gap()
        return self.sw(30, 31, 0)

    def putc(self, ch: str | int, scratch: int = 29) -> "Prog":
        """Print one character through CONSOLE. Uses x28/x29 by default."""
        self.li(28, CONSOLE_ADDR)
        self.li(scratch, ord(ch) if isinstance(ch, str) else ch)
        self._gap()
        return self.sb(scratch, 28, 0)

    # ------------------------------------------------------------ data (DMEM image)
    def align(self, n: int = 4) -> None:
        while len(self._data) % n:
            self._data.append(0)

    def word(self, *values: int) -> int:
        """Append 32-bit words; returns the DMEM address of the first one."""
        self.align(4)
        addr = DMEM_BASE + len(self._data)
        for v in values:
            self._data += (v & M32).to_bytes(4, "little")
        return addr

    def bytes_(self, data: bytes) -> int:
        addr = DMEM_BASE + len(self._data)
        self._data += data
        return addr

    def space(self, n: int) -> int:
        self.align(4)
        addr = DMEM_BASE + len(self._data)
        self._data += bytes(n)
        return addr

    # ------------------------------------------------------------ build
    def build(self) -> tuple[bytes, bytes]:
        labels: dict[str, int] = {}
        placed: list[tuple[int, tuple]] = []
        addr = 0
        for item in self._items:
            if item[0] == "label":
                if item[1] in labels:
                    raise ValueError(f"duplicate label {item[1]}")
                labels[item[1]] = addr
            else:
                placed.append((addr, item))
                addr += 4
        if addr > IMEM_SIZE:
            raise ValueError(f"program is {addr} bytes, IMEM holds {IMEM_SIZE}")

        words = []
        for pc, item in placed:
            kind = item[0]
            if kind == "raw":
                words.append(item[1])
            elif kind == "insn":
                words.append(encode(item[1], **item[2]))
            elif kind == "branch":
                _, name, kw, target = item
                words.append(encode(name, imm=labels[target] - pc, **kw))
            else:  # lui_label / addi_label
                _, rd, label, add = item
                value = (labels[label] + add) & M32
                lo = _lo12(value)
                if kind == "lui_label":
                    words.append(encode("lui", rd, imm=(value - lo) & M32))
                else:
                    words.append(encode("addi", rd, rd, imm=lo))
        return b"".join(w.to_bytes(4, "little") for w in words), bytes(self._data)


def reads(insn: int) -> tuple[int, ...]:
    """Source registers an instruction actually reads (x0 excluded)."""
    x = decode(insn)
    if x is None:
        return ()
    if x.fmt in ("R", "S", "B"):
        regs = (x.rs1, x.rs2)
    elif x.fmt in ("I", "SH"):
        regs = (x.rs1,)
    else:
        regs = ()
    return tuple(r for r in regs if r)


def raw_hazards(trace, min_distance: int = 3) -> list[tuple[int, int, int]]:
    """Read-after-write pairs in a dynamic retire trace closer than `min_distance` instructions.
    Returns (producer index, consumer index, register)."""
    last_write: dict[int, int] = {}
    bad = []
    for i, r in enumerate(trace):
        for reg in reads(r.insn):
            if reg in last_write and i - last_write[reg] < min_distance:
                bad.append((last_write[reg], i, reg))
        if r.rd_addr:
            last_write[r.rd_addr] = i
    return bad
