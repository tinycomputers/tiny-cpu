"""ISS unit tests: instruction semantics, memory lanes, MMIO, faults and retire records."""

import pytest

from golden.decode import encode as e
from golden.iss import (
    CONSOLE_ADDR,
    CYCLE_ADDR,
    DMEM_BASE,
    TOHOST_ADDR,
    BusFault,
    IllegalInstruction,
    Iss,
    MisalignedFetch,
)

M32 = 0xFFFFFFFF


def words(*ws):
    return b"".join((w & M32).to_bytes(4, "little") for w in ws)


def li(rd, value):
    """lui+addi pair loading an arbitrary 32-bit constant."""
    value &= M32
    lo = ((value & 0xFFF) ^ 0x800) - 0x800
    return [e("lui", rd, imm=(value - lo) & M32), e("addi", rd, rd, imm=lo)]


EXIT = [e("lui", 31, imm=TOHOST_ADDR & ~0xFFF), e("addi", 30, 0, imm=1), e("sw", 0, 31, 30, imm=4)]


def run(*prog, dmem=b"", expect_pass=True):
    iss = Iss(words(*prog, *EXIT), dmem)
    trace = iss.run(10_000)
    assert iss.passed is expect_pass
    return iss, trace


def reg(iss, n):
    return iss.regs[n]


# ------------------------------------------------------------------ ALU


@pytest.mark.parametrize(
    "op,a,b,want",
    [
        ("add", 0xFFFFFFFF, 1, 0),
        ("add", 0x7FFFFFFF, 1, 0x80000000),
        ("sub", 0, 1, 0xFFFFFFFF),
        ("sub", 0x80000000, 1, 0x7FFFFFFF),
        ("sll", 1, 31, 0x80000000),
        ("sll", 1, 32, 1),  # shift amount is masked to 5 bits
        ("srl", 0x80000000, 31, 1),
        ("sra", 0x80000000, 31, 0xFFFFFFFF),
        ("sra", 0x7FFFFFFF, 31, 0),
        ("slt", 0xFFFFFFFF, 0, 1),  # -1 < 0 signed
        ("sltu", 0xFFFFFFFF, 0, 0),
        ("slt", 0x80000000, 0x7FFFFFFF, 1),
        ("sltu", 0x80000000, 0x7FFFFFFF, 0),
        ("xor", 0xF0F0F0F0, 0xFFFF0000, 0x0F0FF0F0),
        ("or", 0xF0F0F0F0, 0x0F0F0F0F, 0xFFFFFFFF),
        ("and", 0xF0F0F0F0, 0xFFFF0000, 0xF0F00000),
    ],
)
def test_register_alu(op, a, b, want):
    iss, _ = run(*li(1, a), *li(2, b), e(op, 3, 1, 2))
    assert reg(iss, 3) == want


@pytest.mark.parametrize(
    "op,a,imm,want",
    [
        ("addi", 5, -6, M32),
        ("slti", 0xFFFFFFFE, -1, 1),
        ("sltiu", 0, -1, 1),  # immediate sign-extends, then compares unsigned
        ("sltiu", 0xFFFFFFFF, -1, 0),
        ("xori", 0xFF, -1, 0xFFFFFF00),
        ("ori", 0x0F, -16, 0xFFFFFFFF),
        ("andi", 0xFFFFFFFF, -1, 0xFFFFFFFF),
        ("slli", 3, 4, 48),
        ("srli", 0x80000000, 4, 0x08000000),
        ("srai", 0x80000000, 4, 0xF8000000),
    ],
)
def test_immediate_alu(op, a, imm, want):
    iss, _ = run(*li(1, a), e(op, 3, 1, imm=imm))
    assert reg(iss, 3) == want


def test_x0_is_hardwired_zero_and_discards_writes():
    iss, trace = run(e("addi", 0, 0, imm=123), e("add", 1, 0, 0), e("lui", 0, imm=0x12345000))
    assert reg(iss, 0) == 0 and reg(iss, 1) == 0
    # writes to x0 retire with no destination; the real write to x1 (add x1,x0,x0) does
    assert [(r.rd_addr, r.rd_wdata) for r in trace[:3]] == [(0, 0), (1, 0), (0, 0)]


def test_lui_auipc():
    iss, _ = run(e("lui", 1, imm=0x80000000), e("auipc", 2, imm=0x1000))
    assert reg(iss, 1) == 0x80000000
    assert reg(iss, 2) == 4 + 0x1000


# ------------------------------------------------------------------ control flow


def test_jal_and_jalr_link_and_target():
    iss, trace = run(
        e("jal", 1, imm=8),  # 0: x1=4, jump to 8
        e("addi", 5, 0, imm=99),  # 4: skipped
        e("addi", 6, 0, imm=17),  # 8
        *li(7, 0x19),  # 0xc,0x10: x7 = 0x19 (bit0 set)
        e("jalr", 2, 7, imm=0),  # 0x14: target 0x19 & ~1 = 0x18, x2 = 0x18
        e("addi", 5, 0, imm=77),  # 0x18: executed
    )
    assert (reg(iss, 1), reg(iss, 5), reg(iss, 6), reg(iss, 2)) == (4, 77, 17, 0x18)
    assert trace[0].pc_wdata == 8


@pytest.mark.parametrize(
    "op,a,b,taken",
    [
        ("beq", 5, 5, True), ("beq", 5, 6, False),
        ("bne", 5, 6, True), ("bne", 5, 5, False),
        ("blt", -1, 0, True), ("blt", 0, -1, False), ("blt", 3, 3, False),
        ("bge", 0, -1, True), ("bge", -1, 0, False), ("bge", 3, 3, True),
        ("bltu", 0, -1, True), ("bltu", -1, 0, False),
        ("bgeu", -1, 0, True), ("bgeu", 0, -1, False), ("bgeu", 7, 7, True),
    ],
)
def test_branches(op, a, b, taken):
    iss, trace = run(*li(1, a), *li(2, b), e(op, 0, 1, 2, imm=8), e("addi", 3, 0, imm=1))
    br = trace[4]  # two li pairs occupy 0x0-0xc, so the branch is at 0x10
    assert br.pc == 0x10 and br.pc_wdata == (0x18 if taken else 0x14)
    assert reg(iss, 3) == (0 if taken else 1)


def test_backward_branch_loop():
    iss, _ = run(e("addi", 1, 0, imm=5), e("addi", 2, 2, imm=3), e("addi", 1, 1, imm=-1), e("bne", 0, 1, 0, imm=-8))
    assert reg(iss, 2) == 15


# ------------------------------------------------------------------ memory


def test_load_store_all_sizes_signedness_and_lanes():
    base = DMEM_BASE
    iss, trace = run(
        *li(1, base),
        *li(2, 0x8182_8384),
        e("sw", 0, 1, 2, imm=0),
        e("lb", 3, 1, imm=0),  # 0x84 -> sign-extend
        e("lbu", 4, 1, imm=0),
        e("lb", 5, 1, imm=3),  # 0x81
        e("lh", 6, 1, imm=2),  # 0x8182
        e("lhu", 7, 1, imm=2),
        e("lh", 8, 1, imm=0),  # 0x8384
        e("lw", 9, 1, imm=0),
    )
    assert reg(iss, 3) == 0xFFFFFF84 and reg(iss, 4) == 0x84
    assert reg(iss, 5) == 0xFFFFFF81
    assert reg(iss, 6) == 0xFFFF8182 and reg(iss, 7) == 0x8182
    assert reg(iss, 8) == 0xFFFF8384 and reg(iss, 9) == 0x81828384
    by_pc = {r.pc: r for r in trace}
    lb3 = next(r for r in trace if r.rd_addr == 5)
    assert (lb3.mem_addr, lb3.mem_rmask, lb3.mem_rdata) == (base, 0b1000, 0x81000000)
    lh2 = next(r for r in trace if r.rd_addr == 6)
    assert (lh2.mem_rmask, lh2.mem_rdata) == (0b1100, 0x81820000)
    assert by_pc  # trace is keyed by pc without collisions in straight-line code


def test_store_byte_and_half_only_touch_their_lanes():
    base = DMEM_BASE
    iss, trace = run(
        *li(1, base),
        *li(2, 0x1122_3344),
        e("sw", 0, 1, 2, imm=0),
        *li(3, 0xAABBCCDD),
        e("sb", 0, 1, 3, imm=1),
        e("sh", 0, 1, 3, imm=2),
        e("lw", 4, 1, imm=0),
    )
    assert reg(iss, 4) == 0xCCDD_DD44
    sb = next(r for r in trace if r.mem_wmask == 0b0010)
    assert (sb.mem_addr, sb.mem_wdata) == (base, 0x0000_DD00)
    sh = next(r for r in trace if r.mem_wmask == 0b1100)
    assert sh.mem_wdata == 0xCCDD_0000


def test_misaligned_access_is_forced_into_alignment_and_flagged():
    base = DMEM_BASE
    iss, trace = run(
        *li(1, base),
        *li(2, 0x4433_2211),
        e("sw", 0, 1, 2, imm=0),
        e("lw", 3, 1, imm=1),  # forced to offset 0
        e("lh", 4, 1, imm=3),  # forced to offset 2
        e("lw", 5, 1, imm=0),  # aligned control
    )
    assert reg(iss, 3) == 0x44332211 and reg(iss, 4) == 0x4433
    flags = [r.misaligned for r in trace if r.mem_rmask]
    assert flags == [True, True, False]


def test_initial_dmem_image_and_dmem_is_not_instruction_memory():
    iss, _ = run(*li(1, DMEM_BASE), e("lw", 2, 1, imm=4), dmem=bytes(range(8)))
    assert reg(iss, 2) == 0x07060504


# ------------------------------------------------------------------ MMIO, halt, csr


def test_console_collects_lane0_byte():
    seen = []
    iss = Iss(
        words(*li(1, CONSOLE_ADDR), e("addi", 2, 0, imm=ord("H")), e("sb", 0, 1, 2), e("addi", 2, 0, imm=ord("i")),
              e("sw", 0, 1, 2, imm=0), *EXIT),
        on_console=seen.append,
    )
    iss.run()
    assert iss.console_text == "Hi" and seen == [72, 105]


def test_tohost_codes():
    iss = Iss(words(*li(1, TOHOST_ADDR), e("addi", 2, 0, imm=7), e("sw", 0, 1, 2)))
    trace = iss.run()
    assert iss.tohost == 7 and not iss.passed
    assert trace[-1].halt and trace[-1].halt_reason == "tohost" and trace[-1].mem_wdata == 7


@pytest.mark.parametrize("insn,reason", [(e("ecall"), "ecall"), (e("ebreak"), "ebreak")])
def test_ecall_ebreak_halt_after_retiring(insn, reason):
    iss = Iss(words(e("addi", 1, 0, imm=1), insn, e("addi", 1, 0, imm=2)))
    trace = iss.run()
    assert len(trace) == 2 and trace[-1].halt and trace[-1].halt_reason == reason
    assert reg(iss, 1) == 1 and iss.halted and iss.tohost is None
    with pytest.raises(RuntimeError):
        iss.step()


def test_fence_is_a_nop():
    iss, trace = run(e("fence"), e("addi", 1, 0, imm=3))
    assert reg(iss, 1) == 3 and trace[0].rd_addr == 0


def test_cycle_counters_are_flagged_cycle_dependent():
    iss, trace = run(
        e("addi", 1, 0, imm=1), e("csrrs", 2, 0, csr=0xC00), e("csrrs", 3, 0, csr=0xC02), e("csrrs", 4, 0, csr=0xC80),
        *li(5, CYCLE_ADDR), e("lw", 6, 5, imm=0),
    )
    assert reg(iss, 3) == 2 and reg(iss, 4) == 0
    assert trace[1].cycle_dependent and not trace[2].cycle_dependent
    assert next(r for r in trace if r.rd_addr == 6).cycle_dependent


# ------------------------------------------------------------------ faults


@pytest.mark.parametrize(
    "prog,exc",
    [
        ([0x00000000], IllegalInstruction),
        ([e("csrrs", 1, 1, csr=0xC00)], IllegalInstruction),  # rs1 != x0 would write the csr
        ([e("csrrs", 1, 0, csr=0x300)], IllegalInstruction),  # unknown csr
        ([e("jal", 0, imm=6)], MisalignedFetch),
        ([e("beq", 0, 0, 0, imm=2)], MisalignedFetch),
        ([e("jal", 0, imm=-4)], BusFault),  # fetch below IMEM -> wraps outside
        ([e("lw", 1, 0, imm=0)], BusFault),  # IMEM is not readable by the data port
        ([e("sw", 0, 0, 0, imm=0)], BusFault),  # ... nor writable
        ([e("lui", 1, imm=TOHOST_ADDR & ~0xFFF), e("sb", 0, 1, 0, imm=4)], BusFault),  # TOHOST needs sw
        ([e("lui", 1, imm=CYCLE_ADDR & ~0xFFF), e("sw", 0, 1, 0, imm=8)], BusFault),  # CYCLE is read-only
    ],
)
def test_faults(prog, exc):
    with pytest.raises(exc):
        Iss(words(*prog)).run(100)


def test_runaway_program_times_out():
    with pytest.raises(TimeoutError):
        Iss(words(e("jal", 0, imm=0))).run(50)


def test_oversized_image_rejected():
    with pytest.raises(ValueError):
        Iss(bytes(4097))


def test_retire_order_and_pc_chain():
    _, trace = run(e("addi", 1, 0, imm=1), e("jal", 0, imm=8), e("addi", 1, 0, imm=9), e("addi", 2, 0, imm=2))
    assert [r.order for r in trace] == list(range(len(trace)))
    for a, b in zip(trace, trace[1:]):
        assert a.pc_wdata == b.pc


def test_taken_flag_marks_every_redirect_including_a_branch_to_the_next_instruction():
    _, trace = run(e("beq", 0, 0, 0, imm=4),       # taken, but the target is pc+4
                   e("bne", 0, 0, 0, imm=8),       # not taken
                   e("jal", 0, imm=4), e("jalr", 0, 0, imm=0x10), e("addi", 1, 0, imm=1))
    assert [r.taken for r in trace[:4]] == [True, False, True, True]
    assert not any(r.taken for r in trace[4:])
    assert trace[0].pc_wdata == trace[0].pc + 4  # which is exactly why pc_wdata alone is not enough
