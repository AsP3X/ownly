import { describe, expect, it } from "vitest";
import {
  ambientSlots,
  blobSpreadAt,
  burstAt,
  CAMERA_SHOTS,
  clientEnergyAt,
  cursorStateAt,
  heroTileOnScreen,
  heroTileSelected,
  heroStateAt,
  interiorOpacityAt,
  interiorShardProgress,
  interiorStageAt,
  processSweepAt,
  storeShellOpacityAt,
  storeEnergyAt,
  storyAt,
  STORY_ACTS,
  STORY_DURATION,
  transferProgressAt,
  type StoryAct,
} from "@/lib/auth-scene-story";
import { CLIENT_CENTER, clientTilePoint, slotPoint, STORE_SLOTS } from "@/lib/auth-scene-pipeline";

function actStart(act: StoryAct): number {
  let cursor = 0;
  for (const spec of STORY_ACTS) {
    if (spec.id === act) return cursor;
    cursor += spec.duration;
  }
  throw new Error(`unknown act ${act}`);
}

/** Human: A time comfortably inside the given act. */
function midAct(act: StoryAct): number {
  const spec = STORY_ACTS.find((entry) => entry.id === act)!;
  return actStart(act) + spec.duration / 2;
}

describe("storyAt", () => {
  it("plays every act in order across one loop", () => {
    const seen = STORY_ACTS.map((spec) => storyAt(midAct(spec.id)).act);
    expect(seen).toEqual([
      "capture",
      "transit",
      "dock",
      "ingest",
      "seal",
      "retrieve",
      "display",
    ]);
  });

  it("loops — the same moment in the next cycle replays the same act", () => {
    const first = storyAt(3);
    const second = storyAt(3 + STORY_DURATION);
    expect(second.act).toBe(first.act);
    expect(second.t).toBeCloseTo(first.t);
    expect(second.loop).toBe(first.loop + 1);
  });

  it("advances the hero file's identity each loop", () => {
    const first = storyAt(1);
    const second = storyAt(1 + STORY_DURATION);
    expect(second.kind).not.toBe(first.kind);
    expect(second.slot).not.toBe(first.slot);
  });

  it("keeps the bay and tile within range for many loops", () => {
    for (let loop = 0; loop < 40; loop += 1) {
      const frame = storyAt(loop * STORY_DURATION + 1);
      expect(frame.slot).toBeGreaterThanOrEqual(0);
      expect(frame.slot).toBeLessThan(STORE_SLOTS);
      expect(frame.tile).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles time zero and negative time without breaking", () => {
    expect(storyAt(0).act).toBe("capture");
    expect(() => storyAt(-5)).not.toThrow();
    expect(storyAt(-5).loop).toBeGreaterThanOrEqual(0);
  });

  it("never leaves a gap between acts", () => {
    // Human: Sampling the whole loop finely must only ever land inside a known act.
    const ids = new Set(STORY_ACTS.map((spec) => spec.id));
    for (let time = 0; time < STORY_DURATION; time += 0.05) {
      expect(ids.has(storyAt(time).act)).toBe(true);
    }
  });
});

describe("camera", () => {
  it("frames the device at the start and the server during storage", () => {
    const capture = storyAt(midAct("capture")).camera;
    expect(capture.target.x).toBeCloseTo(CLIENT_CENTER.x);
    expect(capture.distance).toBeCloseTo(CAMERA_SHOTS.client.distance);

    const docked = storyAt(actStart("dock") + STORY_ACTS[2].duration - 0.01).camera;
    expect(docked.distance).toBeLessThan(CAMERA_SHOTS.wide.distance);
  });

  it("pulls back to the wide shot as the transfer starts", () => {
    const early = storyAt(actStart("transit") + 0.2).camera;
    const late = storyAt(actStart("transit") + STORY_ACTS[1].duration - 0.2).camera;
    expect(late.distance).toBeGreaterThan(early.distance);
  });

  it("moves continuously — no jumps between acts", () => {
    let previous = storyAt(0).camera;
    for (let time = 0.05; time < STORY_DURATION; time += 0.05) {
      const current = storyAt(time).camera;
      expect(Math.abs(current.distance - previous.distance)).toBeLessThan(0.12);
      expect(Math.abs(current.target.x - previous.target.x)).toBeLessThan(0.12);
      previous = current;
    }
  });

  it("returns to the opening shot by the end of the loop", () => {
    const opening = storyAt(0).camera;
    const closing = storyAt(STORY_DURATION - 0.01).camera;
    expect(closing.target.x).toBeCloseTo(opening.target.x, 1);
    expect(closing.distance).toBeCloseTo(opening.distance, 1);
  });
});

describe("hero file", () => {
  it("starts on the device screen and ends up back on it", () => {
    const opening = heroStateAt(storyAt(0.1));
    const closing = heroStateAt(storyAt(STORY_DURATION - 0.1));
    expect(opening.scale).toBeLessThan(0.6);
    expect(closing.scale).toBeLessThan(0.6);
  });

  it("is whole while leaving and arriving, and in pieces in transit", () => {
    expect(heroStateAt(storyAt(actStart("transit") + 0.1)).wholeness).toBeGreaterThan(0.9);
    expect(heroStateAt(storyAt(midAct("transit"))).wholeness).toBeLessThan(0.1);
    expect(heroStateAt(storyAt(actStart("display") + 0.1)).wholeness).toBeGreaterThan(0.9);
  });

  it("rests in its own bay while it is being ingested", () => {
    const frame = storyAt(midAct("ingest"));
    expect(heroStateAt(frame).position).toEqual(slotPoint(frame.slot));
  });

  it("stays visible whenever it is outside the server", () => {
    /*
     * Human: The file is only allowed to disappear while it is inside the server — it fades out
     * as it crosses into the enclosure, stays hidden while the interior draws the shards, and
     * fades back in as it emerges during `retrieve`.
     * Everywhere else it must be on screen, or the story skips a beat.
     */
    const fading: Partial<Record<StoryAct, (t: number) => boolean>> = {
      capture: (t) => t < 0.45,
      dock: () => true,
      ingest: () => true,
      seal: () => true,
      retrieve: (t) => t < 0.15,
      display: (t) => t > 0.7,
    };

    for (let time = 0; time < STORY_DURATION; time += 0.1) {
      const frame = storyAt(time);
      if (fading[frame.act]?.(frame.t)) continue;
      expect(heroStateAt(frame).opacity).toBeGreaterThan(0.05);
    }
  });

  it("never doubles back between acts", () => {
    /*
     * Human: Regression — the file used to lift off the laptop and then dive back down to it
     * before starting its journey, because the upload route began at the machine rather than
     * at the point the file had been lifted to.
     * Agent: Sampling every act boundary catches any handoff that jumps or reverses.
     */
    for (let time = 0; time < STORY_DURATION; time += 1 / 30) {
      const here = heroStateAt(storyAt(time));
      const next = heroStateAt(storyAt(time + 1 / 30));
      // Human: Between loops the file is invisible while it swaps to a new tile — only the
      // frames the viewer can actually see have to be continuous.
      if (here.opacity < 0.05 || next.opacity < 0.05) continue;
      const step = Math.hypot(
        next.position.x - here.position.x,
        next.position.y - here.position.y,
        next.position.z - here.position.z,
      );
      // Human: One frame of travel is small; a doubling-back or a cut shows up as a big jump.
      expect(step).toBeLessThan(0.06);
    }
  });

  it("keeps the file moving forward across the pick → transit handoff", () => {
    // Human: The moment `transit` takes over, the file must already be heading away from the
    // laptop rather than falling back toward it.
    const lastCapture = heroStateAt(storyAt(actStart("transit") - 0.02)).position;
    const firstTransit = heroStateAt(storyAt(actStart("transit") + 0.02)).position;
    const laterTransit = heroStateAt(storyAt(actStart("transit") + 0.6)).position;
    expect(firstTransit.x).toBeGreaterThanOrEqual(lastCapture.x - 0.01);
    expect(laterTransit.x).toBeGreaterThan(firstTransit.x);
  });

  it("hands off between acts without the file blinking out mid-flight", () => {
    // Human: The handoff that matters most is transit → store: the file must still be whole
    // and visible right up to the moment its chunks reach the bay.
    const lastTransit = storyAt(actStart("dock") - 0.05);
    expect(heroStateAt(lastTransit).opacity).toBeGreaterThan(0.5);
    expect(heroStateAt(lastTransit).position).not.toEqual(CLIENT_CENTER);
  });

  it("keeps every position finite", () => {
    for (let time = 0; time < STORY_DURATION; time += 0.05) {
      const { position, scale, opacity } = heroStateAt(storyAt(time));
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(Number.isFinite(position.z)).toBe(true);
      expect(scale).toBeGreaterThan(0);
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("the click", () => {
  it("shows a pointer only while the file is being picked", () => {
    expect(cursorStateAt(storyAt(midAct("capture"))).opacity).toBeGreaterThan(0.1);
    expect(cursorStateAt(storyAt(midAct("transit"))).opacity).toBe(0);
    expect(cursorStateAt(storyAt(midAct("ingest"))).opacity).toBe(0);
  });

  it("moves the pointer onto the file, then presses it", () => {
    const early = cursorStateAt(storyAt(actStart("capture") + 0.2));
    const onFile = cursorStateAt(storyAt(actStart("capture") + STORY_ACTS[0].duration * 0.4));
    const tile = clientTilePoint(storyAt(0).tile);
    expect(Math.abs(onFile.position.x - tile.x)).toBeLessThan(
      Math.abs(early.position.x - tile.x),
    );
    expect(onFile.press).toBeGreaterThan(0);
  });

  it("keeps the file on screen until the click releases it", () => {
    const beforeClick = storyAt(actStart("capture") + STORY_ACTS[0].duration * 0.2);
    const afterClick = storyAt(actStart("capture") + STORY_ACTS[0].duration * 0.8);
    expect(heroTileOnScreen(beforeClick)).toBe(true);
    expect(heroTileOnScreen(afterClick)).toBe(false);
    expect(heroTileSelected(beforeClick)).toBeLessThan(heroTileSelected(afterClick));
  });
});

describe("breaking apart", () => {
  it("spreads the blobs apart in transit and pulls them together on the way back", () => {
    expect(blobSpreadAt(storyAt(actStart("transit") + 0.1))).toBeLessThan(0.2);
    expect(blobSpreadAt(storyAt(midAct("transit")))).toBeGreaterThan(0.8);
    expect(blobSpreadAt(storyAt(actStart("retrieve") + STORY_ACTS[3].duration * 0.9))).toBeLessThan(
      0.2,
    );
  });

  it("flashes when the file breaks apart and when it reassembles", () => {
    expect(burstAt(storyAt(midAct("capture")))).toBe(0);
    const split = burstAt(storyAt(actStart("transit") + STORY_ACTS[1].duration * 0.28));
    const merge = burstAt(storyAt(actStart("retrieve") + STORY_ACTS[3].duration * 0.52));
    expect(split).toBeGreaterThan(0);
    expect(merge).toBeGreaterThan(0);
  });
});

describe("act cues", () => {
  it("shows transfer progress only once the transfer is under way", () => {
    expect(transferProgressAt(storyAt(midAct("capture")))).toBe(0);
    const mid = transferProgressAt(storyAt(midAct("transit")));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(transferProgressAt(storyAt(midAct("ingest")))).toBe(1);
  });

  it("runs the processing sweep only while the file is being stored", () => {
    expect(processSweepAt(storyAt(midAct("dock")))).toBeGreaterThan(0);
    expect(processSweepAt(storyAt(midAct("transit")))).toBe(-1);
    expect(processSweepAt(storyAt(midAct("display")))).toBe(-1);
  });

  it("lights the server most while it is holding the file", () => {
    expect(storeEnergyAt(storyAt(midAct("ingest")))).toBeGreaterThan(
      storeEnergyAt(storyAt(midAct("capture"))),
    );
  });

  it("keeps both energies inside 0..1 across the loop", () => {
    for (let time = 0; time < STORY_DURATION; time += 0.1) {
      const frame = storyAt(time);
      for (const value of [clientEnergyAt(frame), storeEnergyAt(frame)]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("ambientSlots", () => {
  it("fills some but not all bays, so the server looks used but not full", () => {
    for (let loop = 0; loop < 10; loop += 1) {
      const slots = ambientSlots(loop);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.length).toBeLessThan(STORE_SLOTS);
      expect(new Set(slots).size).toBe(slots.length);
      for (const slot of slots) {
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(STORE_SLOTS);
      }
    }
  });
});

describe("server interior sequence", () => {
  it("hands the frame from the shell to the interior and back, never showing both", () => {
    for (let time = 0; time < STORY_DURATION; time += 0.1) {
      const frame = storyAt(time);
      const shell = storeShellOpacityAt(frame);
      const interior = interiorOpacityAt(frame);
      expect(shell).toBeGreaterThanOrEqual(0);
      expect(shell).toBeLessThanOrEqual(1);
      // Human: They are complements — whichever side of the wall the camera is on gets drawn.
      expect(shell + interior).toBeCloseTo(1);
    }
  });

  it("keeps the shell solid outside the interior acts and gone during ingest", () => {
    expect(storeShellOpacityAt(storyAt(midAct("capture")))).toBe(1);
    expect(storeShellOpacityAt(storyAt(midAct("transit")))).toBe(1);
    expect(storeShellOpacityAt(storyAt(midAct("ingest")))).toBe(0);
    expect(storeShellOpacityAt(storyAt(midAct("retrieve")))).toBe(1);
    expect(storeShellOpacityAt(storyAt(midAct("display")))).toBe(1);
  });

  it("crosses in during dock and back out during seal", () => {
    expect(storeShellOpacityAt(storyAt(actStart("dock") + 0.05))).toBeGreaterThan(0.9);
    expect(storeShellOpacityAt(storyAt(actStart("ingest") - 0.05))).toBeLessThan(0.1);
    expect(storeShellOpacityAt(storyAt(actStart("seal") + 0.05))).toBeLessThan(0.1);
    expect(storeShellOpacityAt(storyAt(actStart("retrieve") - 0.05))).toBeGreaterThan(0.9);
  });

  it("runs the interior beats in order across ingest", () => {
    const early = interiorStageAt(storyAt(actStart("ingest") + 0.7));
    const middle = interiorStageAt(storyAt(midAct("ingest")));
    const late = interiorStageAt(storyAt(actStart("ingest") + 6.8));

    expect(early.arrive).toBeGreaterThan(early.shard);
    expect(middle.shard).toBeGreaterThan(middle.index);
    expect(late.index).toBeGreaterThan(late.shard * 0 + 0.5);
    // Human: Each beat only ever moves forward through the act.
    expect(middle.encrypt).toBeGreaterThanOrEqual(early.encrypt);
    expect(late.verify).toBeGreaterThanOrEqual(middle.verify);
  });

  it("holds every beat complete through seal", () => {
    const stage = interiorStageAt(storyAt(midAct("seal")));
    expect(stage.arrive).toBe(1);
    expect(stage.encrypt).toBe(1);
    expect(stage.shard).toBe(1);
    expect(stage.verify).toBe(1);
    expect(stage.index).toBe(1);
    expect(stage.sealed).toBeGreaterThan(0);
  });

  it("shows nothing inside while the camera is outside", () => {
    const stage = interiorStageAt(storyAt(midAct("transit")));
    expect(stage.arrive).toBe(0);
    expect(stage.shard).toBe(0);
    expect(stage.index).toBe(0);
  });

  it("staggers the shards so they arrive one after another", () => {
    const partway = interiorStageAt(storyAt(actStart("ingest") + 3.6));
    const first = interiorShardProgress(partway, 0, 4);
    const last = interiorShardProgress(partway, 3, 4);
    expect(first).toBeGreaterThan(last);
  });

  it("lands every shard by the time the shard beat completes", () => {
    const done = interiorStageAt(storyAt(midAct("seal")));
    for (let lane = 0; lane < 4; lane += 1) {
      expect(interiorShardProgress(done, lane, 4)).toBe(1);
    }
  });
});
