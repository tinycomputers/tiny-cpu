import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme, clampOpts } from "../theme";

// Geometry copied from web/public/logo.svg (512 x 512): the three rows of five bars are a pipeline diagram,
// each row one instruction, shifted one stage to the right.
const ROW_Y = [158.5, 229.1, 299.8];
const ROW_X0 = [153.6, 183.9, 214.2];
const ROW_OPACITY = [0.95, 0.83, 0.71];
const BAR_W = 23.0;
const BAR_H = 53.7;
const STEP = 30.3;
const PINS = [158, 212, 256, 300, 354];

interface Props {
  size: number;
  /** frame (relative to the logo's own timeline) at which it starts to build */
  delay?: number;
  /** frames between adjacent diagonal bars */
  stagger?: number;
  /** show the tile (rounded square) behind the chip */
  tile?: boolean;
  glow?: boolean;
  /** extra uniform progress override 0..1 for the whole logo (e.g. exit) */
  alpha?: number;
}

export const LogoMark: React.FC<Props> = ({ size, delay = 0, stagger = 2.4, tile = true, glow = true, alpha = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chip = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  const pins = interpolate(frame, [delay + 4, delay + 22], [0, 1], { ...clampOpts, easing: theme.ease.out });
  const s = size / 512;
  const breathe = 1 + Math.sin(frame / 26) * 0.012;
  return (
    <div
      style={{
        width: size,
        height: size,
        opacity: alpha,
        transform: `scale(${interpolate(chip, [0, 1], [0.86, 1]) * breathe})`,
        filter: glow ? `drop-shadow(0 0 ${size * 0.16}px ${theme.colors.accent}55)` : undefined,
      }}
    >
      <svg viewBox="0 0 512 512" width={size} height={size}>
        {tile && <rect width="512" height="512" rx="96" fill={theme.colors.bg} stroke={theme.colors.line} strokeWidth={4} />}
        <g stroke={theme.colors.accent} strokeWidth={13} strokeLinecap="round" opacity={0.85 * pins}>
          {PINS.map((p, i) => {
            const k = interpolate(pins, [0, 1], [0, 1]);
            const d = (a: number, b: number) => a + (b - a) * k;
            return (
              <g key={i}>
                <path d={`M${p} ${d(112, 58)}V112`} />
                <path d={`M${p} ${d(400, 454)}V400`} />
                <path d={`M${d(112, 58)} ${p}H112`} />
                <path d={`M${d(400, 454)} ${p}H400`} />
              </g>
            );
          })}
        </g>
        <rect x="112" y="112" width="288" height="288" rx="26" fill={theme.colors.panel} stroke={theme.colors.line} strokeWidth={6} opacity={chip} />
        <rect x="136" y="136" width="240" height="240" rx="14" fill="none" stroke={theme.colors.accent} strokeOpacity={0.35 * chip} strokeWidth={3} />
        {ROW_Y.map((y, r) =>
          [0, 1, 2, 3, 4].map((c) => {
            const p = spring({ frame: frame - delay - 8 - (r + c) * stagger, fps, config: theme.spring.snappy });
            const h = BAR_H * p;
            const x = (ROW_X0[r] as number) + c * STEP;
            return (
              <rect
                key={`${r}-${c}`}
                x={x}
                y={y + (BAR_H - h) / 2}
                width={BAR_W}
                height={Math.max(0, h)}
                rx={4.1}
                fill={theme.colors.stage[c]}
                opacity={(ROW_OPACITY[r] as number) * Math.min(1, p * 1.4)}
              />
            );
          }),
        )}
      </svg>
      {/* keep the unused scale referenced for tooling */}
      <span style={{ display: "none" }}>{s}</span>
    </div>
  );
};
