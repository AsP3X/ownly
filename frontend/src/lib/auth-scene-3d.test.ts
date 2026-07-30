import { describe, expect, it } from "vitest";
import {
  bezierPoint,
  createRandom,
  fogFor,
  lerpPoint,
  projectPoint,
  SCENE_FAR,
  SCENE_NEAR,
  smoothstep,
  withAlpha,
  type SceneCamera,
  type SceneViewport,
} from "@/lib/auth-scene-3d";

const CAMERA: SceneCamera = { yaw: 0, pitch: 0, distance: 2.6, focal: 1.9 };
const VIEWPORT: SceneViewport = { width: 1000, height: 600, unit: 400 };

describe("projectPoint", () => {
  it("puts a point at the world origin in the centre of the viewport", () => {
    const point = projectPoint({ x: 0, y: 0, z: 0 }, CAMERA, VIEWPORT);
    expect(point.sx).toBeCloseTo(VIEWPORT.width / 2);
    expect(point.sy).toBeCloseTo(VIEWPORT.height / 2);
  });

  it("scales nearer points larger and hazes further ones", () => {
    const near = projectPoint({ x: 0, y: 0, z: -1 }, CAMERA, VIEWPORT);
    const far = projectPoint({ x: 0, y: 0, z: 1 }, CAMERA, VIEWPORT);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth).toBeLessThan(far.depth);
    expect(near.fog).toBeLessThan(far.fog);
  });

  it("maps +y downward on screen", () => {
    const below = projectPoint({ x: 0, y: 0.5, z: 0 }, CAMERA, VIEWPORT);
    expect(below.sy).toBeGreaterThan(VIEWPORT.height / 2);
  });

  it("swings a point across the frame as the camera yaws", () => {
    const straight = projectPoint({ x: 0.5, y: 0, z: 0 }, CAMERA, VIEWPORT);
    const yawed = projectPoint({ x: 0.5, y: 0, z: 0 }, { ...CAMERA, yaw: 0.6 }, VIEWPORT);
    expect(yawed.sx).not.toBeCloseTo(straight.sx);
  });

  it("clamps fog to 0..1 outside the near/far band", () => {
    expect(fogFor(SCENE_NEAR - 5)).toBe(0);
    expect(fogFor(SCENE_FAR + 5)).toBe(1);
    expect(fogFor((SCENE_NEAR + SCENE_FAR) / 2)).toBeCloseTo(0.5);
  });
});

describe("geometry helpers", () => {
  it("interpolates between two world points", () => {
    const mid = lerpPoint({ x: 0, y: 0, z: 0 }, { x: 2, y: -4, z: 6 }, 0.5);
    expect(mid).toEqual({ x: 1, y: -2, z: 3 });
  });

  it("starts and ends a bezier on its endpoints", () => {
    const from = { x: -1, y: 0, z: 0 };
    const control = { x: 0, y: 1, z: 0 };
    const to = { x: 1, y: 0, z: 0 };
    expect(bezierPoint(from, control, to, 0)).toEqual(from);
    expect(bezierPoint(from, control, to, 1)).toEqual(to);
    // Human: The curve must bow toward the control point, not run straight through.
    expect(bezierPoint(from, control, to, 0.5).y).toBeCloseTo(0.5);
  });

  it("smoothsteps between its edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, 0.25)).toBeLessThan(0.25);
  });
});

describe("withAlpha", () => {
  it("converts 6-digit hex to rgba", () => {
    expect(withAlpha("#2563eb", 0.5)).toBe("rgba(37, 99, 235, 0.5)");
  });

  it("expands 3-digit hex", () => {
    expect(withAlpha("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("clamps alpha into range", () => {
    expect(withAlpha("#000000", -2)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("#000000", 9)).toBe("rgba(0, 0, 0, 1)");
  });

  it("passes through anything that is not hex", () => {
    expect(withAlpha("currentColor", 0.5)).toBe("currentColor");
    expect(withAlpha("#12345", 0.5)).toBe("#12345");
  });
});

describe("createRandom", () => {
  it("is deterministic per seed and different across seeds", () => {
    const a = createRandom(99);
    const b = createRandom(99);
    const c = createRandom(100);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it("stays inside [0, 1)", () => {
    const random = createRandom(5);
    for (let index = 0; index < 200; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
