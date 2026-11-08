import React from "react";
import { interpolate } from "remotion";
import { clampOpts, theme } from "../theme";

interface Props {
  x: number;
  y: number;
  /** frames since the most recent click (undefined = no recent click) */
  sinceClick?: number;
  opacity?: number;
}

/** A pointer drawn in screen space: arrow, press squash and a ripple ring when it clicks. */
export const Cursor: React.FC<Props> = ({ x, y, sinceClick, opacity = 1 }) => {
  const press = sinceClick === undefined ? 0 : interpolate(sinceClick, [0, 4, 12], [0, 1, 0], clampOpts);
  const ring = sinceClick === undefined ? 0 : interpolate(sinceClick, [0, 18], [0, 1], { ...clampOpts, easing: theme.ease.out });
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity, pointerEvents: "none", zIndex: 50 }}>
      {sinceClick !== undefined && sinceClick < 20 && (
        <div
          style={{
            position: "absolute",
            left: x - 34,
            top: y - 34,
            width: 68,
            height: 68,
            borderRadius: "50%",
            border: `3px solid ${theme.colors.accent}`,
            opacity: (1 - ring) * 0.9,
            transform: `scale(${0.35 + ring * 1.1})`,
          }}
        />
      )}
      <svg
        width={46}
        height={46}
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          left: x - 5,
          top: y - 3,
          transform: `scale(${1 - press * 0.12})`,
          transformOrigin: "6px 3px",
          filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.55))",
        }}
      >
        <path d="M5.5 3.2 L5.5 19.4 L9.6 15.6 L12.3 21.4 L14.9 20.2 L12.3 14.6 L18 14.4 Z" fill="#ffffff" stroke="#0d1117" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </div>
  );
};
