// Single-cycle RV32I core: fetch, decode, execute, memory and write-back in one clock.
//
// This is the reference microarchitecture: CPI is exactly 1, so cycles == instructions retired.
// It reuses the same alu / decoder / imm_gen / branch_unit / lsu / regfile as the pipelined
// core and is checked against the golden ISS (sim/golden/iss.py) in lockstep.
//
// Faults (illegal instruction, bus fault, misaligned/out-of-range jump) stop the core WITHOUT
// retiring the faulting instruction or changing any state - the ISS raises in exactly the same
// cases. Halting instructions (ecall, ebreak, a TOHOST store) retire, then stop the core.
//
// The rvfi_* outputs are REGISTERED: after a clock edge they describe the instruction that
// retired in the cycle that just ended (rvfi_valid is high for exactly that one cycle).
module core_single
    import tiny_cpu_pkg::*;
(
    input  logic                  clk,
    input  logic                  rst_n,

    // Instruction memory, combinational read
    output logic [IMEM_AW-1:0]    imem_raddr,
    input  logic [31:0]           imem_rdata,

    // Data memory, combinational read, byte-masked synchronous write
    output logic [DMEM_AW-1:0]    dmem_raddr,
    input  logic [31:0]           dmem_rdata,
    output logic [3:0]            dmem_wmask,
    output logic [DMEM_AW-1:0]    dmem_waddr,
    output logic [31:0]           dmem_wdata,

    // Retire record (RVFI-lite, docs/PLAN.md section 2.4)
    output logic                  rvfi_valid,
    output logic [31:0]           rvfi_order,
    output logic [31:0]           rvfi_pc,
    output logic [31:0]           rvfi_insn,
    output logic [4:0]            rvfi_rd_addr,
    output logic [31:0]           rvfi_rd_wdata,
    output logic [31:0]           rvfi_pc_wdata,
    output logic [31:0]           rvfi_mem_addr,
    output logic [3:0]            rvfi_mem_rmask,
    output logic [3:0]            rvfi_mem_wmask,
    output logic [31:0]           rvfi_mem_rdata,
    output logic [31:0]           rvfi_mem_wdata,
    output logic                  rvfi_misaligned,
    output logic                  rvfi_halt,
    output logic                  rvfi_cycle_dep,

    // MMIO side effects (registered, valid for the cycle after the retiring store)
    output logic                  console_valid,
    output logic [7:0]            console_data,
    output logic                  tohost_valid,    // sticky: a TOHOST store has happened
    output logic [31:0]           tohost_data,

    // Status and debug
    output logic                  halted,
    output logic                  fault,
    output logic [31:0]           dbg_pc,
    output logic [32*32-1:0]      dbg_regs,
    output logic [31:0]           dbg_cycle,
    output logic [31:0]           dbg_instret
);

    // ------------------------------------------------------------------ state
    logic [31:0] pc_q;
    logic        halted_q, fault_q;
    logic        active;

    assign active = !halted_q && !fault_q;

    // ------------------------------------------------------------------ fetch
    logic        fetch_fault;
    logic [31:0] insn;

    assign imem_raddr  = pc_q[IMEM_AW+1:2];
    assign fetch_fault = |pc_q[31:IMEM_AW+2];            // pc outside IMEM (pc is always word-aligned)
    assign insn        = fetch_fault ? 32'b0 : imem_rdata;

    // ------------------------------------------------------------------ decode
    alu_op_t     alu_op;
    imm_sel_t    imm_sel;
    wb_sel_t     wb_sel;
    mem_size_t   mem_size;
    logic        a_pc, b_imm, reg_we, mem_re, mem_we, mem_unsigned;
    logic        is_branch, is_jal, is_jalr, is_halt, illegal;
    /* verilator lint_off UNUSEDSIGNAL */
    logic        uses_rs1, uses_rs2;   // used by the pipelined core's hazard logic only
    /* verilator lint_on UNUSEDSIGNAL */

    decoder u_decoder (
        .insn(insn), .alu_op(alu_op), .a_pc(a_pc), .b_imm(b_imm), .imm_sel(imm_sel),
        .reg_we(reg_we), .wb_sel(wb_sel), .mem_re(mem_re), .mem_we(mem_we),
        .mem_size(mem_size), .mem_unsigned(mem_unsigned), .is_branch(is_branch),
        .is_jal(is_jal), .is_jalr(is_jalr), .uses_rs1(uses_rs1), .uses_rs2(uses_rs2),
        .is_halt(is_halt), .illegal(illegal)
    );

    logic [4:0]  rs1, rs2, rd;
    logic [31:0] imm;

    assign rs1 = insn[19:15];
    assign rs2 = insn[24:20];
    assign rd  = insn[11:7];

    imm_gen u_imm_gen (.insn(insn), .sel(imm_sel), .imm(imm));

    // ------------------------------------------------------------------ execute
    logic [31:0] rs1_data, rs2_data, alu_a, alu_b, alu_y;
    logic        br_taken;
    logic        wr_en;
    logic [31:0] wb_data;

    assign alu_a = a_pc  ? pc_q : rs1_data;
    assign alu_b = b_imm ? imm  : rs2_data;

    alu u_alu (.a(alu_a), .b(alu_b), .op(alu_op), .y(alu_y));
    branch_unit u_branch (.a(rs1_data), .b(rs2_data), .funct3(insn[14:12]), .taken(br_taken));

    logic [31:0] pc_plus4, pc_target, next_pc;
    logic        redirect, target_misaligned;

    assign pc_plus4  = pc_q + 32'd4;
    assign pc_target = pc_q + imm;
    assign redirect  = is_jal || is_jalr || (is_branch && br_taken);
    always_comb begin
        if (is_jalr)       next_pc = {alu_y[31:1], 1'b0};
        else if (redirect) next_pc = pc_target;
        else               next_pc = pc_plus4;
    end
    assign target_misaligned = redirect && (|next_pc[1:0]);

    // ------------------------------------------------------------------ memory
    logic [31:0] lsu_word_addr, lsu_wdata, lsu_rdata_lanes, lsu_load_value;
    logic [3:0]  lsu_lane_mask;
    logic        lsu_misaligned;
    logic [31:0] mem_word;
    logic        hit_dmem, mmio_fault, mmio_console_we, mmio_tohost_we;
    logic [31:0] mmio_rdata, mmio_tohost_data;
    logic [7:0]  mmio_console_data;
    logic [31:0] cycle_lo, instret_lo;

    lsu u_lsu (
        .addr(alu_y), .size(mem_size), .is_unsigned(mem_unsigned), .store_data(rs2_data),
        .mem_word(mem_word), .word_addr(lsu_word_addr), .lane_mask(lsu_lane_mask),
        .wdata(lsu_wdata), .rdata_lanes(lsu_rdata_lanes), .load_value(lsu_load_value),
        .misaligned(lsu_misaligned)
    );

    mmio u_mmio (
        .word_addr(lsu_word_addr), .re(mem_re), .we(mem_we), .wmask(lsu_lane_mask),
        .wdata(lsu_wdata), .cycle(cycle_lo), .hit_dmem(hit_dmem), .mmio_rdata(mmio_rdata),
        .console_we(mmio_console_we), .console_data(mmio_console_data),
        .tohost_we(mmio_tohost_we), .tohost_data(mmio_tohost_data), .fault(mmio_fault)
    );

    assign dmem_raddr = lsu_word_addr[DMEM_AW+1:2];
    assign mem_word   = hit_dmem ? dmem_rdata : mmio_rdata;

    // ------------------------------------------------------------------ CSRs
    logic [31:0] csr_rdata;
    logic        retire_now, fault_now, halt_now;

    csr_counters u_csr (
        .clk(clk), .rst_n(rst_n), .retire(retire_now), .csr_addr(insn[31:20]),
        .csr_rdata(csr_rdata), .cycle_lo(cycle_lo), .instret_lo(instret_lo)
    );

    // ------------------------------------------------------------------ retire / write-back
    assign fault_now  = active && (illegal || fetch_fault || mmio_fault || target_misaligned);
    assign retire_now = active && !fault_now;
    assign halt_now   = retire_now && (is_halt || mmio_tohost_we);

    always_comb begin
        case (wb_sel)
            WB_MEM:  wb_data = lsu_load_value;
            WB_PC4:  wb_data = pc_plus4;
            WB_CSR:  wb_data = csr_rdata;
            default: wb_data = alu_y;
        endcase
    end

    assign wr_en = retire_now && reg_we && (rd != 5'd0);

    regfile #(.BYPASS(1'b0)) u_regfile (
        .clk(clk), .rst_n(rst_n), .raddr1(rs1), .raddr2(rs2), .rdata1(rs1_data),
        .rdata2(rs2_data), .we(wr_en), .waddr(rd), .wdata(wb_data), .dbg_regs(dbg_regs)
    );

    assign dmem_wmask = (retire_now && mem_we && hit_dmem) ? lsu_lane_mask : 4'b0000;
    assign dmem_waddr = lsu_word_addr[DMEM_AW+1:2];
    assign dmem_wdata = lsu_wdata;

    // ------------------------------------------------------------------ sequential state
    logic mem_op, cycle_dep_now;
    assign mem_op        = mem_re || mem_we;
    assign cycle_dep_now = (mem_re && lsu_word_addr == CYCLE_ADDR) ||
                           (wb_sel == WB_CSR && (insn[31:20] == 12'hC00 || insn[31:20] == 12'hC01));

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            pc_q            <= IMEM_BASE;
            halted_q        <= 1'b0;
            fault_q         <= 1'b0;
            rvfi_valid      <= 1'b0;
            rvfi_order      <= 32'b0;
            rvfi_pc         <= 32'b0;
            rvfi_insn       <= 32'b0;
            rvfi_rd_addr    <= 5'b0;
            rvfi_rd_wdata   <= 32'b0;
            rvfi_pc_wdata   <= 32'b0;
            rvfi_mem_addr   <= 32'b0;
            rvfi_mem_rmask  <= 4'b0;
            rvfi_mem_wmask  <= 4'b0;
            rvfi_mem_rdata  <= 32'b0;
            rvfi_mem_wdata  <= 32'b0;
            rvfi_misaligned <= 1'b0;
            rvfi_halt       <= 1'b0;
            rvfi_cycle_dep  <= 1'b0;
            console_valid   <= 1'b0;
            console_data    <= 8'b0;
            tohost_valid    <= 1'b0;
            tohost_data     <= 32'b0;
        end else begin
            if (retire_now) pc_q <= next_pc;
            if (halt_now)   halted_q <= 1'b1;
            if (fault_now)  fault_q  <= 1'b1;

            rvfi_valid      <= retire_now;
            rvfi_order      <= instret_lo;
            rvfi_pc         <= pc_q;
            rvfi_insn       <= insn;
            rvfi_rd_addr    <= (reg_we && rd != 5'd0) ? rd : 5'b0;
            rvfi_rd_wdata   <= (reg_we && rd != 5'd0) ? wb_data : 32'b0;
            rvfi_pc_wdata   <= next_pc;
            rvfi_mem_addr   <= mem_op ? lsu_word_addr : 32'b0;
            rvfi_mem_rmask  <= mem_re ? lsu_lane_mask : 4'b0;
            rvfi_mem_wmask  <= mem_we ? lsu_lane_mask : 4'b0;
            rvfi_mem_rdata  <= mem_re ? lsu_rdata_lanes : 32'b0;
            rvfi_mem_wdata  <= mem_we ? lsu_wdata : 32'b0;
            rvfi_misaligned <= mem_op && lsu_misaligned;
            rvfi_halt       <= halt_now;
            rvfi_cycle_dep  <= cycle_dep_now;

            console_valid   <= retire_now && mmio_console_we;
            console_data    <= mmio_console_data;
            if (retire_now && mmio_tohost_we) begin
                tohost_valid <= 1'b1;
                tohost_data  <= mmio_tohost_data;
            end
        end
    end

    assign halted      = halted_q;
    assign fault       = fault_q;
    assign dbg_pc      = pc_q;
    assign dbg_cycle   = cycle_lo;
    assign dbg_instret = instret_lo;

endmodule
