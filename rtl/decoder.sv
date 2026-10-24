// Instruction decoder: RV32I (+ fence, ecall/ebreak, Zicntr csrrs-read) -> control signals.
//
// Legality is exactly the golden ISS's definition (sim/golden/decode.py plus the csrrs
// restrictions in iss.py): anything else sets `illegal`, and every side-effecting control is
// forced low so an illegal instruction can never write state.
module decoder
    import tiny_cpu_pkg::*;
(
    input  logic [31:0] insn,
    output alu_op_t     alu_op,
    output logic        a_pc,          // ALU operand A = pc            (else rs1)
    output logic        b_imm,         // ALU operand B = immediate     (else rs2)
    output imm_sel_t    imm_sel,
    output logic        reg_we,        // writes rd (the core still ignores rd == x0)
    output wb_sel_t     wb_sel,
    output logic        mem_re,
    output logic        mem_we,
    output mem_size_t   mem_size,
    output logic        mem_unsigned,
    output logic        is_branch,
    output logic        is_jal,
    output logic        is_jalr,
    output logic        uses_rs1,      // reads rs1 (hazard detection, Phase 4)
    output logic        uses_rs2,
    output logic        is_halt,       // ecall / ebreak
    output logic        illegal
);

    logic [6:0]  opcode;
    logic [2:0]  funct3;
    logic [6:0]  funct7;
    logic [11:0] csr;
    logic        csr_known;

    assign opcode = insn[6:0];
    assign funct3 = insn[14:12];
    assign funct7 = insn[31:25];
    assign csr    = insn[31:20];

    // cycle, time, instret and their high halves
    assign csr_known = (csr == 12'hC00) || (csr == 12'hC01) || (csr == 12'hC02) ||
                       (csr == 12'hC80) || (csr == 12'hC81) || (csr == 12'hC82);

    always_comb begin
        alu_op       = ALU_ADD;
        a_pc         = 1'b0;
        b_imm        = 1'b0;
        imm_sel      = IMM_I;
        reg_we       = 1'b0;
        wb_sel       = WB_ALU;
        mem_re       = 1'b0;
        mem_we       = 1'b0;
        mem_size     = SZ_WORD;
        mem_unsigned = 1'b0;
        is_branch    = 1'b0;
        is_jal       = 1'b0;
        is_jalr      = 1'b0;
        uses_rs1     = 1'b0;
        uses_rs2     = 1'b0;
        is_halt      = 1'b0;
        illegal      = 1'b0;

        case (opcode)
            OP_LUI: begin
                alu_op  = ALU_COPY_B;
                b_imm   = 1'b1;
                imm_sel = IMM_U;
                reg_we  = 1'b1;
            end
            OP_AUIPC: begin
                a_pc    = 1'b1;
                b_imm   = 1'b1;
                imm_sel = IMM_U;
                reg_we  = 1'b1;
            end
            OP_JAL: begin
                imm_sel = IMM_J;
                is_jal  = 1'b1;
                reg_we  = 1'b1;
                wb_sel  = WB_PC4;
            end
            OP_JALR: begin
                if (funct3 == 3'b000) begin
                    b_imm    = 1'b1;
                    is_jalr  = 1'b1;
                    reg_we   = 1'b1;
                    wb_sel   = WB_PC4;
                    uses_rs1 = 1'b1;
                end else illegal = 1'b1;
            end
            OP_BRANCH: begin
                if (funct3 == 3'b010 || funct3 == 3'b011) illegal = 1'b1;
                else begin
                    imm_sel   = IMM_B;
                    is_branch = 1'b1;
                    uses_rs1  = 1'b1;
                    uses_rs2  = 1'b1;
                end
            end
            OP_LOAD: begin
                b_imm    = 1'b1;
                mem_re   = 1'b1;
                reg_we   = 1'b1;
                wb_sel   = WB_MEM;
                uses_rs1 = 1'b1;
                case (funct3)
                    3'b000:  mem_size = SZ_BYTE;
                    3'b001:  mem_size = SZ_HALF;
                    3'b010:  mem_size = SZ_WORD;
                    3'b100:  begin mem_size = SZ_BYTE; mem_unsigned = 1'b1; end
                    3'b101:  begin mem_size = SZ_HALF; mem_unsigned = 1'b1; end
                    default: illegal = 1'b1;
                endcase
            end
            OP_STORE: begin
                b_imm    = 1'b1;
                imm_sel  = IMM_S;
                mem_we   = 1'b1;
                uses_rs1 = 1'b1;
                uses_rs2 = 1'b1;
                case (funct3)
                    3'b000:  mem_size = SZ_BYTE;
                    3'b001:  mem_size = SZ_HALF;
                    3'b010:  mem_size = SZ_WORD;
                    default: illegal = 1'b1;
                endcase
            end
            OP_IMM: begin
                b_imm    = 1'b1;
                reg_we   = 1'b1;
                uses_rs1 = 1'b1;
                case (funct3)
                    3'b000: alu_op = ALU_ADD;
                    3'b010: alu_op = ALU_SLT;
                    3'b011: alu_op = ALU_SLTU;
                    3'b100: alu_op = ALU_XOR;
                    3'b110: alu_op = ALU_OR;
                    3'b111: alu_op = ALU_AND;
                    3'b001: begin
                        alu_op = ALU_SLL;
                        if (funct7 != 7'h00) illegal = 1'b1;
                    end
                    default: begin  // 3'b101
                        if (funct7 == 7'h00)      alu_op = ALU_SRL;
                        else if (funct7 == 7'h20) alu_op = ALU_SRA;
                        else                      illegal = 1'b1;
                    end
                endcase
            end
            OP_REG: begin
                reg_we   = 1'b1;
                uses_rs1 = 1'b1;
                uses_rs2 = 1'b1;
                case (funct3)
                    3'b000: begin
                        if (funct7 == 7'h00)      alu_op = ALU_ADD;
                        else if (funct7 == 7'h20) alu_op = ALU_SUB;
                        else                      illegal = 1'b1;
                    end
                    3'b101: begin
                        if (funct7 == 7'h00)      alu_op = ALU_SRL;
                        else if (funct7 == 7'h20) alu_op = ALU_SRA;
                        else                      illegal = 1'b1;
                    end
                    default: begin
                        if (funct7 != 7'h00) illegal = 1'b1;
                        case (funct3)
                            3'b001:  alu_op = ALU_SLL;
                            3'b010:  alu_op = ALU_SLT;
                            3'b011:  alu_op = ALU_SLTU;
                            3'b100:  alu_op = ALU_XOR;
                            3'b110:  alu_op = ALU_OR;
                            default: alu_op = ALU_AND;  // 3'b111
                        endcase
                    end
                endcase
            end
            OP_FENCE: begin
                if (funct3 != 3'b000) illegal = 1'b1;  // plain fence: a nop on this core
            end
            OP_SYSTEM: begin
                if (insn == 32'h0000_0073 || insn == 32'h0010_0073) is_halt = 1'b1;
                else if (funct3 == 3'b010 && insn[19:15] == 5'd0 && csr_known) begin
                    reg_we = 1'b1;
                    wb_sel = WB_CSR;
                end else illegal = 1'b1;
            end
            default: illegal = 1'b1;
        endcase

        if (illegal) begin  // an illegal instruction must not touch any state
            reg_we    = 1'b0;
            mem_re    = 1'b0;
            mem_we    = 1'b0;
            is_branch = 1'b0;
            is_jal    = 1'b0;
            is_jalr   = 1'b0;
            is_halt   = 1'b0;
        end
    end

endmodule
