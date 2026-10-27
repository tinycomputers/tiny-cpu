// Top level: a core plus its memories, with the program loader and the debug/retire bus.
//
// `CORE` selects the microarchitecture: "SINGLE" (reference, CPI 1) or "PIPE" (5-stage). The port list
// is identical for both so the testbenches and the WASM harness never change.
//
// Loading a program: hold rst_n low, then for each word pulse load_en with load_sel (0 = IMEM,
// 1 = DMEM), load_addr (word index) and load_data. Release rst_n to run.
module tiny_cpu_top
    import tiny_cpu_pkg::*;
#(
    parameter string CORE = "SINGLE",
    // Optional $readmemh images for the memories (FPGA builds). Empty = zeroed, as in simulation.
    parameter string IMEM_INIT = "",
    parameter string DMEM_INIT = "",
    // loader address width: wide enough for the larger memory
    localparam int unsigned LAW = (IMEM_AW > DMEM_AW) ? IMEM_AW : DMEM_AW
) (
    input  logic                clk,
    input  logic                rst_n,
    input  logic                cfg_forward_en,   // PIPE: 1 = forwarding on; 0 = stall on every RAW hazard

    input  logic                load_en,
    input  logic                load_sel,
    input  logic [LAW-1:0]      load_addr,
    input  logic [31:0]         load_data,

    output logic                rvfi_valid,
    output logic [31:0]         rvfi_order,
    output logic [31:0]         rvfi_pc,
    output logic [31:0]         rvfi_insn,
    output logic [4:0]          rvfi_rd_addr,
    output logic [31:0]         rvfi_rd_wdata,
    output logic [31:0]         rvfi_pc_wdata,
    output logic [31:0]         rvfi_mem_addr,
    output logic [3:0]          rvfi_mem_rmask,
    output logic [3:0]          rvfi_mem_wmask,
    output logic [31:0]         rvfi_mem_rdata,
    output logic [31:0]         rvfi_mem_wdata,
    output logic                rvfi_misaligned,
    output logic                rvfi_halt,
    output logic                rvfi_cycle_dep,

    output logic                console_valid,
    output logic [7:0]          console_data,
    output logic                tohost_valid,
    output logic [31:0]         tohost_data,

    output logic                halted,
    output logic                fault,
    output logic [31:0]         dbg_pc,
    output logic [32*32-1:0]    dbg_regs,
    output logic [31:0]         dbg_cycle,
    output logic [31:0]         dbg_instret,

    // Per-stage view for the visualizer: stage index 0=IF 1=ID 2=EX 3=MEM 4=WB. "SINGLE" only
    // ever populates IF and reports no hazards. dbg_fwd_a/b: 0 none, 1 EX/MEM, 2 MEM/WB.
    output logic [4:0]          dbg_stage_valid,
    output logic [5*32-1:0]     dbg_stage_pc,
    output logic [5*32-1:0]     dbg_stage_insn,
    output logic                dbg_flush_ifid,
    output logic                dbg_flush_idex,
    output logic                dbg_stall,
    output logic                dbg_load_use,
    output logic [1:0]          dbg_fwd_a,
    output logic [1:0]          dbg_fwd_b
);

    if (CORE == "SINGLE") begin : g_single
        logic [IMEM_AW-1:0] imem_raddr;
        logic [31:0]        imem_rdata;
        logic [DMEM_AW-1:0] dmem_raddr, dmem_waddr;
        logic [31:0]        dmem_rdata, dmem_wdata;
        logic [3:0]         dmem_wmask;

        core_single u_core (
            .clk, .rst_n,
            .imem_raddr, .imem_rdata,
            .dmem_raddr, .dmem_rdata, .dmem_wmask, .dmem_waddr, .dmem_wdata,
            .rvfi_valid, .rvfi_order, .rvfi_pc, .rvfi_insn, .rvfi_rd_addr, .rvfi_rd_wdata,
            .rvfi_pc_wdata, .rvfi_mem_addr, .rvfi_mem_rmask, .rvfi_mem_wmask, .rvfi_mem_rdata,
            .rvfi_mem_wdata, .rvfi_misaligned, .rvfi_halt, .rvfi_cycle_dep,
            .console_valid, .console_data, .tohost_valid, .tohost_data,
            .halted, .fault, .dbg_pc, .dbg_regs, .dbg_cycle, .dbg_instret,
            .dbg_stage_valid, .dbg_stage_pc, .dbg_stage_insn
        );

        // The single-cycle core has no hazards and ignores cfg_forward_en.
        /* verilator lint_off UNUSEDSIGNAL */
        logic unused_cfg;
        assign unused_cfg = cfg_forward_en;
        /* verilator lint_on UNUSEDSIGNAL */
        assign dbg_flush_ifid = 1'b0;
        assign dbg_flush_idex = 1'b0;
        assign dbg_stall      = 1'b0;
        assign dbg_load_use   = 1'b0;
        assign dbg_fwd_a      = 2'b00;
        assign dbg_fwd_b      = 2'b00;

        mem_comb #(.WORDS(IMEM_WORDS), .INIT(IMEM_INIT)) u_imem (
            .clk, .raddr(imem_raddr), .rdata(imem_rdata),
            .wmask(4'b0000), .waddr('0), .wdata(32'b0),     // IMEM is read-only to the core
            .ld_en(load_en && !load_sel), .ld_addr(load_addr[IMEM_AW-1:0]), .ld_data(load_data)
        );

        mem_comb #(.WORDS(DMEM_WORDS), .INIT(DMEM_INIT)) u_dmem (
            .clk, .raddr(dmem_raddr), .rdata(dmem_rdata),
            .wmask(dmem_wmask), .waddr(dmem_waddr), .wdata(dmem_wdata),
            .ld_en(load_en && load_sel), .ld_addr(load_addr[DMEM_AW-1:0]), .ld_data(load_data)
        );
    end else if (CORE == "PIPE") begin : g_pipe
        logic               imem_re;
        logic [IMEM_AW-1:0] imem_raddr;
        logic [31:0]        imem_rdata;
        logic [DMEM_AW-1:0] dmem_raddr, dmem_waddr;
        logic [31:0]        dmem_rdata, dmem_wdata;
        logic [3:0]         dmem_wmask;

        core_pipe u_core (
            .clk, .rst_n, .cfg_forward_en,
            .imem_re, .imem_raddr, .imem_rdata,
            .dmem_raddr, .dmem_rdata, .dmem_wmask, .dmem_waddr, .dmem_wdata,
            .rvfi_valid, .rvfi_order, .rvfi_pc, .rvfi_insn, .rvfi_rd_addr, .rvfi_rd_wdata,
            .rvfi_pc_wdata, .rvfi_mem_addr, .rvfi_mem_rmask, .rvfi_mem_wmask, .rvfi_mem_rdata,
            .rvfi_mem_wdata, .rvfi_misaligned, .rvfi_halt, .rvfi_cycle_dep,
            .console_valid, .console_data, .tohost_valid, .tohost_data,
            .halted, .fault, .dbg_pc, .dbg_regs, .dbg_cycle, .dbg_instret,
            .dbg_stage_valid, .dbg_stage_pc, .dbg_stage_insn, .dbg_flush_ifid, .dbg_flush_idex,
            .dbg_stall, .dbg_load_use, .dbg_fwd_a, .dbg_fwd_b
        );

        // IMEM is read-only to the core. DMEM read-new: a load in EX sees the store ahead of it in MEM.
        mem_sync #(.WORDS(IMEM_WORDS), .READ_NEW(1'b0), .INIT(IMEM_INIT)) u_imem (
            .clk, .re(imem_re), .raddr(imem_raddr), .rdata(imem_rdata),
            .wmask(4'b0000), .waddr('0), .wdata(32'b0),
            .ld_en(load_en && !load_sel), .ld_addr(load_addr[IMEM_AW-1:0]), .ld_data(load_data)
        );

        mem_sync #(.WORDS(DMEM_WORDS), .READ_NEW(1'b1), .INIT(DMEM_INIT)) u_dmem (
            .clk, .re(1'b1), .raddr(dmem_raddr), .rdata(dmem_rdata),
            .wmask(dmem_wmask), .waddr(dmem_waddr), .wdata(dmem_wdata),
            .ld_en(load_en && load_sel), .ld_addr(load_addr[DMEM_AW-1:0]), .ld_data(load_data)
        );
    end else begin : g_unsupported
        $error("tiny_cpu_top: unknown CORE=\"%s\" (use \"SINGLE\" or \"PIPE\")", CORE);
    end

endmodule
