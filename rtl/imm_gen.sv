// Immediate generator: one 32-bit sign-extended immediate per instruction format.
module imm_gen
    import tiny_cpu_pkg::*;
(
    /* verilator lint_off UNUSEDSIGNAL */
    input  logic [31:0] insn,  // opcode bits [6:0] are decoded elsewhere
    /* verilator lint_on UNUSEDSIGNAL */
    input  imm_sel_t    sel,
    output logic [31:0] imm
);

    always_comb begin
        case (sel)
            IMM_I:   imm = {{20{insn[31]}}, insn[31:20]};
            IMM_S:   imm = {{20{insn[31]}}, insn[31:25], insn[11:7]};
            IMM_B:   imm = {{19{insn[31]}}, insn[31], insn[7], insn[30:25], insn[11:8], 1'b0};
            IMM_U:   imm = {insn[31:12], 12'b0};
            IMM_J:   imm = {{11{insn[31]}}, insn[31], insn[19:12], insn[20], insn[30:21], 1'b0};
            default: imm = 32'b0;
        endcase
    end

endmodule
