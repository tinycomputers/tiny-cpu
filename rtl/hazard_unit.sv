// Data-hazard stall control for the instruction in ID.
//
//  * forward_en = 1: the only stall is the load-use hazard - the instruction in EX is a load (or a
//    CSR read) whose result the instruction in ID needs. One bubble; the consumer then reaches EX
//    as the producer is in WB and takes it from there.
//  * forward_en = 0: nothing is forwarded, so ID waits until every producer it depends on has
//    left EX and MEM. A producer in WB is read through the register file's write-first bypass.
//    This costs 2 stalls for a distance-1 dependency, 1 for distance 2, 0 for distance 3+.
//
// A redirect from EX squashes ID, so a stall for a wrong-path instruction is suppressed.
module hazard_unit (
    input  logic       forward_en,
    input  logic       redirect,

    input  logic       id_valid,
    input  logic       id_uses_rs1,
    input  logic       id_uses_rs2,
    input  logic [4:0] id_rs1,
    input  logic [4:0] id_rs2,

    input  logic       ex_wr,       // instruction in EX writes a register (rd != x0)
    input  logic       ex_late,     // ... and its result is only available in WB (load / CSR read)
    input  logic [4:0] ex_rd,
    input  logic       mm_wr,
    input  logic [4:0] mm_rd,

    output logic       stall,
    output logic       load_use
);

    logic ex_hit, mm_hit;

    // Old-style argument list: Yosys's parser (used for the FPGA build) does not accept ANSI-style function ports.
    function automatic logic needs;
        input logic uses;
        input logic [4:0] rs;
        input logic [4:0] rd;
        begin
            needs = uses && (rs != 5'd0) && (rs == rd);
        end
    endfunction

    assign ex_hit = ex_wr && (needs(id_uses_rs1, id_rs1, ex_rd) || needs(id_uses_rs2, id_rs2, ex_rd));
    assign mm_hit = mm_wr && (needs(id_uses_rs1, id_rs1, mm_rd) || needs(id_uses_rs2, id_rs2, mm_rd));

    assign load_use = id_valid && !redirect && ex_hit && ex_late;
    assign stall    = id_valid && !redirect && (forward_en ? (ex_hit && ex_late) : (ex_hit || mm_hit));

endmodule
