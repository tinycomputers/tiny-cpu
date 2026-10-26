"""Hand-derived hazard cases shared by the ISS-only model tests and the RTL tests.

Each case is (instructions, extra cycles with forwarding on, extra cycles with forwarding off), where
"extra" means cycles beyond the ideal N + 4 (N instructions + pipeline fill). The numbers were derived
on paper from the stage diagrams in docs/ARCHITECTURE.md, not from the RTL. SETUP puts the base
register 3+ instructions ahead of the loads so the only hazard in each case is the one under test.
"""

from golden.decode import encode as e

DMEM = (0x10008).to_bytes(4, "little") + bytes(60)  # word 0 holds a valid pointer into DMEM


ADD = e("addi", 1, 0, imm=5)
NOP = e("addi", 9, 0, imm=0)
SETUP = [e("lui", 3, imm=0x10000), NOP, NOP, NOP]
CASES = {
    "independent": ([ADD, e("addi", 2, 0, imm=6)], 0, 0),
    "alu->alu dist 1": ([ADD, e("addi", 2, 1, imm=1)], 0, 2),
    "alu->alu dist 2": ([ADD, NOP, e("addi", 2, 1, imm=1)], 0, 1),
    "alu->alu dist 3": ([ADD, NOP, NOP, e("addi", 2, 1, imm=1)], 0, 0),
    "load->use dist 1": (SETUP + [e("lw", 1, 3, imm=0), e("addi", 2, 1, imm=1)], 1, 2),
    "load->use dist 2": (SETUP + [e("lw", 1, 3, imm=0), NOP, e("addi", 2, 1, imm=1)], 0, 1),
    "load->use dist 3": (SETUP + [e("lw", 1, 3, imm=0), NOP, NOP, e("addi", 2, 1, imm=1)], 0, 0),
    "load->store-data dist 1": (SETUP + [e("lw", 1, 3, imm=0), e("sw", 0, 3, 1, imm=4)], 1, 2),
    "load->store-address dist 1": (SETUP + [e("lw", 1, 3, imm=0), e("sw", 0, 1, 3, imm=4)], 1, 2),
    "csr->use dist 1": ([e("csrrs", 1, 0, csr=0xC02), e("addi", 2, 1, imm=1)], 1, 2),
    "jal link->use dist 1": ([e("jal", 1, imm=4), e("addi", 2, 1, imm=1)], 2, 2),  # flush gap subsumes the stall
    "both operands late": (SETUP + [e("lw", 1, 3, imm=0), e("lw", 2, 3, imm=4), e("add", 4, 1, 2)], 1, 2),
    "taken jal": ([e("jal", 0, imm=8), e("addi", 7, 0, imm=1), e("addi", 8, 0, imm=2)], 2, 2),
    "taken branch": ([ADD, NOP, NOP, e("beq", 0, 1, 1, imm=8), e("addi", 7, 0, imm=1), e("addi", 8, 0, imm=2)], 2, 2),
    "taken branch to pc+4": ([ADD, NOP, NOP, e("beq", 0, 1, 1, imm=4), e("addi", 7, 0, imm=1)], 2, 2),
    "not-taken branch": ([ADD, NOP, NOP, e("bne", 0, 1, 1, imm=8)], 0, 0),
    "writes x0 never hazard": ([e("addi", 0, 0, imm=5), e("addi", 2, 0, imm=1)], 0, 0),
}


