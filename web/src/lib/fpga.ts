// Clock rate of the 5-stage pipeline on an iCE40UP5K (iCEBreaker), the post-route fmax that
// `bash fpga/ice40/build.sh` reports. Re-measure and update it whenever the RTL changes.
export const ICE40_FMAX_MHZ = 14.98;

/** Time for `cycles` clock edges at `fmaxMhz`, in microseconds. */
export function cyclesToMicroseconds(cycles: number, fmaxMhz: number = ICE40_FMAX_MHZ): number {
  return cycles / fmaxMhz;
}
