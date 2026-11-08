import { interpolate, spring } from "remotion";
import { clampOpts, theme } from "../theme";

/** Eased 0..1 progress between two frames (clamped). */
export const prog = (frame: number, from: number, to: number, easing = theme.ease.out) =>
  interpolate(frame, [from, to], [0, 1], { ...clampOpts, easing });

/** Linear map of an eased progress into [a, b]. */
export const lerp = (p: number, a: number, b: number) => a + (b - a) * p;

export const springAt = (frame: number, fps: number, delay: number, config: object = theme.spring.smooth) =>
  spring({ frame: frame - delay, fps, config });

/** Keyframed value: [[frame, value], ...] with eased interpolation between neighbours. */
export function keys(frame: number, frames: [number, number][], easing = theme.ease.inOut): number {
  const f0 = frames[0];
  const fl = frames[frames.length - 1];
  if (!f0 || !fl) return 0;
  if (frame <= f0[0]) return f0[1];
  if (frame >= fl[0]) return fl[1];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i] as [number, number];
    const b = frames[i + 1] as [number, number];
    if (frame >= a[0] && frame <= b[0]) {
      return interpolate(frame, [a[0], b[0]], [a[1], b[1]], { ...clampOpts, easing });
    }
  }
  return fl[1];
}
