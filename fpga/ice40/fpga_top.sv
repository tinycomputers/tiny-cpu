// iCE40 top level for TinyCPU. The 5-stage pipeline (CORE="PIPE") runs the program preloaded into block RAM
// from fpga/images/. Console bytes leave on a 115200-baud UART through a 255-byte FIFO (a full FIFO sets
// `overflow` and drops the byte). The LEDs show the run: running, done (TOHOST written), pass, fault, overflow.
module fpga_top #(
    parameter int unsigned CLK_HZ     = 12_000_000,   // iCEBreaker oscillator
    parameter int unsigned BAUD       = 115_200,
    parameter string       IMEM_INIT  = "../images/fib.imem.hex",
    parameter string       DMEM_INIT  = "../images/fib.dmem.hex"
) (
    input  logic       clk,
    output logic       uart_tx,
    output logic [4:0] led
);

    // Power-on reset: hold reset for 2^16 clocks after configuration.
    logic [15:0] por_cnt = '0;
    logic        rst_n;
    assign rst_n = &por_cnt;
    always_ff @(posedge clk) begin
        if (!rst_n) por_cnt <= por_cnt + 16'd1;
    end

    logic       console_valid, tohost_valid, halted, fault;
    logic [7:0] console_data;
    logic [31:0] tohost_data;

    tiny_cpu_top #(
        .CORE      ("PIPE"),
        .IMEM_INIT (IMEM_INIT),
        .DMEM_INIT (DMEM_INIT)
    ) u_cpu (
        .clk, .rst_n,
        .cfg_forward_en (1'b1),
        .load_en (1'b0), .load_sel (1'b0), .load_addr ('0), .load_data (32'b0),
        .console_valid, .console_data, .tohost_valid, .tohost_data,
        .halted, .fault
    );

    // ---- console FIFO: written by the core's CONSOLE stores, read by the UART below
    localparam int unsigned DEPTH = 256;
    logic [7:0] fifo [DEPTH];
    logic [7:0] wp, rp;
    logic       overflow;
    wire        fifo_empty = (wp == rp);
    wire        fifo_full  = ((wp + 8'd1) == rp);   // one slot kept free, so a full FIFO is wp+1 == rp

    // ---- UART transmitter: 10-bit frame (start, 8 data LSB first, stop), one bit per DIV clocks
    localparam int unsigned DIV = CLK_HZ / BAUD;
    localparam logic [$clog2(DIV)-1:0] DIV_LAST = ($clog2(DIV))'(DIV - 1);
    logic [9:0]                 tx_sh;
    logic [$clog2(DIV)-1:0]     tick;
    logic [3:0]                 bitn;
    logic                       busy;

    assign uart_tx = busy ? tx_sh[0] : 1'b1;

    always_ff @(posedge clk) begin
        if (!rst_n) begin
            wp       <= '0;
            rp       <= '0;
            overflow <= 1'b0;
            busy     <= 1'b0;
            tick     <= '0;
            bitn     <= '0;
            tx_sh    <= '1;
        end else begin
            if (console_valid) begin
                if (!fifo_full) begin
                    fifo[wp] <= console_data;
                    wp       <= wp + 8'd1;
                end else begin
                    overflow <= 1'b1;
                end
            end

            if (!busy) begin
                if (!fifo_empty) begin
                    tx_sh <= {1'b1, fifo[rp], 1'b0};
                    rp    <= rp + 8'd1;
                    busy  <= 1'b1;
                    tick  <= '0;
                    bitn  <= '0;
                end
            end else if (tick == DIV_LAST) begin
                tick  <= '0;
                tx_sh <= {1'b1, tx_sh[9:1]};
                bitn  <= bitn + 4'd1;
                if (bitn == 4'd9) busy <= 1'b0;
            end else begin
                tick <= tick + 1'b1;
            end
        end
    end

    // ---- status LEDs
    assign led = {overflow, fault, (tohost_valid && tohost_data == 32'd1), tohost_valid, !halted};

endmodule
