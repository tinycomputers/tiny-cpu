// Simulation memory with a COMBINATIONAL read port (used by the single-cycle core).
// Not FPGA-friendly - the pipelined core uses mem_sync.sv (Phase 3) for BRAM inference.
//
// Two write paths: the core's byte-masked write, and a full-word `ld_*` loader port the
// testbench/harness uses to place a program image while the core is in reset.
module mem_comb #(
    parameter int unsigned WORDS = 1024,
    localparam int unsigned AW   = $clog2(WORDS)
) (
    input  logic          clk,
    input  logic [AW-1:0] raddr,    // word index
    output logic [31:0]   rdata,
    input  logic [3:0]    wmask,    // per-byte write enables
    input  logic [AW-1:0] waddr,
    input  logic [31:0]   wdata,
    input  logic          ld_en,
    input  logic [AW-1:0] ld_addr,
    input  logic [31:0]   ld_data
);

    logic [31:0] mem [WORDS];

    initial begin
        for (int i = 0; i < WORDS; i++) mem[i] = 32'b0;
    end

    always_ff @(posedge clk) begin
        if (ld_en) begin
            mem[ld_addr] <= ld_data;
        end else begin
            for (int b = 0; b < 4; b++) begin
                if (wmask[b]) mem[waddr][8*b +: 8] <= wdata[8*b +: 8];
            end
        end
    end

    assign rdata = mem[raddr];

endmodule
