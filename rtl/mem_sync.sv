// Memory with a SYNCHRONOUS read port (the read result appears one clock after the address) -
// the shape FPGA block RAM has, used by the pipelined core.
//
//  * `re` low holds the read register (used to stall fetch in Phase 4).
//  * READ_NEW=1: if the same clock edge also writes the address being read, the read returns the
//    NEW bytes (write-first). The pipeline needs this: a load reads DMEM in EX while the
//    store ahead of it writes in MEM, i.e. at the same edge, and must see the stored data.
//    READ_NEW=0 gives plain read-before-write behaviour.
//  * Two write paths, as in mem_comb: the core's byte-masked write and a word-wide loader port.
module mem_sync #(
    parameter int unsigned WORDS    = 1024,
    parameter bit          READ_NEW = 1'b1,
    localparam int unsigned AW      = $clog2(WORDS)
) (
    input  logic          clk,
    input  logic          re,
    input  logic [AW-1:0] raddr,
    output logic [31:0]   rdata,
    input  logic [3:0]    wmask,
    input  logic [AW-1:0] waddr,
    input  logic [31:0]   wdata,
    input  logic          ld_en,
    input  logic [AW-1:0] ld_addr,
    input  logic [31:0]   ld_data
);

    logic [31:0] mem [WORDS];

    initial begin
        for (int i = 0; i < WORDS; i++) mem[i] = 32'b0;
        rdata = 32'b0;
    end

    always_ff @(posedge clk) begin
        if (ld_en) begin
            mem[ld_addr] <= ld_data;
        end else begin
            for (int b = 0; b < 4; b++) begin
                if (wmask[b]) mem[waddr][8*b +: 8] <= wdata[8*b +: 8];
            end
        end

        if (re) begin
            rdata <= mem[raddr];  // old contents; the merge below overrides written bytes
            if (READ_NEW && !ld_en && waddr == raddr) begin
                for (int b = 0; b < 4; b++) begin
                    if (wmask[b]) rdata[8*b +: 8] <= wdata[8*b +: 8];
                end
            end
        end
    end

endmodule
