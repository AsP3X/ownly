// Human: Soft fluid motion backdrop for auth pages — mesh washes + morphing blobs driven by scene themes.
// Agent: READS AuthSceneTheme; RENDERS base + washes + blobs + particles + sheen + veil; aria-hidden.

import { useMemo, type CSSProperties } from "react";
import {
  resolveAuthSceneTheme,
  themeIdForTimeOfDay,
  type AuthSceneThemeId,
} from "@/lib/auth-scene-themes";
import "./auth-scene-background.css";

export type AuthSceneBackgroundProps = {
  /** Explicit theme id — omit for time-of-day auto pick. */
  themeId?: AuthSceneThemeId | string | null;
  /** When true, ignore clock and use DEFAULT aurora unless themeId is set. */
  disableAutoTheme?: boolean;
  className?: string;
};

function blobBackground(color: string, colorEnd?: string): string {
  if (!colorEnd) return color;
  return `radial-gradient(circle at 35% 30%, ${color} 0%, ${colorEnd} 68%, transparent 100%)`;
}

// Human: Full-bleed decorative scene behind the auth form card.
// Agent: PURE render; NO network; CSS vars set from theme for one-pass styling.
export function AuthSceneBackground({
  themeId,
  disableAutoTheme = false,
  className,
}: AuthSceneBackgroundProps) {
  const theme = useMemo(() => {
    if (themeId) return resolveAuthSceneTheme(themeId);
    if (disableAutoTheme) return resolveAuthSceneTheme("aurora");
    return resolveAuthSceneTheme(themeIdForTimeOfDay());
  }, [themeId, disableAutoTheme]);

  const style = {
    "--auth-scene-from": theme.base.from,
    "--auth-scene-via": theme.base.via,
    "--auth-scene-to": theme.base.to,
    "--auth-scene-veil-color": theme.veil.color,
    "--auth-scene-veil-blur": `${theme.veil.blurPx}px`,
    "--auth-scene-accent": theme.accentGlow ?? "transparent",
  } as CSSProperties;

  const blobs = theme.blobs?.length ? theme.blobs : (theme.orbs ?? []);

  return (
    <div
      className={["auth-scene", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden
      data-auth-scene={theme.id}
    >
      <div className="auth-scene__base" />

      {(theme.washes ?? []).map((wash, index) => (
        <div
          key={`wash-${theme.id}-${index}`}
          className="auth-scene__wash"
          style={
            {
              left: `${wash.x}%`,
              top: `${wash.y}%`,
              width: `${wash.size}vmin`,
              height: `${wash.size}vmin`,
              marginLeft: `${-wash.size / 2}vmin`,
              marginTop: `${-wash.size / 2}vmin`,
              background: blobBackground(wash.color, wash.colorEnd),
              opacity: wash.opacity,
              animationDuration: `${wash.duration}s`,
              animationDelay: `${wash.delay}s`,
              "--auth-wash-dx": `${wash.driftX}vw`,
              "--auth-wash-dy": `${wash.driftY}vh`,
              "--auth-wash-pulse": String(wash.pulse ?? 1.15),
              "--auth-wash-rotate": `${wash.rotate ?? 18}deg`,
              "--auth-wash-blur": `${wash.blur}px`,
            } as CSSProperties
          }
        />
      ))}

      {blobs.map((blob, index) => (
        <div
          key={`blob-${theme.id}-${index}`}
          className="auth-scene__blob"
          data-morph={blob.morph ?? "a"}
          style={
            {
              left: `${blob.x}%`,
              top: `${blob.y}%`,
              width: `${blob.size}vmin`,
              height: `${blob.size}vmin`,
              marginLeft: `${-blob.size / 2}vmin`,
              marginTop: `${-blob.size / 2}vmin`,
              background: blobBackground(blob.color, blob.colorEnd),
              opacity: blob.opacity,
              mixBlendMode: blob.blend ?? "multiply",
              animationDuration: `${blob.duration}s`,
              animationDelay: `${blob.delay}s`,
              "--auth-blob-dx": `${blob.driftX}vw`,
              "--auth-blob-dy": `${blob.driftY}vh`,
              "--auth-blob-pulse": String(blob.pulse ?? 1.15),
              "--auth-blob-rotate": `${blob.rotate ?? 24}deg`,
              "--auth-blob-blur": `${blob.blur}px`,
              "--auth-blob-sx": String(blob.stretchX ?? 1),
              "--auth-blob-sy": String(blob.stretchY ?? 1),
            } as CSSProperties
          }
        />
      ))}

      {(theme.particles ?? []).map((particle, index) => (
        <div
          key={`particle-${theme.id}-${index}`}
          className="auth-scene__particle"
          style={
            {
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: particle.size,
              height: particle.size,
              background: particle.color,
              color: particle.color,
              animationDuration: `${particle.duration}s`,
              animationDelay: `${particle.delay}s`,
              "--auth-particle-dx": `${particle.driftX ?? 8}px`,
              "--auth-particle-dy": `${particle.driftY ?? -16}px`,
            } as CSSProperties
          }
        />
      ))}

      <div className="auth-scene__sheen" />
      <div className="auth-scene__veil" />
      <div className="auth-scene__vignette" />
    </div>
  );
}
