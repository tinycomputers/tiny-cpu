// Combinational ALU shared by the single-cycle and pipelined cores.
module alu
    import tiny_cpu_pkg::*;
(
    input  logic [31:0] a,
    input  logic [31:0] b,
    input  alu_op_t     op,
    output logic [31:0] y
);

    logic [4:0] shamt;
    assign shamt = b[4:0];

    always_comb begin
        case (op)
            ALU_ADD:    y = a + b;
            ALU_SUB:    y = a - b;
            ALU_SLL:    y = a << shamt;
            ALU_SLT:    y = {31'b0, $signed(a) < $signed(b)};
            ALU_SLTU:   y = {31'b0, a < b};
            ALU_XOR:    y = a ^ b;
            ALU_SRL:    y = a >> shamt;
            ALU_SRA:    y = 32'($signed(a) >>> shamt);
            ALU_OR:     y = a | b;
            ALU_AND:    y = a & b;
            ALU_COPY_B: y = b;
            default:    y = 32'b0;
        endcase
    end

endmodule
