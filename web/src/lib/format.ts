export const hex32 = (v: number) => `0x${(v >>> 0).toString(16).padStart(8, "0")}`;
export const hex8 = (v: number) => `0x${(v & 0xff).toString(16).padStart(2, "0")}`;
