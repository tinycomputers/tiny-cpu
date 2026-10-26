// Shared constants and enums. The numeric encodings here are mirrored in sim/consts.py and
// checked against this file by sim/golden/test_consts.py - change both together.
/* verilator lint_off UNUSEDPARAM */
package tiny_cpu_pkg;

    // ---- Memory map (docs/PLAN.md section 2.1) -------------------------------------------
    localparam int unsigned IMEM_WORDS = 1024;          // 4 KiB
    localparam int unsigned DMEM_WORDS = 1024;          // 4 KiB
    localparam int unsigned IMEM_AW    = $clog2(IMEM_WORDS);
    localparam int unsigned DMEM_AW    = $clog2(DMEM_WORDS);

    localparam logic [31:0] IMEM_BASE    = 32'h0000_0000;
    localparam logic [31:0] DMEM_BASE    = 32'h0001_0000;
    localparam logic [31:0] CONSOLE_ADDR = 32'h0002_0000;
    localparam logic [31:0] TOHOST_ADDR  = 32'h0002_0004;
    localparam logic [31:0] CYCLE_ADDR   = 32'h0002_0008;

    // ---- RV32I major opcodes -------------------------------------------------------------
    localparam logic [6:0] OP_LUI    = 7'h37;
    localparam logic [6:0] OP_AUIPC  = 7'h17;
    localparam logic [6:0] OP_JAL    = 7'h6F;
    localparam logic [6:0] OP_JALR   = 7'h67;
    localparam logic [6:0] OP_BRANCH = 7'h63;
    localparam logic [6:0] OP_LOAD   = 7'h03;
    localparam logic [6:0] OP_STORE  = 7'h23;
    localparam logic [6:0] OP_IMM    = 7'h13;
    localparam logic [6:0] OP_REG    = 7'h33;
    localparam logic [6:0] OP_FENCE  = 7'h0F;
    localparam logic [6:0] OP_SYSTEM = 7'h73;

    // ---- Control encodings ---------------------------------------------------------------
    typedef enum logic [3:0] {
        ALU_ADD    = 4'd0,
        ALU_SUB    = 4'd1,
        ALU_SLL    = 4'd2,
        ALU_SLT    = 4'd3,
        ALU_SLTU   = 4'd4,
        ALU_XOR    = 4'd5,
        ALU_SRL    = 4'd6,
        ALU_SRA    = 4'd7,
        ALU_OR     = 4'd8,
        ALU_AND    = 4'd9,
        ALU_COPY_B = 4'd10      // result = operand B (LUI)
    } alu_op_t;

    typedef enum logic [2:0] {
        IMM_I = 3'd0,
        IMM_S = 3'd1,
        IMM_B = 3'd2,
        IMM_U = 3'd3,
        IMM_J = 3'd4
    } imm_sel_t;

    typedef enum logic [1:0] {
        WB_ALU = 2'd0,
        WB_MEM = 2'd1,
        WB_PC4 = 2'd2,
        WB_CSR = 2'd3
    } wb_sel_t;

    typedef enum logic [1:0] {
        SZ_BYTE = 2'd0,
        SZ_HALF = 2'd1,
        SZ_WORD = 2'd2
    } mem_size_t;

endpackage
/* verilator lint_on UNUSEDPARAM */
