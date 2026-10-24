// 32 x 32-bit register file: two combinational read ports, one write port.
//  * x0 reads as zero and ignores writes.
//  * BYPASS=1 (pipelined core): write-first bypass - a read of the register being written this
//    cycle returns the write data, removing the WB->ID hazard without an extra forwarding path.
//    BYPASS=0 (single-cycle core): the writer IS the reader, so bypassing would feed an
//    instruction's own result back into its operands (`lw x1,0(x1)`) and create a
//    combinational loop. Reads always return the old register value.
//  * Registers reset to zero so simulations are deterministic.
module regfile #(
    parameter bit BYPASS = 1'b1
) (
    input  logic                clk,
    input  logic                rst_n,
    input  logic [4:0]          raddr1,
    input  logic [4:0]          raddr2,
    output logic [31:0]         rdata1,
    output logic [31:0]         rdata2,
    input  logic                we,
    input  logic [4:0]          waddr,
    input  logic [31:0]         wdata,
    output logic [32*32-1:0]    dbg_regs   // register i at [32*i +: 32]
);

    logic [31:0] regs [32];
    logic        wr;

    assign wr = we && (waddr != 5'd0);

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int i = 0; i < 32; i++) regs[i] <= 32'b0;
        end else if (wr) begin
            regs[waddr] <= wdata;
        end
    end

    assign rdata1 = (BYPASS && wr && waddr == raddr1) ? wdata : regs[raddr1];
    assign rdata2 = (BYPASS && wr && waddr == raddr2) ? wdata : regs[raddr2];

    for (genvar i = 0; i < 32; i++) begin : g_dbg
        assign dbg_regs[32*i +: 32] = regs[i];
    end

endmodule
