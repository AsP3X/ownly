// Human: Declarative auth-background scenes — fluid morphing blobs, mesh washes, and ribbons for login shells.
// Agent: READ by AuthSceneBackground; ADD new themes as AuthSceneTheme entries in AUTH_SCENE_THEMES.

/** Organic soft body that drifts, rotates, and morphs border-radius. */
export type AuthSceneBlob = {
  /** Position as % of viewport (left/top). */
  x: number;
  y: number;
  /** Diameter in vmin. */
  size: number;
  /** CSS color for the blob fill (solid or gradient stop). */
  color: string;
  /** Optional second color — renders as radial gradient for depth. */
  colorEnd?: string;
  /** Blur radius in px. */
  blur: number;
  /** Opacity 0–1. */
  opacity: number;
  /** Full animation cycle seconds. */
  duration: number;
  /** Animation delay seconds. */
  delay: number;
  /** Drift amplitude as vw/vh. */
  driftX: number;
  driftY: number;
  /** Scale pulse peak (1 = none). */
  pulse?: number;
  /** Max rotation degrees across the cycle. */
  rotate?: number;
  /** Which morph path to use (different organic radius sequences). */
  morph?: "a" | "b" | "c" | "d";
  /** Horizontal stretch for ribbon-like forms (1 = circle). */
  stretchX?: number;
  /** Vertical stretch. */
  stretchY?: number;
  /** CSS mix-blend-mode for luminous layering. */
  blend?: "multiply" | "screen" | "soft-light" | "overlay" | "plus-lighter" | "normal";
};

/** Large soft mesh wash — big radial fields that pan and breathe under the blobs. */
export type AuthSceneWash = {
  x: number;
  y: number;
  size: number;
  color: string;
  colorEnd?: string;
  opacity: number;
  blur: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  rotate?: number;
  pulse?: number;
};

export type AuthSceneTheme = {
  id: string;
  label: string;
  /** Full-page gradient stops for the soft base wash. */
  base: {
    from: string;
    via: string;
    to: string;
  };
  /** Frosted veil over the moving scene (keeps the form readable). */
  veil: {
    color: string;
    blurPx: number;
  };
  /** Optional subtle grain/tint color for atmosphere. */
  accentGlow?: string;
  /** Slow mesh washes (layer 0). */
  washes?: AuthSceneWash[];
  /** Morphing fluid bodies (layer 1). */
  blobs: AuthSceneBlob[];
  /** Tiny floating particles (layer 2). */
  particles?: Array<{
    x: number;
    y: number;
    size: number;
    color: string;
    duration: number;
    delay: number;
    driftX?: number;
    driftY?: number;
  }>;
  /**
   * @deprecated Prefer `blobs`. Kept so older call sites / tests still type-check during migration.
   * Agent: If present without blobs, AuthSceneBackground falls back to mapping orbs → blobs.
   */
  orbs?: AuthSceneBlob[];
};

export const AUTH_SCENE_THEMES: Record<string, AuthSceneTheme> = {
  aurora: {
    id: "aurora",
    label: "Aurora",
    base: {
      from: "#E8F0FF",
      via: "#F3ECFF",
      to: "#F7FBFF",
    },
    veil: {
      color: "rgba(255,255,255,0.28)",
      blurPx: 22,
    },
    accentGlow: "rgba(99, 102, 241, 0.18)",
    washes: [
      {
        x: 18,
        y: 22,
        size: 95,
        color: "rgba(96,165,250,0.55)",
        colorEnd: "rgba(167,139,250,0.05)",
        opacity: 0.85,
        blur: 40,
        duration: 22,
        delay: 0,
        driftX: 18,
        driftY: 12,
        rotate: 18,
        pulse: 1.18,
      },
      {
        x: 78,
        y: 68,
        size: 88,
        color: "rgba(56,189,248,0.45)",
        colorEnd: "rgba(129,140,248,0.04)",
        opacity: 0.75,
        blur: 48,
        duration: 28,
        delay: -8,
        driftX: -16,
        driftY: -14,
        rotate: -22,
        pulse: 1.22,
      },
      {
        x: 50,
        y: 40,
        size: 70,
        color: "rgba(196,181,253,0.4)",
        colorEnd: "transparent",
        opacity: 0.7,
        blur: 36,
        duration: 18,
        delay: -4,
        driftX: 12,
        driftY: -16,
        rotate: 30,
        pulse: 1.15,
      },
    ],
    blobs: [
      {
        x: 14,
        y: 20,
        size: 58,
        color: "#60A5FA",
        colorEnd: "#A78BFA",
        blur: 42,
        opacity: 0.62,
        duration: 14,
        delay: 0,
        driftX: 16,
        driftY: 12,
        pulse: 1.22,
        rotate: 28,
        morph: "a",
        blend: "multiply",
      },
      {
        x: 76,
        y: 16,
        size: 52,
        color: "#A78BFA",
        colorEnd: "#818CF8",
        blur: 38,
        opacity: 0.58,
        duration: 17,
        delay: -3,
        driftX: -14,
        driftY: 15,
        pulse: 1.28,
        rotate: -36,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 62,
        y: 66,
        size: 68,
        color: "#38BDF8",
        colorEnd: "#6366F1",
        blur: 48,
        opacity: 0.52,
        duration: 20,
        delay: -7,
        driftX: 12,
        driftY: -14,
        pulse: 1.3,
        rotate: 42,
        morph: "c",
        stretchX: 1.35,
        stretchY: 0.85,
        blend: "multiply",
      },
      {
        x: 22,
        y: 72,
        size: 42,
        color: "#818CF8",
        colorEnd: "#C4B5FD",
        blur: 32,
        opacity: 0.5,
        duration: 12,
        delay: -2,
        driftX: 18,
        driftY: -10,
        pulse: 1.18,
        rotate: -24,
        morph: "d",
        blend: "multiply",
      },
      {
        x: 48,
        y: 38,
        size: 36,
        color: "#93C5FD",
        colorEnd: "#DDD6FE",
        blur: 28,
        opacity: 0.48,
        duration: 11,
        delay: -5,
        driftX: -12,
        driftY: 14,
        pulse: 1.25,
        rotate: 50,
        morph: "a",
        stretchX: 1.5,
        stretchY: 0.7,
        blend: "soft-light",
      },
      {
        x: 88,
        y: 48,
        size: 30,
        color: "#67E8F9",
        colorEnd: "#A5B4FC",
        blur: 24,
        opacity: 0.45,
        duration: 9,
        delay: -1,
        driftX: -10,
        driftY: 18,
        pulse: 1.2,
        rotate: -48,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 36,
        y: 12,
        size: 46,
        color: "#C4B5FD",
        colorEnd: "#60A5FA",
        blur: 36,
        opacity: 0.4,
        duration: 16,
        delay: -9,
        driftX: 10,
        driftY: 16,
        pulse: 1.16,
        rotate: 20,
        morph: "c",
        stretchX: 0.75,
        stretchY: 1.4,
        blend: "soft-light",
      },
    ],
    particles: [
      { x: 22, y: 30, size: 4, color: "rgba(37,99,235,0.45)", duration: 9, delay: 0, driftX: 6, driftY: -14 },
      { x: 68, y: 42, size: 3, color: "rgba(129,140,248,0.5)", duration: 11, delay: -2, driftX: -8, driftY: -12 },
      { x: 48, y: 72, size: 3.5, color: "rgba(56,189,248,0.45)", duration: 10, delay: -4, driftX: 10, driftY: -16 },
      { x: 80, y: 28, size: 3, color: "rgba(167,139,250,0.45)", duration: 12, delay: -1, driftX: -6, driftY: -10 },
      { x: 30, y: 58, size: 2.5, color: "rgba(96,165,250,0.4)", duration: 8, delay: -6, driftX: 12, driftY: -18 },
      { x: 55, y: 18, size: 2.5, color: "rgba(99,102,241,0.4)", duration: 13, delay: -3, driftX: -10, driftY: -8 },
      { x: 12, y: 48, size: 2, color: "rgba(14,165,233,0.35)", duration: 10, delay: -7, driftX: 8, driftY: -12 },
      { x: 90, y: 70, size: 3, color: "rgba(196,181,253,0.4)", duration: 14, delay: -5, driftX: -12, driftY: -14 },
    ],
  },
  sunset: {
    id: "sunset",
    label: "Sunset",
    base: {
      from: "#FFF4E8",
      via: "#FFE8F0",
      to: "#FFF8EB",
    },
    veil: {
      color: "rgba(255,252,248,0.3)",
      blurPx: 24,
    },
    accentGlow: "rgba(249, 115, 22, 0.16)",
    washes: [
      {
        x: 20,
        y: 25,
        size: 92,
        color: "rgba(251,146,60,0.5)",
        colorEnd: "rgba(244,114,182,0.05)",
        opacity: 0.85,
        blur: 42,
        duration: 20,
        delay: 0,
        driftX: 16,
        driftY: 12,
        rotate: 24,
        pulse: 1.2,
      },
      {
        x: 72,
        y: 70,
        size: 86,
        color: "rgba(251,191,36,0.42)",
        colorEnd: "rgba(251,113,133,0.04)",
        opacity: 0.78,
        blur: 46,
        duration: 26,
        delay: -6,
        driftX: -14,
        driftY: -12,
        rotate: -28,
        pulse: 1.18,
      },
    ],
    blobs: [
      {
        x: 16,
        y: 22,
        size: 56,
        color: "#FB923C",
        colorEnd: "#F472B6",
        blur: 40,
        opacity: 0.58,
        duration: 13,
        delay: 0,
        driftX: 15,
        driftY: 11,
        pulse: 1.24,
        rotate: 32,
        morph: "a",
        blend: "multiply",
      },
      {
        x: 72,
        y: 18,
        size: 50,
        color: "#F472B6",
        colorEnd: "#FB7185",
        blur: 38,
        opacity: 0.55,
        duration: 16,
        delay: -4,
        driftX: -13,
        driftY: 14,
        pulse: 1.26,
        rotate: -30,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 58,
        y: 68,
        size: 62,
        color: "#FBBF24",
        colorEnd: "#FB923C",
        blur: 46,
        opacity: 0.5,
        duration: 19,
        delay: -8,
        driftX: 11,
        driftY: -13,
        pulse: 1.28,
        rotate: 38,
        morph: "c",
        stretchX: 1.4,
        stretchY: 0.8,
        blend: "multiply",
      },
      {
        x: 24,
        y: 72,
        size: 40,
        color: "#FB7185",
        colorEnd: "#FDBA74",
        blur: 32,
        opacity: 0.48,
        duration: 11,
        delay: -2,
        driftX: 16,
        driftY: -9,
        pulse: 1.2,
        rotate: -26,
        morph: "d",
        blend: "multiply",
      },
      {
        x: 46,
        y: 40,
        size: 34,
        color: "#FDBA74",
        colorEnd: "#F9A8D4",
        blur: 26,
        opacity: 0.46,
        duration: 10,
        delay: -5,
        driftX: -11,
        driftY: 13,
        pulse: 1.22,
        rotate: 44,
        morph: "a",
        stretchX: 1.45,
        stretchY: 0.72,
        blend: "soft-light",
      },
      {
        x: 86,
        y: 52,
        size: 28,
        color: "#FCD34D",
        colorEnd: "#FB7185",
        blur: 22,
        opacity: 0.42,
        duration: 9,
        delay: -1,
        driftX: -12,
        driftY: 16,
        pulse: 1.18,
        rotate: -40,
        morph: "b",
        blend: "multiply",
      },
    ],
    particles: [
      { x: 28, y: 26, size: 3.5, color: "rgba(249,115,22,0.45)", duration: 9, delay: 0, driftX: 6, driftY: -14 },
      { x: 74, y: 48, size: 3, color: "rgba(244,114,182,0.45)", duration: 11, delay: -3, driftX: -8, driftY: -12 },
      { x: 44, y: 68, size: 3.5, color: "rgba(251,191,36,0.45)", duration: 10, delay: -5, driftX: 10, driftY: -15 },
      { x: 60, y: 20, size: 2.5, color: "rgba(251,113,133,0.4)", duration: 12, delay: -2, driftX: -7, driftY: -10 },
      { x: 18, y: 55, size: 2.5, color: "rgba(253,186,116,0.4)", duration: 8, delay: -6, driftX: 11, driftY: -16 },
    ],
  },
  ocean: {
    id: "ocean",
    label: "Ocean",
    base: {
      from: "#E6FCFF",
      via: "#E8FDF8",
      to: "#EBF5FF",
    },
    veil: {
      color: "rgba(248,252,255,0.28)",
      blurPx: 22,
    },
    accentGlow: "rgba(14, 165, 233, 0.16)",
    washes: [
      {
        x: 16,
        y: 28,
        size: 94,
        color: "rgba(34,211,238,0.5)",
        colorEnd: "rgba(45,212,191,0.05)",
        opacity: 0.85,
        blur: 40,
        duration: 21,
        delay: 0,
        driftX: 17,
        driftY: 10,
        rotate: 20,
        pulse: 1.2,
      },
      {
        x: 74,
        y: 66,
        size: 90,
        color: "rgba(56,189,248,0.45)",
        colorEnd: "rgba(103,232,249,0.04)",
        opacity: 0.8,
        blur: 44,
        duration: 27,
        delay: -7,
        driftX: -15,
        driftY: -13,
        rotate: -26,
        pulse: 1.22,
      },
    ],
    blobs: [
      {
        x: 12,
        y: 24,
        size: 54,
        color: "#22D3EE",
        colorEnd: "#2DD4BF",
        blur: 40,
        opacity: 0.58,
        duration: 14,
        delay: 0,
        driftX: 17,
        driftY: 10,
        pulse: 1.24,
        rotate: 30,
        morph: "a",
        blend: "multiply",
      },
      {
        x: 70,
        y: 16,
        size: 48,
        color: "#2DD4BF",
        colorEnd: "#38BDF8",
        blur: 36,
        opacity: 0.55,
        duration: 17,
        delay: -4,
        driftX: -15,
        driftY: 13,
        pulse: 1.26,
        rotate: -34,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 54,
        y: 64,
        size: 64,
        color: "#38BDF8",
        colorEnd: "#67E8F9",
        blur: 46,
        opacity: 0.52,
        duration: 20,
        delay: -9,
        driftX: 12,
        driftY: -15,
        pulse: 1.3,
        rotate: 40,
        morph: "c",
        stretchX: 1.38,
        stretchY: 0.82,
        blend: "multiply",
      },
      {
        x: 22,
        y: 70,
        size: 38,
        color: "#67E8F9",
        colorEnd: "#5EEAD4",
        blur: 30,
        opacity: 0.48,
        duration: 11,
        delay: -2,
        driftX: 15,
        driftY: -10,
        pulse: 1.2,
        rotate: -28,
        morph: "d",
        blend: "multiply",
      },
      {
        x: 44,
        y: 38,
        size: 32,
        color: "#A5F3FC",
        colorEnd: "#99F6E4",
        blur: 24,
        opacity: 0.46,
        duration: 10,
        delay: -5,
        driftX: -12,
        driftY: 14,
        pulse: 1.22,
        rotate: 48,
        morph: "a",
        stretchX: 1.5,
        stretchY: 0.68,
        blend: "soft-light",
      },
      {
        x: 88,
        y: 50,
        size: 28,
        color: "#22D3EE",
        colorEnd: "#818CF8",
        blur: 22,
        opacity: 0.42,
        duration: 9,
        delay: -1,
        driftX: -11,
        driftY: 17,
        pulse: 1.18,
        rotate: -44,
        morph: "b",
        blend: "multiply",
      },
    ],
    particles: [
      { x: 26, y: 34, size: 3, color: "rgba(14,165,233,0.45)", duration: 9, delay: 0, driftX: 7, driftY: -14 },
      { x: 70, y: 40, size: 3.5, color: "rgba(45,212,191,0.45)", duration: 11, delay: -3, driftX: -9, driftY: -12 },
      { x: 46, y: 74, size: 3, color: "rgba(34,211,238,0.4)", duration: 10, delay: -6, driftX: 10, driftY: -16 },
      { x: 82, y: 24, size: 2.5, color: "rgba(56,189,248,0.4)", duration: 12, delay: -2, driftX: -8, driftY: -10 },
      { x: 14, y: 60, size: 2.5, color: "rgba(103,232,249,0.4)", duration: 8, delay: -5, driftX: 12, driftY: -15 },
    ],
  },
  mist: {
    id: "mist",
    label: "Mist",
    base: {
      from: "#F4F7FB",
      via: "#EEF2F8",
      to: "#EAEFFF",
    },
    veil: {
      color: "rgba(255,255,255,0.34)",
      blurPx: 26,
    },
    accentGlow: "rgba(100, 116, 139, 0.14)",
    washes: [
      {
        x: 22,
        y: 26,
        size: 90,
        color: "rgba(148,163,184,0.4)",
        colorEnd: "rgba(165,180,252,0.05)",
        opacity: 0.8,
        blur: 48,
        duration: 24,
        delay: 0,
        driftX: 14,
        driftY: 11,
        rotate: 16,
        pulse: 1.16,
      },
      {
        x: 70,
        y: 64,
        size: 84,
        color: "rgba(165,180,252,0.35)",
        colorEnd: "rgba(203,213,225,0.04)",
        opacity: 0.75,
        blur: 50,
        duration: 30,
        delay: -8,
        driftX: -12,
        driftY: -12,
        rotate: -20,
        pulse: 1.18,
      },
    ],
    blobs: [
      {
        x: 18,
        y: 22,
        size: 52,
        color: "#94A3B8",
        colorEnd: "#A5B4FC",
        blur: 44,
        opacity: 0.48,
        duration: 16,
        delay: 0,
        driftX: 13,
        driftY: 10,
        pulse: 1.16,
        rotate: 24,
        morph: "a",
        blend: "multiply",
      },
      {
        x: 72,
        y: 18,
        size: 46,
        color: "#A5B4FC",
        colorEnd: "#CBD5E1",
        blur: 40,
        opacity: 0.46,
        duration: 19,
        delay: -5,
        driftX: -12,
        driftY: 13,
        pulse: 1.2,
        rotate: -28,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 52,
        y: 66,
        size: 60,
        color: "#CBD5E1",
        colorEnd: "#C7D2FE",
        blur: 48,
        opacity: 0.44,
        duration: 22,
        delay: -10,
        driftX: 10,
        driftY: -12,
        pulse: 1.18,
        rotate: 34,
        morph: "c",
        stretchX: 1.3,
        stretchY: 0.85,
        blend: "multiply",
      },
      {
        x: 28,
        y: 70,
        size: 36,
        color: "#E2E8F0",
        colorEnd: "#A5B4FC",
        blur: 32,
        opacity: 0.42,
        duration: 13,
        delay: -3,
        driftX: 14,
        driftY: -9,
        pulse: 1.14,
        rotate: -22,
        morph: "d",
        blend: "soft-light",
      },
      {
        x: 48,
        y: 40,
        size: 30,
        color: "#C7D2FE",
        colorEnd: "#94A3B8",
        blur: 26,
        opacity: 0.4,
        duration: 11,
        delay: -6,
        driftX: -10,
        driftY: 12,
        pulse: 1.18,
        rotate: 40,
        morph: "a",
        stretchX: 1.4,
        stretchY: 0.75,
        blend: "soft-light",
      },
    ],
    particles: [
      { x: 30, y: 32, size: 2.5, color: "rgba(100,116,139,0.35)", duration: 11, delay: 0, driftX: 5, driftY: -12 },
      { x: 66, y: 50, size: 2, color: "rgba(129,140,248,0.35)", duration: 13, delay: -4, driftX: -7, driftY: -10 },
      { x: 42, y: 70, size: 2.5, color: "rgba(148,163,184,0.3)", duration: 12, delay: -7, driftX: 8, driftY: -14 },
    ],
  },
  forest: {
    id: "forest",
    label: "Forest",
    base: {
      from: "#E8FDF0",
      via: "#E8FDF5",
      to: "#F4FCE8",
    },
    veil: {
      color: "rgba(250,253,248,0.3)",
      blurPx: 24,
    },
    accentGlow: "rgba(34, 197, 94, 0.14)",
    washes: [
      {
        x: 18,
        y: 24,
        size: 92,
        color: "rgba(74,222,128,0.45)",
        colorEnd: "rgba(163,230,53,0.05)",
        opacity: 0.82,
        blur: 42,
        duration: 21,
        delay: 0,
        driftX: 15,
        driftY: 12,
        rotate: 22,
        pulse: 1.18,
      },
      {
        x: 74,
        y: 68,
        size: 86,
        color: "rgba(52,211,153,0.4)",
        colorEnd: "rgba(134,239,172,0.04)",
        opacity: 0.78,
        blur: 46,
        duration: 27,
        delay: -6,
        driftX: -14,
        driftY: -12,
        rotate: -24,
        pulse: 1.2,
      },
    ],
    blobs: [
      {
        x: 16,
        y: 20,
        size: 54,
        color: "#4ADE80",
        colorEnd: "#A3E635",
        blur: 40,
        opacity: 0.55,
        duration: 14,
        delay: 0,
        driftX: 15,
        driftY: 12,
        pulse: 1.22,
        rotate: 28,
        morph: "a",
        blend: "multiply",
      },
      {
        x: 74,
        y: 22,
        size: 50,
        color: "#A3E635",
        colorEnd: "#34D399",
        blur: 36,
        opacity: 0.5,
        duration: 16,
        delay: -3,
        driftX: -13,
        driftY: 12,
        pulse: 1.24,
        rotate: -32,
        morph: "b",
        blend: "multiply",
      },
      {
        x: 56,
        y: 68,
        size: 64,
        color: "#34D399",
        colorEnd: "#86EFAC",
        blur: 46,
        opacity: 0.48,
        duration: 19,
        delay: -8,
        driftX: 12,
        driftY: -14,
        pulse: 1.28,
        rotate: 36,
        morph: "c",
        stretchX: 1.35,
        stretchY: 0.82,
        blend: "multiply",
      },
      {
        x: 26,
        y: 72,
        size: 36,
        color: "#86EFAC",
        colorEnd: "#BEF264",
        blur: 30,
        opacity: 0.46,
        duration: 12,
        delay: -2,
        driftX: 16,
        driftY: -9,
        pulse: 1.18,
        rotate: -26,
        morph: "d",
        blend: "multiply",
      },
      {
        x: 46,
        y: 38,
        size: 32,
        color: "#BBF7D0",
        colorEnd: "#D9F99D",
        blur: 24,
        opacity: 0.44,
        duration: 10,
        delay: -5,
        driftX: -11,
        driftY: 13,
        pulse: 1.2,
        rotate: 46,
        morph: "a",
        stretchX: 1.48,
        stretchY: 0.7,
        blend: "soft-light",
      },
      {
        x: 88,
        y: 48,
        size: 28,
        color: "#6EE7B7",
        colorEnd: "#A3E635",
        blur: 22,
        opacity: 0.42,
        duration: 9,
        delay: -1,
        driftX: -12,
        driftY: 16,
        pulse: 1.16,
        rotate: -42,
        morph: "b",
        blend: "multiply",
      },
    ],
    particles: [
      { x: 30, y: 28, size: 3, color: "rgba(34,197,94,0.4)", duration: 9, delay: 0, driftX: 6, driftY: -14 },
      { x: 66, y: 46, size: 3.5, color: "rgba(163,230,53,0.4)", duration: 11, delay: -4, driftX: -8, driftY: -12 },
      { x: 48, y: 72, size: 2.5, color: "rgba(52,211,153,0.35)", duration: 10, delay: -6, driftX: 10, driftY: -15 },
      { x: 18, y: 54, size: 2.5, color: "rgba(134,239,172,0.35)", duration: 12, delay: -2, driftX: 9, driftY: -11 },
    ],
  },
};

export type AuthSceneThemeId = keyof typeof AUTH_SCENE_THEMES;

export const DEFAULT_AUTH_SCENE_THEME: AuthSceneThemeId = "aurora";

export const AUTH_SCENE_THEME_IDS = Object.keys(AUTH_SCENE_THEMES) as AuthSceneThemeId[];

// Human: Normalize theme so callers always get blobs (orbs alias for back-compat).
// Agent: RETURNS theme with blobs filled from orbs when needed.
export function normalizeAuthSceneTheme(theme: AuthSceneTheme): AuthSceneTheme {
  if (theme.blobs?.length) return theme;
  if (theme.orbs?.length) return { ...theme, blobs: theme.orbs };
  return theme;
}

// Human: Resolve a theme id with a safe fallback — used by AuthPageShell and query params.
// Agent: RETURNS AUTH_SCENE_THEMES entry; UNKNOWN ids map to DEFAULT_AUTH_SCENE_THEME.
export function resolveAuthSceneTheme(id?: string | null): AuthSceneTheme {
  if (id && id in AUTH_SCENE_THEMES) {
    return normalizeAuthSceneTheme(AUTH_SCENE_THEMES[id as AuthSceneThemeId]);
  }
  return normalizeAuthSceneTheme(AUTH_SCENE_THEMES[DEFAULT_AUTH_SCENE_THEME]);
}

// Human: Pick a theme from the clock — morning/day/evening/night variants for free variety.
// Agent: READS local hour; RETURNS theme id without user config.
export function themeIdForTimeOfDay(date = new Date()): AuthSceneThemeId {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "mist";
  if (hour >= 11 && hour < 16) return "aurora";
  if (hour >= 16 && hour < 20) return "sunset";
  if (hour >= 20 || hour < 5) return "ocean";
  return "aurora";
}
