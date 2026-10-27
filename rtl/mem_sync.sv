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
    // Optional $readmemh image for synthesis (FPGA builds); empty = all zeros, as in simulation.
    parameter string       INIT     = "",
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

    // The read port returns the old word (read-first). READ_NEW is applied after the read register, as a
    // merge of the bytes written at the same edge, so the memory itself has a plain read port that block RAM
    // inference accepts. The value seen on `rdata` is the same as a write-first read at that edge.
    logic [31:0] rd_q;          // word read at the last enabled edge (old contents)
    logic [3:0]  byp_mask_q;    // bytes written at that edge, when the read returns the new bytes
    logic [31:0] byp_data_q;    // the written data at that edge

    initial begin
        for (int i = 0; i < WORDS; i++) mem[i] = 32'b0;
        rd_q = 32'b0;
        byp_mask_q = 4'b0;
        byp_data_q = 32'b0;
        if (INIT != "") $readmemh(INIT, mem);
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
            rd_q       <= mem[raddr];
            byp_mask_q <= (READ_NEW && !ld_en && waddr == raddr) ? wmask : 4'b0;
            byp_data_q <= wdata;
        end
    end

    always_comb begin
        rdata = rd_q;
        for (int b = 0; b < 4; b++) begin
            if (byp_mask_q[b]) rdata[8*b +: 8] = byp_data_q[8*b +: 8];
        end
    end

endmodule
