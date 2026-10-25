// Operand forwarding into EX.
//
// A consumer in EX takes its operand from the instruction one ahead (now in MEM; its EX/MEM result)
// or two ahead (now in WB; the value being written back, including load data and CSR reads) instead
// of the stale ID/EX copy. A producer three ahead is handled by the register file's write-first
// bypass. The nearer producer wins. Never forwards x0. With forward_en = 0 nothing is forwarded;
// the hazard unit then stalls so that the register file bypass is the only path.
//
// The MEM-stage source is only valid for results that exist at the end of EX (ALU, pc+4). Loads
// and CSR reads are "late": hazard_unit stalls their consumer one cycle so it arrives when they are
// in WB, and this unit then forwards from WB.
module forward_unit (
    input  logic       forward_en,

    input  logic       ex_valid,
    input  logic       ex_uses_rs1,
    input  logic       ex_uses_rs2,
    input  logic [4:0] ex_rs1,
    input  logic [4:0] ex_rs2,

    input  logic       mm_wr,       // instruction in MEM writes a register
    input  logic [4:0] mm_rd,
    input  logic       wb_wr,       // instruction in WB writes a register (will retire)
    input  logic [4:0] wb_rd,

    output logic [1:0] fwd_a,       // 0 = ID/EX value, 1 = EX/MEM, 2 = MEM/WB
    output logic [1:0] fwd_b
);

    localparam logic [1:0] FWD_NONE  = 2'd0;
    localparam logic [1:0] FWD_EXMEM = 2'd1;
    localparam logic [1:0] FWD_MEMWB = 2'd2;

    function automatic logic [1:0] pick(input logic uses, input logic [4:0] rs);
        if (!forward_en || !ex_valid || !uses || rs == 5'd0) return FWD_NONE;
        if (mm_wr && mm_rd == rs) return FWD_EXMEM;
        if (wb_wr && wb_rd == rs) return FWD_MEMWB;
        return FWD_NONE;
    endfunction

    assign fwd_a = pick(ex_uses_rs1, ex_rs1);
    assign fwd_b = pick(ex_uses_rs2, ex_rs2);

endmodule
