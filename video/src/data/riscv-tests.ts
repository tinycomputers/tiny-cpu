// The 40 official riscv-tests rv32ui-p-* programs the core passes (ls sw/build/riscv-tests/*.elf).
export const RISCV_TESTS = "add addi and andi auipc beq bge bgeu blt bltu bne jal jalr lb lbu ld_st lh lhu lui lw or ori sb sh simple sll slli slt slti sltiu sltu sra srai srl srli st_ld sub sw xor xori"
  .split(" ")
  .map((n) => `rv32ui-p-${n}`);
