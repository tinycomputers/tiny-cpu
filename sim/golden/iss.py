"""Golden RV32I instruction-set simulator for TinyCPU.

This is the reference the RTL is checked against (docs/PLAN.md section 5). It models the
architecture, not the pipeline: one instruction retires per step() and produces one
RVFI-lite `Retire` record. Keep it small and obviously correct.

Memory map (docs/PLAN.md section 2.1), Harvard:
    IMEM    0x0000_0000  4 KiB  fetch only (the data port cannot read or write it)
    DMEM    0x0001_0000  4 KiB  byte-addressable, LB/LH/LW/LBU/LHU/SB/SH/SW
    CONSOLE 0x0002_0000  write: lane-0 byte is sent to the console
    TOHOST  0x0002_0004  SW only: halts the core. 1 = PASS, anything else = FAIL code
    CYCLE   0x0002_0008  read-only cycle counter

Deliberate behaviours the RTL must match:
  * Misaligned loads/stores are NOT supported: the address is forced into alignment and the
    retire record carries misaligned=True. Misaligned jump/branch targets raise.
  * ecall / ebreak / a TOHOST write halt the core; the halting instruction still retires.
  * Cycle-dependent values (CYCLE MMIO, rdcycle/rdtime) return the retired-instruction count
    here, which is NOT what a pipelined core returns. The lockstep harness masks the
    destination value of those instructions (see `Retire.cycle_dependent`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from golden.decode import (
    BRANCHES,
    CSR_NAMES,
    LOADS,
    M32,
    STORES,
    Decoded,
    decode,
    disasm,
    s32,
)

IMEM_BASE, IMEM_SIZE = 0x0000_0000, 4096
DMEM_BASE, DMEM_SIZE = 0x0001_0000, 4096
CONSOLE_ADDR = 0x0002_0000
TOHOST_ADDR = 0x0002_0004
CYCLE_ADDR = 0x0002_0008
MMIO_BASE, MMIO_END = CONSOLE_ADDR, CYCLE_ADDR + 4

PASS_CODE = 1


class IssError(Exception):
    """The program did something the core does not define (trap-less design: this is fatal)."""

    def __init__(self, reason: str, pc: int, insn: int | None = None):
        self.reason, self.pc, self.insn = reason, pc, insn
        detail = f" insn=0x{insn:08x} ({disasm(insn, pc)})" if insn is not None else ""
        super().__init__(f"{reason} at pc=0x{pc:08x}{detail}")


class IllegalInstruction(IssError):
    pass


class BusFault(IssError):
    pass


class MisalignedFetch(IssError):
    pass


@dataclass
class Retire:
    """RVFI-lite retire record (docs/PLAN.md section 2.4).

    mem_addr is the word-aligned address; masks are byte lanes within that word; mem_rdata and
    mem_wdata are lane-positioned 32-bit words (unselected lanes are zero), exactly what the
    LSU datapath carries.
    """

    order: int
    pc: int
    insn: int
    rd_addr: int  # 0 when no register is written (including writes to x0)
    rd_wdata: int  # 0 when rd_addr == 0
    pc_wdata: int  # address of the next instruction
    mem_addr: int = 0
    mem_rmask: int = 0
    mem_wmask: int = 0
    mem_rdata: int = 0
    mem_wdata: int = 0
    misaligned: bool = False
    halt: bool = False
    halt_reason: str = ""  # "", "ecall", "ebreak", "tohost"; informational, not compared
    cycle_dependent: bool = False  # rd_wdata/mem_rdata depend on timing; lockstep must mask them

    def asdict(self) -> dict:
        return asdict(self)

    def __str__(self) -> str:
        s = f"#{self.order:<5} pc=0x{self.pc:08x} {disasm(self.insn, self.pc):<28}"
        if self.rd_addr:
            s += f" x{self.rd_addr}=0x{self.rd_wdata:08x}"
        if self.mem_rmask:
            s += f" R[0x{self.mem_addr:08x}/{self.mem_rmask:04b}]=0x{self.mem_rdata:08x}"
        if self.mem_wmask:
            s += f" W[0x{self.mem_addr:08x}/{self.mem_wmask:04b}]=0x{self.mem_wdata:08x}"
        return s + (f"  HALT({self.halt_reason})" if self.halt else "")


_SIZE = {"lb": 1, "lbu": 1, "sb": 1, "lh": 2, "lhu": 2, "sh": 2, "lw": 4, "sw": 4}


class Iss:
    def __init__(
        self,
        imem: bytes = b"",
        dmem: bytes = b"",
        on_console: Callable[[int], None] | None = None,
    ):
        self.imem = bytearray(IMEM_SIZE)
        self.dmem = bytearray(DMEM_SIZE)
        self.on_console = on_console
        self.console = bytearray()
        self.regs = [0] * 32
        self.pc = IMEM_BASE
        self.instret = 0
        self.halted = False
        self.halt_reason = ""
        self.tohost: int | None = None
        self.load(imem, dmem)

    # ---------------------------------------------------------------- loading
    def load(self, imem: bytes, dmem: bytes) -> None:
        if len(imem) > IMEM_SIZE or len(dmem) > DMEM_SIZE:
            raise ValueError(f"image too large: imem {len(imem)}/{IMEM_SIZE}, dmem {len(dmem)}/{DMEM_SIZE}")
        self.imem[:] = bytes(imem).ljust(IMEM_SIZE, b"\0")
        self.dmem[:] = bytes(dmem).ljust(DMEM_SIZE, b"\0")

    @classmethod
    def from_files(cls, imem_path: str | Path, dmem_path: str | Path | None = None, **kw) -> "Iss":
        dmem = Path(dmem_path).read_bytes() if dmem_path and Path(dmem_path).exists() else b""
        return cls(Path(imem_path).read_bytes(), dmem, **kw)

    @classmethod
    def from_build(cls, stem: str | Path, **kw) -> "Iss":
        """Load `<stem>.imem.bin` + `<stem>.dmem.bin` as produced by sw/Makefile."""
        stem = str(stem)
        return cls.from_files(stem + ".imem.bin", stem + ".dmem.bin", **kw)

    # ---------------------------------------------------------------- results
    @property
    def passed(self) -> bool:
        return self.tohost == PASS_CODE

    @property
    def console_text(self) -> str:
        return self.console.decode("latin-1")

    # ---------------------------------------------------------------- memory
    def _fetch(self, pc: int) -> int:
        if pc & 3:
            raise MisalignedFetch("misaligned fetch", pc)
        if not IMEM_BASE <= pc < IMEM_BASE + IMEM_SIZE:
            raise BusFault("fetch outside IMEM", pc)
        return int.from_bytes(self.imem[pc : pc + 4], "little")

    def _load(self, name: str, addr: int, pc: int, insn: int) -> tuple[int, int, int, int, bool]:
        """-> (value, word_addr, rmask, lane_positioned_rdata, misaligned)."""
        size = _SIZE[name]
        aligned = addr & ~(size - 1)
        word_addr, off = aligned & ~3, aligned & 3
        mask = ((1 << size) - 1) << off
        if DMEM_BASE <= word_addr < DMEM_BASE + DMEM_SIZE:
            o = word_addr - DMEM_BASE
            word = int.from_bytes(self.dmem[o : o + 4], "little")
        elif word_addr == CYCLE_ADDR:
            word = self.instret & M32
        else:
            raise BusFault(f"load from unmapped/unreadable address 0x{addr:08x}", pc, insn)
        lanes = word & sum(0xFF << (8 * i) for i in range(4) if mask >> i & 1)
        raw = (lanes >> (8 * off)) & ((1 << (8 * size)) - 1)
        if name in ("lb", "lh"):
            raw = (raw - (1 << (8 * size))) & M32 if raw >> (8 * size - 1) else raw
        return raw, word_addr, mask, lanes, aligned != addr

    def _store(self, name: str, addr: int, value: int, pc: int, insn: int) -> tuple[int, int, int, bool]:
        """-> (word_addr, wmask, lane_positioned_wdata, misaligned)."""
        size = _SIZE[name]
        aligned = addr & ~(size - 1)
        word_addr, off = aligned & ~3, aligned & 3
        mask = ((1 << size) - 1) << off
        wdata = ((value & ((1 << (8 * size)) - 1)) << (8 * off)) & M32
        if DMEM_BASE <= word_addr < DMEM_BASE + DMEM_SIZE:
            o = word_addr - DMEM_BASE
            for i in range(4):
                if mask >> i & 1:
                    self.dmem[o + i] = (wdata >> (8 * i)) & 0xFF
        elif word_addr == CONSOLE_ADDR:
            if mask & 1:
                ch = wdata & 0xFF
                self.console.append(ch)
                if self.on_console:
                    self.on_console(ch)
        elif word_addr == TOHOST_ADDR:
            if mask != 0xF:
                raise BusFault("TOHOST accepts word stores only", pc, insn)
            self.tohost = wdata
            self.halted, self.halt_reason = True, "tohost"
        else:
            raise BusFault(f"store to unmapped/read-only address 0x{addr:08x}", pc, insn)
        return word_addr, mask, wdata, aligned != addr

    # ---------------------------------------------------------------- execute
    def step(self) -> Retire:
        if self.halted:
            raise RuntimeError("core is halted")
        pc = self.pc
        insn = self._fetch(pc)
        x = decode(insn)
        if x is None:
            raise IllegalInstruction("illegal instruction", pc, insn)
        r = self._execute(x, pc)
        self.pc = r.pc_wdata
        self.instret += 1
        return r

    def _execute(self, x: Decoded, pc: int) -> Retire:
        regs, n = self.regs, x.name
        a, b = regs[x.rs1], regs[x.rs2]
        nxt = (pc + 4) & M32
        rd_val: int | None = None
        ret = Retire(self.instret, pc, x.insn, 0, 0, nxt)

        if n == "lui":
            rd_val = x.imm & M32
        elif n == "auipc":
            rd_val = (pc + x.imm) & M32
        elif n == "jal":
            rd_val, nxt = nxt, (pc + x.imm) & M32
        elif n == "jalr":
            rd_val, nxt = nxt, ((a + x.imm) & M32) & ~1
        elif n in BRANCHES:
            taken = {
                "beq": a == b,
                "bne": a != b,
                "blt": s32(a) < s32(b),
                "bge": s32(a) >= s32(b),
                "bltu": a < b,
                "bgeu": a >= b,
            }[n]
            if taken:
                nxt = (pc + x.imm) & M32
        elif n in LOADS:
            val, ret.mem_addr, ret.mem_rmask, ret.mem_rdata, ret.misaligned = self._load(
                n, (a + x.imm) & M32, pc, x.insn
            )
            ret.cycle_dependent = ret.mem_addr == CYCLE_ADDR
            rd_val = val
        elif n in STORES:
            ret.mem_addr, ret.mem_wmask, ret.mem_wdata, ret.misaligned = self._store(
                n, (a + x.imm) & M32, b, pc, x.insn
            )
            if self.halted:
                ret.halt, ret.halt_reason = True, "tohost"
        elif n in ("addi", "slti", "sltiu", "xori", "ori", "andi", "slli", "srli", "srai"):
            rd_val = _alu(n[:-1] if n != "sltiu" else "sltu", a, x.imm & M32)
        elif n in ("add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and"):
            rd_val = _alu(n, a, b)
        elif n == "fence":
            pass
        elif n in ("ecall", "ebreak"):
            self.halted, self.halt_reason = True, n
            ret.halt, ret.halt_reason = True, n
        elif n == "csrrs":
            if x.rs1 != 0 or x.csr not in CSR_NAMES:
                raise IllegalInstruction("only read-only Zicntr csrrs (rs1=x0) is implemented", pc, x.insn)
            rd_val = self.instret & M32 if x.csr in (0xC00, 0xC01, 0xC02) else 0
            ret.cycle_dependent = x.csr in (0xC00, 0xC01)
        else:  # pragma: no cover - decode() only returns names handled above
            raise IllegalInstruction(f"unhandled {n}", pc, x.insn)

        if nxt & 3:
            raise MisalignedFetch(f"misaligned jump/branch target 0x{nxt:08x}", pc, x.insn)
        if rd_val is not None and x.rd != 0:
            regs[x.rd] = rd_val & M32
            ret.rd_addr, ret.rd_wdata = x.rd, rd_val & M32
        ret.pc_wdata = nxt
        return ret

    def run(self, max_steps: int = 1_000_000) -> list[Retire]:
        """Run to halt; returns every retire record. Raises TimeoutError past max_steps."""
        trace: list[Retire] = []
        while not self.halted:
            if len(trace) >= max_steps:
                raise TimeoutError(f"no halt after {max_steps} instructions (pc=0x{self.pc:08x})")
            trace.append(self.step())
        return trace


def _alu(op: str, a: int, b: int) -> int:
    sh = b & 31
    return {
        "add": (a + b) & M32,
        "sub": (a - b) & M32,
        "sll": (a << sh) & M32,
        "slt": int(s32(a) < s32(b)),
        "sltu": int(a < b),
        "xor": a ^ b,
        "srl": a >> sh,
        "sra": (s32(a) >> sh) & M32,
        "or": a | b,
        "and": a & b,
    }[op]
