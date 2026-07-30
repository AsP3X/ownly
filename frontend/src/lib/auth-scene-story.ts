// Human: The director for the auth background — a looping five-act story of one file's round trip.
// Agent: PURE. Given a time it returns the act, the camera framing, and where the hero file is.

import { lerpPoint, smoothstep, type ScenePoint } from "@/lib/auth-scene-3d";
import {
  accessPointAt,
  CLIENT_CENTER,
  CLIENT_LIFT,
  clientTilePoint,
  FILE_KINDS,
  slotPoint,
  STORE_CENTER,
  STORE_SLOTS,
  uploadPointAt,
  type FileKind,
} from "@/lib/auth-scene-pipeline";

/**
 * Human: The five acts, in order.
 * `capture`  — close on the laptop: a file is picked and lifts off the screen.
 * `transit`  — pull back: the file splits into chunks and crosses to the server.
 * `store`    — push in on the server: chunks land in a bay and are processed.
 * `retrieve` — the file is requested: chunks leave the bay and head home.
 * `display`  — back on the laptop: the file lands and appears on screen. Then it loops.
 */
export type StoryAct = "capture" | "transit" | "store" | "retrieve" | "display";

export type ActSpec = { id: StoryAct; duration: number };

export const STORY_ACTS: ActSpec[] = [
  { id: "capture", duration: 6 },
  { id: "transit", duration: 7.5 },
  { id: "store", duration: 6.5 },
  { id: "retrieve", duration: 7 },
  { id: "display", duration: 5 },
];

export const STORY_DURATION = STORY_ACTS.reduce((total, act) => total + act.duration, 0);

/* ---- Beat timings within an act (0 → 1) --------------------------------- */
/** Human: The pointer reaches the file here, presses here, and the file lifts from here. */
export const CURSOR_ARRIVE = 0.34;
export const CLICK_DOWN = 0.4;
export const CLICK_RELEASE = 0.52;
/** Human: Where the card breaks into blobs on the way out, and reassembles on the way back. */
export const SPLIT_START = 0.2;
export const SPLIT_END = 0.36;
export const MERGE_START = 0.42;
export const MERGE_END = 0.62;

export type CameraKey = {
  target: ScenePoint;
  distance: number;
  yaw: number;
  pitch: number;
  /**
   * Human: Where the target sits in the frame, as a fraction of the canvas. Close-ups are
   * pushed left of centre so the subject never ends up hidden behind the sign-in card.
   */
  frame: { x: number; y: number };
};

/** Human: The three shots the story cuts between. */
export const CAMERA_SHOTS: Record<"client" | "wide" | "store", CameraKey> = {
  client: {
    target: { ...CLIENT_CENTER },
    distance: 2.1,
    yaw: 0.2,
    pitch: 0.07,
    frame: { x: 0.26, y: 0.62 },
  },
  wide: {
    target: {
      x: (CLIENT_CENTER.x + STORE_CENTER.x) / 2,
      y: (CLIENT_CENTER.y + STORE_CENTER.y) / 2 + 0.04,
      z: (CLIENT_CENTER.z + STORE_CENTER.z) / 2,
    },
    distance: 4.15,
    yaw: 0.1,
    pitch: 0.03,
    frame: { x: 0.29, y: 0.56 },
  },
  store: {
    target: { ...STORE_CENTER },
    distance: 2.5,
    yaw: -0.16,
    pitch: 0.02,
    frame: { x: 0.36, y: 0.6 },
  },
};

/** Human: Which shot each act travels from and to — consecutive acts share a shot, so it never cuts. */
const ACT_SHOTS: Record<StoryAct, [keyof typeof CAMERA_SHOTS, keyof typeof CAMERA_SHOTS]> = {
  capture: ["client", "client"],
  transit: ["client", "wide"],
  store: ["wide", "store"],
  retrieve: ["store", "wide"],
  display: ["wide", "client"],
};

export type StoryFrame = {
  act: StoryAct;
  /** 0 → 1 through the current act. */
  t: number;
  /** How many complete loops have played — advances the hero file's kind and bay. */
  loop: number;
  camera: CameraKey;
  /** The file this loop follows. */
  kind: FileKind;
  /** The bay it is stored in. */
  slot: number;
  /** Which tile on the laptop screen it comes from and returns to. */
  tile: number;
};

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function blendCamera(from: CameraKey, to: CameraKey, t: number): CameraKey {
  return {
    target: lerpPoint(from.target, to.target, t),
    distance: lerp(from.distance, to.distance, t),
    yaw: lerp(from.yaw, to.yaw, t),
    pitch: lerp(from.pitch, to.pitch, t),
    frame: {
      x: lerp(from.frame.x, to.frame.x, t),
      y: lerp(from.frame.y, to.frame.y, t),
    },
  };
}

// Human: Resolve a moment in the loop into an act, a camera, and the hero file's identity.
// Agent: PURE and total — any finite time (including negative) maps into the loop.
export function storyAt(time: number): StoryFrame {
  const loopTime = ((time % STORY_DURATION) + STORY_DURATION) % STORY_DURATION;
  const loop = Math.floor(time / STORY_DURATION);

  let cursor = loopTime;
  let spec = STORY_ACTS[STORY_ACTS.length - 1];
  let t = 1;
  for (const candidate of STORY_ACTS) {
    if (cursor < candidate.duration) {
      spec = candidate;
      t = candidate.duration === 0 ? 1 : cursor / candidate.duration;
      break;
    }
    cursor -= candidate.duration;
  }

  const [fromShot, toShot] = ACT_SHOTS[spec.id];
  // Human: Ease the moves so the camera glides instead of sliding linearly.
  const camera = blendCamera(CAMERA_SHOTS[fromShot], CAMERA_SHOTS[toShot], smoothstep(0, 1, t));

  const safeLoop = Number.isFinite(loop) ? Math.max(0, loop) : 0;
  return {
    act: spec.id,
    t,
    loop: safeLoop,
    camera,
    kind: FILE_KINDS[safeLoop % FILE_KINDS.length],
    slot: (safeLoop * 3) % STORE_SLOTS,
    tile: (safeLoop * 5) % 12,
  };
}

/** Human: What the hero file looks like right now — where it is, and whether it is whole or in chunks. */
export type HeroState = {
  /** Where the file (or the head of its chunk train) sits in the world. */
  position: ScenePoint;
  /** 1 = a whole card, 0 = fully split into chunks; between the two they cross-fade. */
  wholeness: number;
  /** Overall visibility — fades in at the start of the loop and out at the end. */
  opacity: number;
  /** 0 → 1 along whichever route it is travelling, for laying out the chunk train. */
  routeT: number;
  /** Which route the chunk train follows, if any. */
  route: "upload" | "access" | null;
  /** How big the card is relative to its normal size — it shrinks onto the laptop screen. */
  scale: number;
};

// Human: Place the hero file for the current frame.
// Agent: Each act owns a contiguous slice of the file's journey, so the motion is continuous across cuts.
export function heroStateAt(frame: StoryFrame): HeroState {
  const { act, t, slot, tile } = frame;
  const tilePoint = clientTilePoint(tile);

  switch (act) {
    case "capture": {
      /*
       * Human: The file is clicked, then lifts off the screen and grows into a card.
       * Agent: It ends exactly on CLIENT_LIFT, which is also where the upload route begins —
       * that is what stops it snapping back to the laptop when `transit` takes over.
       */
      const rise = smoothstep(CLICK_RELEASE, 1, t);
      return {
        position: lerpPoint(tilePoint, CLIENT_LIFT, rise),
        wholeness: 1,
        opacity: smoothstep(CLICK_DOWN, CLICK_RELEASE, t),
        routeT: 0,
        route: null,
        scale: lerp(0.4, 1, rise),
      };
    }
    case "transit": {
      // Human: Rides the upload arc from the hover point, breaking into blobs along the way.
      const routeT = smoothstep(0, 1, t);
      return {
        position: uploadPointAt(routeT, 0, slot),
        wholeness: 1 - smoothstep(SPLIT_START, SPLIT_END, t),
        opacity: 1,
        routeT,
        route: "upload",
        scale: 1,
      };
    }
    case "store": {
      // Human: The chunks are in the bay for the whole act — this is the processing beat.
      return {
        position: slotPoint(slot),
        wholeness: 0,
        opacity: 1 - smoothstep(0.1, 0.3, t),
        routeT: 1,
        route: "upload",
        scale: 1,
      };
    }
    case "retrieve": {
      // Human: Blobs leave the bay and pull back together into a whole file on the way home.
      const routeT = smoothstep(0, 1, t);
      return {
        position: accessPointAt(routeT, 0, slot),
        wholeness: smoothstep(MERGE_START, MERGE_END, t),
        opacity: smoothstep(0, 0.12, t),
        routeT,
        route: "access",
        scale: 1,
      };
    }
    case "display":
    default: {
      // Human: The file settles from the hover point onto the screen and becomes a tile again.
      const land = smoothstep(0.05, 0.62, t);
      return {
        position: lerpPoint(CLIENT_LIFT, tilePoint, land),
        wholeness: 1,
        opacity: 1 - smoothstep(0.55, 0.78, t),
        routeT: 0,
        route: null,
        scale: lerp(1, 0.42, land),
      };
    }
  }
}

/**
 * Human: How lit the laptop screen is right now — it wakes for the pick, shows transfer
 * progress, idles while the file is away, and flashes when the file lands back.
 */
export function clientEnergyAt(frame: StoryFrame): number {
  switch (frame.act) {
    case "capture":
      return smoothstep(0.1, 0.5, frame.t);
    case "transit":
      return 1 - smoothstep(0.5, 1, frame.t) * 0.65;
    case "store":
      return 0.35;
    case "retrieve":
      return 0.35 + smoothstep(0.6, 1, frame.t) * 0.4;
    case "display":
    default:
      return 1 - smoothstep(0.7, 1, frame.t) * 0.5;
  }
}

/** Human: Upload progress shown on the laptop screen, 0 until the transfer starts. */
export function transferProgressAt(frame: StoryFrame): number {
  if (frame.act === "capture") return 0;
  if (frame.act === "transit") return smoothstep(0, 0.95, frame.t);
  return 1;
}

/**
 * Human: How lit the server is — it spikes as the chunks land, stays bright through
 * processing, and spikes again when the file is read back out.
 */
export function storeEnergyAt(frame: StoryFrame): number {
  switch (frame.act) {
    case "transit":
      return smoothstep(0.75, 1, frame.t) * 0.6;
    case "store":
      return 0.6 + smoothstep(0, 0.2, frame.t) * 0.4;
    case "retrieve":
      return 1 - smoothstep(0.15, 0.6, frame.t) * 0.7;
    default:
      return 0.25;
  }
}

/**
 * Human: The processing sweep across the server during the `store` act — a scan line running
 * down the bays while the file is indexed, thumbnailed and checksummed.
 * Agent: RETURNS -1 when no sweep should be drawn.
 */
export function processSweepAt(frame: StoryFrame): number {
  if (frame.act !== "store") return -1;
  const window = smoothstep(0.15, 0.85, frame.t);
  if (window <= 0 || window >= 1) return -1;
  return window;
}

/** Human: Which bays hold older files, so the server never looks empty. */
export function ambientSlots(loop: number): number[] {
  const slots: number[] = [];
  for (let index = 0; index < STORE_SLOTS; index += 1) {
    // Human: A stable, uneven scatter that shifts slowly from loop to loop.
    if ((index * 7 + loop * 2) % 3 === 0) slots.push(index);
  }
  return slots;
}

/* ---- The click ---------------------------------------------------------- */

export type CursorState = {
  /** World position of the pointer tip, on the screen plane. */
  position: ScenePoint;
  /** 0 → 1 as the pointer presses down and releases. */
  press: number;
  /** 0 → 1 expanding click ripple; 0 when no ripple is playing. */
  ripple: number;
  /** Overall visibility — the pointer only exists during the pick. */
  opacity: number;
};

/** Human: Where the pointer waits before it goes for the file. */
function cursorRestPoint(): ScenePoint {
  return {
    x: CLIENT_CENTER.x + 0.28,
    y: CLIENT_CENTER.y + 0.22,
    z: CLIENT_CENTER.z - 0.09,
  };
}

/*
 * Human: The pointer travels to the file, presses it, and the press is what sends it on its way.
 * Without this the file just floated off on its own and nothing explained why.
 */
export function cursorStateAt(frame: StoryFrame): CursorState {
  if (frame.act !== "capture") {
    return { position: cursorRestPoint(), press: 0, ripple: 0, opacity: 0 };
  }

  const { t, tile } = frame;
  const target = clientTilePoint(tile);
  const rest = cursorRestPoint();
  // Human: Ease all the way in so the pointer settles onto the file rather than arriving flat.
  const travel = smoothstep(0.04, CURSOR_ARRIVE, t);
  const position = lerpPoint(rest, { ...target, z: target.z - 0.02 }, travel);

  // Press down, hold briefly, release.
  const press =
    smoothstep(CURSOR_ARRIVE, CLICK_DOWN, t) * (1 - smoothstep(CLICK_DOWN + 0.04, CLICK_RELEASE, t));
  const ripple = smoothstep(CLICK_DOWN, CLICK_DOWN + 0.16, t);

  return {
    position,
    press,
    ripple: ripple >= 1 ? 0 : ripple,
    // Human: The pointer fades once the file is on its way — it has done its job.
    opacity: smoothstep(0, 0.06, t) * (1 - smoothstep(CLICK_RELEASE, CLICK_RELEASE + 0.18, t)),
  };
}

/** Human: Is the file still shown as a tile on screen, or has it been picked up? */
export function heroTileOnScreen(frame: StoryFrame): boolean {
  if (frame.act === "capture") return frame.t < CLICK_RELEASE;
  if (frame.act === "display") return frame.t > 0.55;
  return false;
}

/** Human: Is the pointer hovering or holding the file's tile right now? */
export function heroTileSelected(frame: StoryFrame): number {
  if (frame.act !== "capture") return 0;
  return smoothstep(CURSOR_ARRIVE - 0.08, CURSOR_ARRIVE, frame.t);
}

/* ---- Breaking apart ----------------------------------------------------- */

/**
 * Human: A one-off flash at the moment the card bursts into blobs, and again when they
 * snap back together. Returns 0 outside those moments.
 */
export function burstAt(frame: StoryFrame): number {
  if (frame.act === "transit") {
    const window = (frame.t - SPLIT_START) / (SPLIT_END - SPLIT_START);
    if (window < 0 || window > 1) return 0;
    return Math.sin(Math.PI * window);
  }
  if (frame.act === "retrieve") {
    const window = (frame.t - MERGE_START) / (MERGE_END - MERGE_START);
    if (window < 0 || window > 1) return 0;
    return Math.sin(Math.PI * window);
  }
  return 0;
}

/**
 * Human: How far apart the blobs have pulled, 0 (still one card) → 1 (a spread-out stream).
 * Agent: Drives both the spacing along the route and the sideways scatter as they separate.
 */
export function blobSpreadAt(frame: StoryFrame): number {
  if (frame.act === "transit") return smoothstep(SPLIT_START, SPLIT_END + 0.08, frame.t);
  if (frame.act === "store") return 1;
  if (frame.act === "retrieve") return 1 - smoothstep(MERGE_START - 0.1, MERGE_END, frame.t);
  return 0;
}
