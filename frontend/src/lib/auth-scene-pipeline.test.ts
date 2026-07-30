import { describe, expect, it } from "vitest";
import {
  accessPointAt,
  AUTH_SCENE_PALETTES,
  CLIENT_CENTER,
  CLIENT_HINGE,
  CLIENT_LIFT,
  CLIENT_SCREEN_HEIGHT,
  CLIENT_SCREEN_NORMAL,
  CLIENT_SCREEN_UP,
  CLIENT_SCREEN_WIDTH,
  CLIENT_TILE_COUNT,
  clientDeckPoint,
  clientScreenPoint,
  clientTilePoint,
  FILE_KINDS,
  slotFaceSpan,
  slotPoint,
  STORE_CENTER,
  STORE_SLOTS,
  storeFacePoint,
  uploadPointAt,
  INTERIOR_LANES,
  INTERIOR_MANIFEST_ROWS,
  INTERIOR_STAGE_X,
  interiorLaneX,
  interiorManifestSpan,
  interiorPanelRect,
  interiorRowHalfHeight,
  interiorRowY,
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

describe("chassis front face", () => {
  it("puts the face in front of the chassis centre, so decals sit on the lit side", () => {
    expect(storeFacePoint(0.5, 0.5).z).toBeLessThan(STORE_CENTER.z);
  });

  it("runs u left to right and v top to bottom", () => {
    expect(storeFacePoint(1, 0.5).x).toBeGreaterThan(storeFacePoint(0, 0.5).x);
    expect(storeFacePoint(0.5, 1).y).toBeGreaterThan(storeFacePoint(0.5, 0).y);
  });

  it("centres the face on the chassis", () => {
    expect(storeFacePoint(0.5, 0.5).x).toBeCloseTo(STORE_CENTER.x);
    expect(storeFacePoint(0.5, 0.5).y).toBeCloseTo(STORE_CENTER.y);
  });

  it("lifts a decal toward the viewer", () => {
    expect(storeFacePoint(0.5, 0.5, 0.02).z).toBeLessThan(storeFacePoint(0.5, 0.5, 0).z);
  });

  /*
   * Human: The bays are drawn from these spans while the enclosure is drawn from its corners.
   * If a span escaped 0..1 a bay would hang off the chassis — which is exactly the class of
   * misalignment this geometry replaced.
   */
  it("keeps every bay inside the face and in top-to-bottom order", () => {
    let previousBottom = 0;
    for (let slot = 0; slot < STORE_SLOTS; slot += 1) {
      const span = slotFaceSpan(slot);
      expect(span.top).toBeGreaterThan(0);
      expect(span.bottom).toBeLessThan(1);
      expect(span.top).toBeLessThan(span.bottom);
      expect(span.top).toBeGreaterThanOrEqual(previousBottom);
      previousBottom = span.bottom;
    }
  });

  it("agrees with slotPoint about where a bay sits vertically", () => {
    for (let slot = 0; slot < STORE_SLOTS; slot += 1) {
      const span = slotFaceSpan(slot);
      const faceMiddle = storeFacePoint(0.5, (span.top + span.bottom) / 2);
      expect(faceMiddle.y).toBeCloseTo(slotPoint(slot).y);
    }
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
  /*
   * Human: The screen is a tilted plane now, so "inside the screen" is measured along the panel's
   * own axes rather than against world y/z. A tile near the top genuinely sits further away than
   * the panel centre — that is the tilt, not a bug.
   * Agent: Decomposes a tile into (across, up, out) relative to the hinge.
   */
  const decompose = (point: ReturnType<typeof clientTilePoint>) => {
    const dx = point.x - CLIENT_HINGE.x;
    const dy = point.y - CLIENT_HINGE.y;
    const dz = point.z - CLIENT_HINGE.z;
    return {
      across: dx,
      up: dy * CLIENT_SCREEN_UP.y + dz * CLIENT_SCREEN_UP.z,
      out: dy * CLIENT_SCREEN_NORMAL.y + dz * CLIENT_SCREEN_NORMAL.z,
    };
  };

  it("keeps every tile inside the screen face", () => {
    for (let tile = 0; tile < CLIENT_TILE_COUNT; tile += 1) {
      const local = decompose(clientTilePoint(tile));
      expect(Math.abs(local.across)).toBeLessThan(CLIENT_SCREEN_WIDTH / 2);
      expect(local.up).toBeGreaterThan(0);
      expect(local.up).toBeLessThan(CLIENT_SCREEN_HEIGHT);
    }
  });

  it("lifts every tile just clear of the screen so it never z-fights the bezel", () => {
    for (let tile = 0; tile < CLIENT_TILE_COUNT; tile += 1) {
      const local = decompose(clientTilePoint(tile));
      expect(local.out).toBeGreaterThan(0);
      expect(local.out).toBeLessThan(CLIENT_SCREEN_HEIGHT * 0.1);
    }
  });

  it("tilts the screen back, so the top of the panel sits further from the viewer", () => {
    const bottom = clientScreenPoint(0.5, 0);
    const top = clientScreenPoint(0.5, 1);
    expect(top.z).toBeGreaterThan(bottom.z);
    expect(top.y).toBeLessThan(bottom.y);
  });

  it("runs the deck from the hinge toward the viewer", () => {
    const back = clientDeckPoint(0.5, 0);
    const front = clientDeckPoint(0.5, 1);
    expect(front.z).toBeLessThan(back.z);
    expect(back.z).toBeCloseTo(CLIENT_HINGE.z);
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
      // Human: The interior's three role colours must all resolve, or a beat renders invisible.
      expect(palette.verified).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.slot).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.opacity).toBeGreaterThan(0);
      expect(palette.opacity).toBeLessThanOrEqual(1);
    }
  });
});


describe("server interior panel", () => {
  /*
   * Human: The interior is a flat schematic now, so what matters is that the layout stays on its
   * grid: stages in order left to right, rows evenly spaced, nothing escaping the panel.
   */
  it("orders the pipeline stages left to right without overlapping", () => {
    const order = [
      INTERIOR_STAGE_X.intake,
      INTERIOR_STAGE_X.intakeEnd,
      INTERIOR_STAGE_X.gate,
      INTERIOR_STAGE_X.gateEnd,
      INTERIOR_STAGE_X.laneStart,
      INTERIOR_STAGE_X.laneEnd,
      INTERIOR_STAGE_X.drive,
      INTERIOR_STAGE_X.driveEnd,
      INTERIOR_STAGE_X.manifest,
      INTERIOR_STAGE_X.manifestEnd,
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index]).toBeGreaterThan(order[index - 1]);
    }
    expect(order[0]).toBeGreaterThan(0);
    expect(order[order.length - 1]).toBeLessThanOrEqual(1);
  });

  it("spaces the lane rows evenly and keeps them inside the panel", () => {
    const half = interiorRowHalfHeight();
    let previous = -1;
    let firstGap = -1;
    for (let row = 0; row < INTERIOR_LANES; row += 1) {
      const center = interiorRowY(row);
      expect(center - half).toBeGreaterThan(0);
      expect(center + half).toBeLessThan(1);
      if (previous >= 0) {
        const gap = center - previous;
        if (firstGap < 0) firstGap = gap;
        // Human: Even spacing is what makes the panel read as a grid rather than a pile.
        expect(gap).toBeCloseTo(firstGap);
      }
      previous = center;
    }
  });

  it("never lets neighbouring rows touch", () => {
    const half = interiorRowHalfHeight();
    for (let row = 1; row < INTERIOR_LANES; row += 1) {
      expect(interiorRowY(row) - half).toBeGreaterThan(interiorRowY(row - 1) + half);
    }
  });

  it("runs a shard from the lane start to the lane end and clamps beyond", () => {
    expect(interiorLaneX(0)).toBeCloseTo(INTERIOR_STAGE_X.laneStart);
    expect(interiorLaneX(1)).toBeCloseTo(INTERIOR_STAGE_X.laneEnd);
    expect(interiorLaneX(0.5)).toBeGreaterThan(interiorLaneX(0.25));
    expect(interiorLaneX(-3)).toBeCloseTo(INTERIOR_STAGE_X.laneStart);
    expect(interiorLaneX(9)).toBeCloseTo(INTERIOR_STAGE_X.laneEnd);
  });

  it("aligns manifest rows to the same grid as the lanes", () => {
    for (let row = 0; row < INTERIOR_MANIFEST_ROWS; row += 1) {
      const span = interiorManifestSpan(row);
      expect(span.top).toBeLessThan(span.bottom);
      expect((span.top + span.bottom) / 2).toBeCloseTo(interiorRowY(row));
    }
  });

  it("keeps the panel clear of the sign-in card and inside the viewport", () => {
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ]) {
      const rect = interiorPanelRect(width, height);
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.y).toBeGreaterThan(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
      // Human: The card column starts around 57% of the viewport on this layout.
      expect(rect.x + rect.width).toBeLessThan(width * 0.56);
    }
  });
});
