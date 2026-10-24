// Conditional-branch comparator. funct3 is insn[14:12]; the reserved encodings 2 and 3 never
// take (the decoder flags them illegal).
module branch_unit (
    input  logic [31:0] a,
    input  logic [31:0] b,
    input  logic [2:0]  funct3,
    output logic        taken
);

    always_comb begin
        case (funct3)
            3'b000:  taken = (a == b);                    // beq
            3'b001:  taken = (a != b);                    // bne
            3'b100:  taken = ($signed(a) <  $signed(b));  // blt
            3'b101:  taken = ($signed(a) >= $signed(b));  // bge
            3'b110:  taken = (a <  b);                    // bltu
            3'b111:  taken = (a >= b);                    // bgeu
            default: taken = 1'b0;
        endcase
    end

endmodule
