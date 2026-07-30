// Human: Camera + projection maths shared by the auth background scene.
// Agent: PURE (no DOM, no canvas). The scene model lives in auth-scene-pipeline.ts; this file only projects points.

/** Human: World space — +x right, +y down (screen convention), +z away from the camera. */
export type ScenePoint = { x: number; y: number; z: number };

export type SceneCamera = {
  /** Radians, rotation about the Y axis. */
  yaw: number;
  /** Radians, rotation about the X axis. */
  pitch: number;
  /** How far the camera sits from what it is looking at, in world units. */
  distance: number;
  /** Focal length — larger flattens the perspective. */
  focal: number;
  /**
   * Human: The point the camera is framed on. Moving it pans and zooms the shot,
   * which is how the scene cuts between the laptop and the server.
   */
  target?: ScenePoint;
};

export type SceneViewport = {
  width: number;
  height: number;
  /** Pixels per projected world unit at the focal plane. */
  unit: number;
  /**
   * Human: Where the camera's target lands on screen, in pixels. Defaults to the middle of the
   * canvas; the director offsets it so a close-up does not sit behind the sign-in card.
   */
  centerX?: number;
  centerY?: number;
};

export type ProjectedPoint = {
  /** Screen pixels. */
  sx: number;
  sy: number;
  /** Perspective scale — 1 at the focal plane, >1 nearer, <1 further. */
  scale: number;
  /** Distance from the camera along the view axis; always > 0 for drawable points. */
  depth: number;
  /** 0 = closest drawable, 1 = lost in the haze. Drives alpha and line weight. */
  fog: number;
};

export const SCENE_NEAR = 0.55;
export const SCENE_FAR = 5.5;
/** Human: Nothing closer than this is drawable; lines crossing it get clipped, not dropped. */
export const SCENE_MIN_DEPTH = 0.45;

// Human: Deterministic PRNG so a reload always produces the same scene (and tests are stable).
// Agent: mulberry32 — cheap, good enough for layout scatter.
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Human: Rotate a world point by the camera and project it to screen pixels.
// Agent: RETURNS depth/fog alongside the screen position; depth <= 0 means behind the camera.
export function projectPoint(
  point: ScenePoint,
  camera: SceneCamera,
  viewport: SceneViewport,
): ProjectedPoint {
  // Human: Everything is measured relative to what the camera is looking at.
  const target = camera.target;
  const localX = target ? point.x - target.x : point.x;
  const localY = target ? point.y - target.y : point.y;
  const localZ = target ? point.z - target.z : point.z;

  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const xYaw = localX * cosYaw - localZ * sinYaw;
  const zYaw = localX * sinYaw + localZ * cosYaw;

  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const yPitch = localY * cosPitch - zYaw * sinPitch;
  const zPitch = localY * sinPitch + zYaw * cosPitch;

  const depth = zPitch + camera.distance;
  const safeDepth = depth <= 0.0001 ? 0.0001 : depth;
  const scale = camera.focal / safeDepth;

  return {
    sx: (viewport.centerX ?? viewport.width / 2) + xYaw * scale * viewport.unit,
    sy: (viewport.centerY ?? viewport.height / 2) + yPitch * scale * viewport.unit,
    scale,
    depth,
    fog: fogFor(safeDepth),
  };
}

// Human: Map camera distance onto a 0..1 haze factor used for alpha and line weight.
export function fogFor(depth: number): number {
  const t = (depth - SCENE_NEAR) / (SCENE_FAR - SCENE_NEAR);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Human: Linear blend between two world points.
export function lerpPoint(from: ScenePoint, to: ScenePoint, t: number): ScenePoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

// Human: Quadratic Bézier through a control point — every path in the scene is one of these.
export function bezierPoint(
  from: ScenePoint,
  control: ScenePoint,
  to: ScenePoint,
  t: number,
): ScenePoint {
  const inverse = 1 - t;
  const a = inverse * inverse;
  const b = 2 * inverse * t;
  const c = t * t;
  return {
    x: a * from.x + b * control.x + c * to.x,
    y: a * from.y + b * control.y + c * to.y,
    z: a * from.z + b * control.z + c * to.z,
  };
}

// Human: Hex colour + alpha → rgba(), so canvas fills and gradients can fade cleanly.
// Agent: ACCEPTS #rgb and #rrggbb; anything else is returned untouched.
export function withAlpha(hex: string, alpha: number): string {
  const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return hex;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamped * 1000) / 1000})`;
}

/** Human: Smooth 0→1 ramp; used everywhere motion needs to start and stop softly. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) return value < edge0 ? 0 : 1;
  const t = (value - edge0) / (edge1 - edge0);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}
