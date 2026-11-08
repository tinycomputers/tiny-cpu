import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * Layer 1: the product's own flat background with a faint engineering grid, the same grid the app's
 * panels sit on. It creeps very slowly so the frame never looks frozen. No glows, no noise.
 */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.1) % 48;
  const grid = `${theme.colors.line}66`;
  const mask = "radial-gradient(ellipse at center, black 35%, transparent 80%)";
  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          backgroundPosition: `${drift}px ${drift}px`,
          opacity: 0.35,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    </AbsoluteFill>
  );
};

/** Top layer: a light vignette that keeps the eye on the centre without darkening the edges. */
export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.28) 100%)" }} />
);
