// Load/store unit datapath: byte-lane positioning, masks, load extension.
//
// Misaligned accesses are not supported (docs/PLAN.md section 2.2): the address is forced into
// alignment for the access and `misaligned` flags it. `rdata_lanes`/`wdata` are lane-positioned
// words with unselected lanes zero - the same convention as the golden ISS retire record.
module lsu
    import tiny_cpu_pkg::*;
(
    input  logic [31:0] addr,         // effective byte address (rs1 + imm)
    input  mem_size_t   size,
    input  logic        is_unsigned,  // loads: zero-extend instead of sign-extend
    input  logic [31:0] store_data,   // rs2
    input  logic [31:0] mem_word,     // raw aligned word returned by memory / MMIO
    output logic [31:0] word_addr,    // addr with the low two bits cleared
    output logic [3:0]  lane_mask,    // byte lanes touched, after forced alignment
    output logic [31:0] wdata,        // store_data moved into its lanes
    output logic [31:0] rdata_lanes,  // mem_word restricted to lane_mask
    output logic [31:0] load_value,   // extended, right-justified load result
    output logic        misaligned
);

    logic [1:0]  off;        // byte offset after forced alignment
    logic [31:0] size_mask;  // low 8/16/32 bits
    logic [31:0] lane_bits;  // lane_mask expanded to a bit mask
    logic [31:0] shifted;

    assign word_addr = {addr[31:2], 2'b00};

    always_comb begin
        case (size)
            SZ_BYTE: begin
                off        = addr[1:0];
                lane_mask  = 4'b0001 << off;
                size_mask  = 32'h0000_00FF;
                misaligned = 1'b0;
            end
            SZ_HALF: begin
                off        = {addr[1], 1'b0};
                lane_mask  = 4'b0011 << off;
                size_mask  = 32'h0000_FFFF;
                misaligned = addr[0];
            end
            default: begin
                off        = 2'b00;
                lane_mask  = 4'b1111;
                size_mask  = 32'hFFFF_FFFF;
                misaligned = |addr[1:0];
            end
        endcase
    end

    assign lane_bits   = {{8{lane_mask[3]}}, {8{lane_mask[2]}}, {8{lane_mask[1]}}, {8{lane_mask[0]}}};
    assign wdata       = (store_data & size_mask) << {off, 3'b000};
    assign rdata_lanes = mem_word & lane_bits;
    assign shifted     = rdata_lanes >> {off, 3'b000};

    always_comb begin
        case (size)
            SZ_BYTE: load_value = is_unsigned ? {24'b0, shifted[7:0]}
                                              : {{24{shifted[7]}}, shifted[7:0]};
            SZ_HALF: load_value = is_unsigned ? {16'b0, shifted[15:0]}
                                              : {{16{shifted[15]}}, shifted[15:0]};
            default: load_value = shifted;
        endcase
    end

endmodule
