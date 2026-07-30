// Human: The objects in the auth background scene — the client device, the storage bays, the routes between them.
// Agent: PURE geometry + palette. auth-scene-story.ts scripts the action; AuthSceneBackground draws it.

import { bezierPoint, type ScenePoint } from "@/lib/auth-scene-3d";

/** Human: The file types Ownly actually stores — each gets its own accent and glyph. */
export type FileKind = "image" | "video" | "doc" | "sheet" | "code";

export const FILE_KINDS: FileKind[] = ["image", "video", "doc", "sheet", "code"];

/** Human: Storage slots drawn as a stack of bays — the "drive" the whole scene revolves around. */
export const STORE_SLOTS = 7;
/** Human: Depth of the storage enclosure — what gives it a visible side face. */
export const STORE_DEPTH = 0.42;

/* ---- Path geometry ------------------------------------------------------ */
/*
 * Human: The scene is a round trip between two objects you can actually recognise:
 * your device on the left, your storage in the middle. Files ride the upper arc to get
 * stored and the lower arc to come back — two visibly separate routes, like a circuit.
 * Agent: Both arcs start and end on CLIENT_CENTER / the store, so the loop always closes.
 */
export const CLIENT_CENTER: ScenePoint = { x: -1.55, y: 0.86, z: 0.7 };
export const STORE_CENTER: ScenePoint = { x: 0.36, y: 0.02, z: 1.1 };
/** Human: Upload route — bows up and over. */
export const PATH_UPLOAD_CONTROL: ScenePoint = { x: -0.6, y: -0.3, z: 0.82 };
/** Human: Read-back route — bows down and under, so the two directions never overlap. */
export const PATH_ACCESS_CONTROL: ScenePoint = { x: -0.5, y: 1.3, z: 0.8 };

/*
 * Human: Where a picked file hovers just above the laptop. Both routes start and end here,
 * so the file never has to double back to the machine before setting off.
 */
export const CLIENT_LIFT: ScenePoint = {
  x: CLIENT_CENTER.x + 0.14,
  y: CLIENT_CENTER.y - 0.52,
  z: CLIENT_CENTER.z - 0.08,
};

/** Human: Size of the client device — screen box plus the base it sits on. */
export const CLIENT_SCREEN_WIDTH = 0.52;
export const CLIENT_SCREEN_HEIGHT = 0.34;


/** Human: How the laptop screen is tiled — a small file grid, like the drive itself. */
export const CLIENT_TILE_COLUMNS = 4;
export const CLIENT_TILE_ROWS = 3;
export const CLIENT_TILE_COUNT = CLIENT_TILE_COLUMNS * CLIENT_TILE_ROWS;

// Human: World position of one tile on the laptop screen — where a file departs from and lands back on.
// Agent: Sits a hair in front of the screen plane so it never z-fights with the bezel.
export function clientTilePoint(tile: number): ScenePoint {
  const index = ((tile % CLIENT_TILE_COUNT) + CLIENT_TILE_COUNT) % CLIENT_TILE_COUNT;
  const column = index % CLIENT_TILE_COLUMNS;
  const row = Math.floor(index / CLIENT_TILE_COLUMNS);
  const usableWidth = CLIENT_SCREEN_WIDTH * 0.76;
  const usableHeight = CLIENT_SCREEN_HEIGHT * 0.7;
  const stepX = usableWidth / CLIENT_TILE_COLUMNS;
  const stepY = usableHeight / CLIENT_TILE_ROWS;
  return {
    x: CLIENT_CENTER.x - usableWidth / 2 + stepX * (column + 0.5),
    y: CLIENT_CENTER.y - usableHeight / 2 + stepY * (row + 0.5),
    z: CLIENT_CENTER.z - 0.03,
  };
}

/** Human: Vertical pitch between storage slots, in world units. */
export const SLOT_PITCH = 0.108;
/** Human: Half-width of a slot bay. */
export const SLOT_HALF_WIDTH = 0.23;
export const SLOT_HEIGHT = 0.05;

/*
 * Human: Lane spread — widest mid-flight, exactly zero at both ends.
 * Agent: 4t(1-t) rather than sin(pi*t): sin leaves ~1e-16 at t=1, which would land a
 * transfer just off its slot instead of exactly on it.
 */
function laneTaper(t: number): number {
  return 4 * t * (1 - t);
}

// Human: Where a storage slot sits in the world.
// Agent: Slot 0 is the top bay; the stack is centred on STORE_CENTER.
export function slotPoint(slot: number): ScenePoint {
  const offset = (slot - (STORE_SLOTS - 1) / 2) * SLOT_PITCH;
  return { x: STORE_CENTER.x, y: STORE_CENTER.y + offset, z: STORE_CENTER.z };
}

// Human: Point along the inbound (upload) path, fanned out by lane in the middle of the run.
// Agent: The lane offset tapers to zero at both ends so transfers converge exactly on their slot.
export function uploadPointAt(t: number, lane: number, slot: number): ScenePoint {
  const target = slotPoint(slot);
  const base = bezierPoint(CLIENT_LIFT, PATH_UPLOAD_CONTROL, target, t);
  const spread = laneTaper(t);
  return {
    x: base.x + lane * 0.07 * spread,
    y: base.y + lane * 0.12 * spread,
    z: base.z + lane * 0.1 * spread,
  };
}

// Human: Point along the read-back path — out of the slot and home to the device that asked for it.
export function accessPointAt(t: number, lane: number, slot: number): ScenePoint {
  const source = slotPoint(slot);
  const base = bezierPoint(source, PATH_ACCESS_CONTROL, CLIENT_LIFT, t);
  const spread = laneTaper(t);
  return {
    x: base.x + lane * 0.06 * spread,
    y: base.y + lane * 0.1 * spread,
    z: base.z + lane * 0.08 * spread,
  };
}

/* ---- Palette ------------------------------------------------------------ */

export type ScenePalette = {
  /** Card face and its edge — the "paper" every file is drawn on. */
  card: string;
  cardEdge: string;
  /** Text/metadata lines inside a card. */
  cardInk: string;
  /** Chunk blocks between the card and the store. */
  chunk: string;
  /** The client device: body, screen, and the tiles shown on it. */
  device: string;
  deviceScreen: string;
  deviceEdge: string;
  /** The storage enclosure: lit front face, shaded side face, and its edges. */
  store: string;
  storeSide: string;
  storeEdge: string;
  /** Lit bay + the glow it throws. */
  slot: string;
  /** The faint rail the transfers follow. */
  rail: string;
  /** Captions naming the two ends of the scene. */
  label: string;
  /** The mouse pointer that picks the file. */
  cursor: string;
  cursorEdge: string;
  /** Accent per file kind, keyed in FILE_KINDS order. */
  kinds: Record<FileKind, string>;
  /** Canvas composite for glow — dark scenes add light, light scenes paint normally. */
  composite: GlobalCompositeOperation;
  /** Global opacity so the form always wins the contrast fight. */
  opacity: number;
};

export const AUTH_SCENE_PALETTES: Record<"light" | "dark", ScenePalette> = {
  light: {
    card: "#ffffff",
    cardEdge: "#c3d0e8",
    cardInk: "#9fb0cd",
    chunk: "#5b8def",
    device: "#ccd8ef",
    deviceScreen: "#f9fbff",
    deviceEdge: "#7690c2",
    store: "#d8e1f4",
    storeSide: "#b2c4e6",
    storeEdge: "#7690c2",
    slot: "#2563eb",
    rail: "#7d95c4",
    label: "#7c8fb5",
    cursor: "#ffffff",
    cursorEdge: "#41527a",
    kinds: {
      image: "#0e9f6e",
      video: "#7c3aed",
      doc: "#2563eb",
      sheet: "#0891b2",
      code: "#d97706",
    },
    composite: "source-over",
    opacity: 0.85,
  },
  dark: {
    card: "#161d2e",
    cardEdge: "#3a4a6b",
    cardInk: "#5b6c8f",
    chunk: "#6ba1ff",
    device: "#212c44",
    deviceScreen: "#0d1524",
    deviceEdge: "#3a4a6b",
    store: "#1b2438",
    storeSide: "#0d1424",
    storeEdge: "#31456d",
    slot: "#4c8dff",
    rail: "#31456d",
    label: "#5a6c91",
    cursor: "#e8eefc",
    cursorEdge: "#0b1120",
    kinds: {
      image: "#34d399",
      video: "#a78bfa",
      doc: "#6ba1ff",
      sheet: "#22d3ee",
      code: "#fbbf24",
    },
    composite: "source-over",
    opacity: 0.88,
  },
};
