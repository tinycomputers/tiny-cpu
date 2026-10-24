// Read-only Zicntr counters: cycle/time (the same counter) and instret, with the high halves.
module csr_counters (
    input  logic        clk,
    input  logic        rst_n,
    input  logic        retire,      // an instruction retires this cycle
    input  logic [11:0] csr_addr,
    output logic [31:0] csr_rdata,
    output logic [31:0] cycle_lo,    // also read through the CYCLE MMIO register
    output logic [31:0] instret_lo
);

    logic [63:0] cycle_q;
    logic [63:0] instret_q;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cycle_q   <= 64'b0;
            instret_q <= 64'b0;
        end else begin
            cycle_q <= cycle_q + 64'd1;
            if (retire) instret_q <= instret_q + 64'd1;
        end
    end

    assign cycle_lo   = cycle_q[31:0];
    assign instret_lo = instret_q[31:0];

    always_comb begin
        case (csr_addr)
            12'hC00, 12'hC01: csr_rdata = cycle_q[31:0];
            12'hC02:          csr_rdata = instret_q[31:0];
            12'hC80, 12'hC81: csr_rdata = cycle_q[63:32];
            12'hC82:          csr_rdata = instret_q[63:32];
            default:          csr_rdata = 32'b0;
        endcase
    end

endmodule
