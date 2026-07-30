import { describe, expect, it } from "vitest";
import {
  accessPointAt,
  AUTH_SCENE_PALETTES,
  CLIENT_CENTER,
  CLIENT_LIFT,
  CLIENT_SCREEN_HEIGHT,
  CLIENT_SCREEN_WIDTH,
  CLIENT_TILE_COUNT,
  clientTilePoint,
  FILE_KINDS,
  slotPoint,
  STORE_CENTER,
  STORE_SLOTS,
  uploadPointAt,
} from "@/lib/auth-scene-pipeline";

describe("routes", () => {
  it("starts an upload where the file was picked up and lands it exactly on its slot", () => {
    // Human: The route begins at the hover point above the laptop, not at the laptop itself —
    // otherwise a file that has just been lifted has to dive back down before setting off.
    expect(uploadPointAt(0, 0.8, 4)).toEqual(CLIENT_LIFT);
    expect(uploadPointAt(1, 0.8, 4)).toEqual(slotPoint(4));
  });

  it("closes the loop — a read starts at the bay and ends back at the hover point", () => {
    expect(accessPointAt(0, -0.5, 2)).toEqual(slotPoint(2));
    expect(accessPointAt(1, 0.8, 4)).toEqual(CLIENT_LIFT);
  });

  it("holds the device and the store far enough apart to read as two places", () => {
    // Human: The gap has to dwarf the objects themselves, or the two ends of the journey
    // read as one cluster rather than "here" and "over there".
    const gap = Math.abs(STORE_CENTER.x - CLIENT_CENTER.x);
    expect(gap).toBeGreaterThan(CLIENT_SCREEN_WIDTH * 3);
  });

  it("hovers the pick point above the laptop, not inside it", () => {
    expect(CLIENT_LIFT.y).toBeLessThan(CLIENT_CENTER.y);
  });

  it("routes uploads and read-backs along visibly different arcs", () => {
    // Human: The upload bows above the straight line and the read-back below it — that is what
    // lets a viewer tell the two directions apart at a glance.
    expect(uploadPointAt(0.5, 0, 3).y).toBeLessThan(accessPointAt(0.5, 0, 3).y);
  });

  it("fans lanes apart mid-flight but not at the endpoints", () => {
    const left = uploadPointAt(0.5, -1, 4);
    const right = uploadPointAt(0.5, 1, 4);
    expect(Math.abs(left.y - right.y)).toBeGreaterThan(0.1);
    expect(uploadPointAt(1, -1, 4)).toEqual(uploadPointAt(1, 1, 4));
  });
});

describe("storage bays", () => {
  it("stacks slots around the store centre", () => {
    const top = slotPoint(0);
    const bottom = slotPoint(STORE_SLOTS - 1);
    expect(top.y).toBeLessThan(bottom.y);
    expect((top.y + bottom.y) / 2).toBeCloseTo(STORE_CENTER.y);
    expect(top.x).toBeCloseTo(STORE_CENTER.x);
  });
});

describe("clientTilePoint", () => {
  it("keeps every tile inside the screen", () => {
    for (let tile = 0; tile < CLIENT_TILE_COUNT; tile += 1) {
      const point = clientTilePoint(tile);
      expect(Math.abs(point.x - CLIENT_CENTER.x)).toBeLessThan(CLIENT_SCREEN_WIDTH / 2);
      expect(Math.abs(point.y - CLIENT_CENTER.y)).toBeLessThan(CLIENT_SCREEN_HEIGHT / 2);
      // Human: Tiles sit just in front of the screen so they never z-fight with the bezel.
      expect(point.z).toBeLessThan(CLIENT_CENTER.z);
    }
  });

  it("lays tiles out left to right, top to bottom", () => {
    expect(clientTilePoint(1).x).toBeGreaterThan(clientTilePoint(0).x);
    expect(clientTilePoint(4).y).toBeGreaterThan(clientTilePoint(0).y);
  });

  it("wraps out-of-range indices instead of flying off screen", () => {
    expect(clientTilePoint(CLIENT_TILE_COUNT)).toEqual(clientTilePoint(0));
    expect(clientTilePoint(-1)).toEqual(clientTilePoint(CLIENT_TILE_COUNT - 1));
  });
});

describe("palettes", () => {
  it("defines an accent for every file kind in both themes", () => {
    for (const palette of [AUTH_SCENE_PALETTES.light, AUTH_SCENE_PALETTES.dark]) {
      for (const kind of FILE_KINDS) {
        expect(palette.kinds[kind]).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(palette.opacity).toBeGreaterThan(0);
      expect(palette.opacity).toBeLessThanOrEqual(1);
    }
  });
});
