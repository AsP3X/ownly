// Human: Auth backdrop — the data lifecycle as a scene: files arrive, split into chunks, land in storage, and get read back.
// Agent: Canvas 2D over the projection maths in lib/auth-scene-3d + the simulation in lib/auth-scene-pipeline. No deps, no WebGL.

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import {
  bezierPoint,
  projectPoint,
  smoothstep,
  withAlpha,
  type ProjectedPoint,
  type SceneCamera,
  type ScenePoint,
  type SceneViewport,
} from "@/lib/auth-scene-3d";
import {
  AUTH_SCENE_PALETTES,
  accessPointAt,
  CLIENT_CENTER,
  CLIENT_LIFT,
  CLIENT_DECK_THICKNESS,
  CLIENT_GRID_BOTTOM,
  CLIENT_GRID_LEFT,
  CLIENT_GRID_RIGHT,
  CLIENT_GRID_TOP,
  CLIENT_SCREEN_HEIGHT,
  CLIENT_SCREEN_WIDTH,
  CLIENT_SURFACE_LIFT,
  CLIENT_TILE_COLUMNS,
  CLIENT_TILE_COUNT,
  CLIENT_TILE_ROWS,
  clientDeckPoint,
  clientScreenPoint,
  FILE_KINDS,
  PATH_ACCESS_CONTROL,
  PATH_UPLOAD_CONTROL,
  SLOT_HALF_WIDTH,
  SLOT_PITCH,
  INTERIOR_LANES,
  INTERIOR_MANIFEST_ROWS,
  INTERIOR_STAGE_X,
  interiorLaneX,
  interiorManifestSpan,
  interiorPanelRect,
  interiorRowHalfHeight,
  interiorRowY,
  slotFaceSpan,
  STORE_CENTER,
  STORE_DEPTH,
  STORE_SLOTS,
  storeFacePoint,
  uploadPointAt,
  type FileKind,
  type ScenePalette,
} from "@/lib/auth-scene-pipeline";
import {
  ambientSlots,
  blobSpreadAt,
  burstAt,
  clientEnergyAt,
  cursorStateAt,
  heroStateAt,
  heroTileOnScreen,
  heroTileSelected,
  interiorCaptionAt,
  interiorOpacityAt,
  interiorShardProgress,
  interiorStageAt,
  processSweepAt,
  storeShellOpacityAt,
  storeEnergyAt,
  storyAt,
  transferProgressAt,
  type StoryFrame,
} from "@/lib/auth-scene-story";
import "./auth-scene-background.css";

export type AuthSceneBackgroundProps = {
  className?: string;
};

/** Human: Focal length — the director supplies distance and framing per shot. */
const CAMERA_FOCAL = 1.9;
/** Human: Cap device pixel ratio; past 2 the extra fill rate buys nothing on a soft backdrop. */
const MAX_DPR = 2;
/*
 * Human: Below this width the sign-in card covers the frame, so the scene would burn battery
 * animating something nobody can see. Phones get the static gradient backdrop only.
 * Agent: Matches Tailwind's `md`; the canvas is not even mounted under it.
 */
const SCENE_MIN_WIDTH = "(min-width: 768px)";
/*
 * Human: The moment the still frame shows under reduced motion — mid-ingest, inside the server,
 * which is the single most informative frame in the loop.
 */
const STORY_STILL_TIME = 20;

/** Human: World size of a file card (a landscape tile, like a thumbnail in the drive). */
const CARD_WIDTH = 0.2;
const CARD_HEIGHT = 0.15;
const CHUNK_SIZE = 0.05;
/** Human: How many pieces a file is split into while it is in transit. */
const CHUNK_COUNT = 4;

type Drawable = { depth: number; draw: () => void };

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

// Human: The little mark that says what kind of file this is — a photo, a clip, a page, a sheet, some code.
// Agent: Drawn inside the card's accent chip; sizes are relative to the chip so it scales with depth.
function drawKindGlyph(
  context: CanvasRenderingContext2D,
  kind: FileKind,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  if (size < 3) return;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(0.6, size * 0.11);
  context.lineJoin = "round";

  const cx = x + size / 2;
  const cy = y + size / 2;

  switch (kind) {
    case "image": {
      // Horizon + sun.
      context.beginPath();
      context.moveTo(x + size * 0.12, y + size * 0.74);
      context.lineTo(x + size * 0.4, y + size * 0.42);
      context.lineTo(x + size * 0.62, y + size * 0.66);
      context.lineTo(x + size * 0.76, y + size * 0.54);
      context.lineTo(x + size * 0.88, y + size * 0.74);
      context.stroke();
      context.beginPath();
      context.arc(x + size * 0.71, y + size * 0.28, size * 0.1, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case "video": {
      // Play triangle.
      context.beginPath();
      context.moveTo(x + size * 0.34, y + size * 0.22);
      context.lineTo(x + size * 0.34, y + size * 0.78);
      context.lineTo(x + size * 0.78, y + size * 0.5);
      context.closePath();
      context.fill();
      break;
    }
    case "doc": {
      // Three text lines.
      for (let line = 0; line < 3; line += 1) {
        const lineY = y + size * (0.3 + line * 0.2);
        context.beginPath();
        context.moveTo(x + size * 0.22, lineY);
        context.lineTo(x + size * (line === 2 ? 0.6 : 0.78), lineY);
        context.stroke();
      }
      break;
    }
    case "sheet": {
      // 2×2 cells.
      context.strokeRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6);
      context.beginPath();
      context.moveTo(cx, y + size * 0.2);
      context.lineTo(cx, y + size * 0.8);
      context.moveTo(x + size * 0.2, cy);
      context.lineTo(x + size * 0.8, cy);
      context.stroke();
      break;
    }
    case "code": {
      // Angle brackets.
      context.beginPath();
      context.moveTo(x + size * 0.42, y + size * 0.26);
      context.lineTo(x + size * 0.2, y + size * 0.5);
      context.lineTo(x + size * 0.42, y + size * 0.74);
      context.moveTo(x + size * 0.6, y + size * 0.26);
      context.lineTo(x + size * 0.82, y + size * 0.5);
      context.lineTo(x + size * 0.6, y + size * 0.74);
      context.stroke();
      break;
    }
  }
}

// Human: One file, drawn as a card floating in space — accent chip, glyph, and two metadata lines.
function drawCard(
  context: CanvasRenderingContext2D,
  point: ProjectedPoint,
  unit: number,
  kind: FileKind,
  palette: ScenePalette,
  alpha: number,
) {
  const width = CARD_WIDTH * point.scale * unit;
  const height = CARD_HEIGHT * point.scale * unit;
  if (width < 4 || alpha <= 0.01) return;

  const x = point.sx - width / 2;
  const y = point.sy - height / 2;
  const accent = palette.kinds[kind];

  context.globalAlpha = alpha;
  context.shadowColor = withAlpha(accent, 0.22 * alpha);
  context.shadowBlur = width * 0.2;
  context.shadowOffsetY = height * 0.08;

  roundRect(context, x, y, width, height, width * 0.09);
  context.fillStyle = palette.card;
  context.fill();

  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;

  context.strokeStyle = withAlpha(palette.cardEdge, 0.9);
  context.lineWidth = Math.max(0.5, width * 0.012);
  context.stroke();

  // Accent chip + glyph.
  const chip = height * 0.42;
  const padding = width * 0.09;
  roundRect(context, x + padding, y + padding, chip, chip, chip * 0.28);
  context.fillStyle = withAlpha(accent, 0.16);
  context.fill();
  drawKindGlyph(context, kind, x + padding, y + padding, chip, accent);

  // Metadata lines.
  const lineX = x + padding + chip + width * 0.07;
  const lineWidth = width - (lineX - x) - padding;
  if (lineWidth > 2) {
    context.fillStyle = withAlpha(palette.cardInk, 0.85);
    const lineHeight = Math.max(0.8, height * 0.055);
    roundRect(context, lineX, y + padding + chip * 0.12, lineWidth, lineHeight, lineHeight / 2);
    context.fill();
    context.fillStyle = withAlpha(palette.cardInk, 0.5);
    roundRect(
      context,
      lineX,
      y + padding + chip * 0.12 + lineHeight * 2.4,
      lineWidth * 0.6,
      lineHeight,
      lineHeight / 2,
    );
    context.fill();
  }

  // Bottom progress hairline — the transfer bar every upload shows.
  const barY = y + height - padding * 0.9;
  const barWidth = width - padding * 2;
  context.fillStyle = withAlpha(accent, 0.55);
  roundRect(context, x + padding, barY, barWidth, Math.max(0.7, height * 0.035), height * 0.02);
  context.fill();
}

// Human: A single chunk of a file in flight between the card and its storage bay.
function drawChunk(
  context: CanvasRenderingContext2D,
  point: ProjectedPoint,
  unit: number,
  color: string,
  palette: ScenePalette,
  alpha: number,
) {
  const size = CHUNK_SIZE * point.scale * unit;
  if (size < 1 || alpha <= 0.01) return;

  context.globalAlpha = alpha;
  context.shadowColor = withAlpha(color, 0.6 * alpha);
  context.shadowBlur = size * 1.4;
  roundRect(context, point.sx - size / 2, point.sy - size / 2, size, size, size * 0.3);
  context.fillStyle = withAlpha(color, 0.85);
  context.fill();
  context.shadowBlur = 0;
  context.shadowColor = "transparent";

  context.strokeStyle = withAlpha(palette.card, 0.5);
  context.lineWidth = Math.max(0.4, size * 0.08);
  context.stroke();
}

export function AuthSceneBackground({ className }: AuthSceneBackgroundProps) {
  const { resolved } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Human: Theme lives in a ref so flipping light/dark repaints without restarting the story.
  const themeRef = useRef(resolved);
  // Human: Only wide viewports get the animated scene — see SCENE_MIN_WIDTH.
  const [sceneEnabled, setSceneEnabled] = useState(
    () => typeof window !== "undefined" && window.matchMedia(SCENE_MIN_WIDTH).matches,
  );

  useEffect(() => {
    themeRef.current = resolved;
  }, [resolved]);

  // Human: Rotating a tablet or resizing a window should start or stop the scene, not strand it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SCENE_MIN_WIDTH);
    const sync = (event: MediaQueryListEvent) => setSceneEnabled(event.matches);
    setSceneEnabled(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sceneEnabled) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const camera: SceneCamera = {
      yaw: 0,
      pitch: 0,
      distance: 3,
      focal: CAMERA_FOCAL,
      target: { x: 0, y: 0, z: 0 },
    };
    // Human: Pointer parallax target, eased each frame so the camera never snaps.
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

    let width = 0;
    let height = 0;
    let unit = 1;
    let frameId = 0;
    let startTime = 0;
    let running = true;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(point: ScenePoint, viewport: SceneViewport) {
      return projectPoint(point, camera, viewport);
    }

    /*
     * Human: Small caption under an object. The scene is doing something specific — naming the
     * two ends of it is what turns "abstract motion" into "this is your laptop and your server".
     */
    function drawLabel(
      lines: string[],
      anchor: ProjectedPoint,
      offsetY: number,
      palette: ScenePalette,
      alpha: number,
    ) {
      if (alpha <= 0.02) return;
      const size = Math.max(9, Math.min(14, unit * 0.023));
      context!.save();
      context!.fillStyle = palette.label;
      context!.textAlign = "center";
      context!.textBaseline = "middle";
      // Agent: letterSpacing is Chromium-only; assigning it elsewhere is a harmless no-op.
      context!.letterSpacing = `${(size * 0.14).toFixed(2)}px`;
      lines.forEach((line, index) => {
        // Human: The second line is the qualifier — quieter than the name above it.
        const lineSize = index === 0 ? size : size * 0.82;
        context!.font = `600 ${lineSize}px "Geist Variable", ui-sans-serif, system-ui, sans-serif`;
        context!.globalAlpha = alpha * palette.opacity * (index === 0 ? 1 : 0.7);
        context!.fillText(line, anchor.sx, anchor.sy + offsetY + index * size * 1.35);
      });
      context!.restore();
    }

    /*
     * Human: The route between device and server, dashed and crawling toward its destination
     * so the direction of travel is readable even between transfers.
     */
    function drawRail(
      from: ScenePoint,
      control: ScenePoint,
      to: ScenePoint,
      viewport: SceneViewport,
      palette: ScenePalette,
      elapsed: number,
      alpha: number,
    ) {
      if (alpha <= 0.02) return;
      const steps = 30;
      const points: ProjectedPoint[] = [];
      for (let step = 0; step <= steps; step += 1) {
        const point = project(bezierPoint(from, control, to, step / steps), viewport);
        if (point.depth <= 0.2) return;
        points.push(point);
      }

      const first = points[0];
      const last = points[points.length - 1];
      const gradient = context!.createLinearGradient(first.sx, first.sy, last.sx, last.sy);
      gradient.addColorStop(0, withAlpha(palette.rail, 0.08 * alpha * palette.opacity));
      gradient.addColorStop(0.5, withAlpha(palette.rail, 0.55 * alpha * palette.opacity));
      gradient.addColorStop(1, withAlpha(palette.rail, 0.08 * alpha * palette.opacity));

      context!.save();
      context!.globalAlpha = 1;
      context!.strokeStyle = gradient;
      context!.lineWidth = Math.max(1, unit * 0.0022);
      context!.setLineDash([unit * 0.012, unit * 0.022]);
      // Human: Negative offset walks the dashes from `from` toward `to`.
      context!.lineDashOffset = -elapsed * unit * 0.05;
      context!.beginPath();
      context!.moveTo(first.sx, first.sy);
      for (let index = 1; index < points.length; index += 1) {
        context!.lineTo(points[index].sx, points[index].sy);
      }
      context!.stroke();
      context!.restore();
    }

    /*
     * Human: A house drawn around the server — the whole point of the product is that this
     * machine is yours, standing somewhere you control rather than in someone else's data centre.
     */
    function drawHouse(viewport: SceneViewport, palette: ScenePalette, alpha: number) {
      if (alpha <= 0.02) return;
      const halfWidth = 0.66;
      const eaves = -0.3;
      const apex = -0.62;
      const floor = 0.46;
      const z = STORE_CENTER.z + STORE_DEPTH / 2;

      const outline: ScenePoint[] = [
        { x: STORE_CENTER.x - halfWidth, y: STORE_CENTER.y + floor, z },
        { x: STORE_CENTER.x - halfWidth, y: STORE_CENTER.y + eaves, z },
        { x: STORE_CENTER.x, y: STORE_CENTER.y + apex, z },
        { x: STORE_CENTER.x + halfWidth, y: STORE_CENTER.y + eaves, z },
        { x: STORE_CENTER.x + halfWidth, y: STORE_CENTER.y + floor, z },
      ];

      const points = outline.map((point) => project(point, viewport));
      if (points.some((point) => point.depth <= 0.2)) return;

      context!.save();
      context!.globalAlpha = alpha * palette.opacity;
      context!.strokeStyle = palette.rail;
      context!.lineWidth = Math.max(1, unit * 0.0026);
      context!.setLineDash([unit * 0.02, unit * 0.014]);
      context!.beginPath();
      context!.moveTo(points[0].sx, points[0].sy);
      for (let index = 1; index < points.length; index += 1) {
        context!.lineTo(points[index].sx, points[index].sy);
      }
      context!.stroke();
      context!.restore();
    }

    /*
     * Human: The laptop — a screen of file tiles on a base. Files leave from here and land
     * back here, and the screen shows the transfer while it is happening.
     */
    function drawClient(viewport: SceneViewport, palette: ScenePalette, story: StoryFrame) {
      const center = project(CLIENT_CENTER, viewport);
      if (center.depth <= 0.2) return;

      const pixelsPerUnit = center.scale * unit;
      const screenWidth = CLIENT_SCREEN_WIDTH * pixelsPerUnit;
      const energy = clientEnergyAt(story);
      const bodyAlpha = Math.min(0.95, palette.opacity * 1.5);
      const hairline = Math.max(0.5, pixelsPerUnit * 0.004);

      /*
       * Human: Every part of the laptop is placed on one of its two real surfaces, so the whole
       * machine shares a single perspective. Drawing any of it as a screen-space rectangle is what
       * used to make the contents slide off the bezel whenever the camera yawed.
       */
      const screenPt = (u: number, v: number, lift = CLIENT_SURFACE_LIFT) =>
        project(clientScreenPoint(u, v, lift), viewport);
      const deckPt = (u: number, w: number, drop = 0) =>
        project(clientDeckPoint(u, w, drop), viewport);

      const fillPoly = (points: ProjectedPoint[], fill: string, alpha: number) => {
        context!.globalAlpha = alpha;
        context!.fillStyle = fill;
        context!.beginPath();
        points.forEach((point, index) => {
          if (index === 0) context!.moveTo(point.sx, point.sy);
          else context!.lineTo(point.sx, point.sy);
        });
        context!.closePath();
        context!.fill();
      };

      const strokePoly = (
        points: ProjectedPoint[],
        stroke: string,
        alpha: number,
        width: number,
      ) => {
        context!.globalAlpha = alpha;
        context!.strokeStyle = stroke;
        context!.lineWidth = width;
        context!.beginPath();
        points.forEach((point, index) => {
          if (index === 0) context!.moveTo(point.sx, point.sy);
          else context!.lineTo(point.sx, point.sy);
        });
        context!.closePath();
        context!.stroke();
      };

      /** Human: A rectangle in screen-face UV — u left→right, v hinge→top. */
      const screenQuad = (u0: number, v0: number, u1: number, v1: number, lift?: number) => [
        screenPt(u0, v1, lift),
        screenPt(u1, v1, lift),
        screenPt(u1, v0, lift),
        screenPt(u0, v0, lift),
      ];

      /** Human: A rectangle on the keyboard deck — u left→right, w hinge→front lip. */
      const deckQuad = (u0: number, w0: number, u1: number, w1: number, drop = 0) => [
        deckPt(u0, w0, drop),
        deckPt(u1, w0, drop),
        deckPt(u1, w1, drop),
        deckPt(u0, w1, drop),
      ];

      // Glow while the device is sending or receiving.
      if (energy > 0.02) {
        const glowRadius = screenWidth * 1.4;
        const glow = context!.createRadialGradient(
          center.sx,
          center.sy,
          0,
          center.sx,
          center.sy,
          glowRadius,
        );
        glow.addColorStop(0, withAlpha(palette.slot, 0.2 * energy * palette.opacity));
        glow.addColorStop(1, withAlpha(palette.slot, 0));
        context!.globalAlpha = 1;
        context!.fillStyle = glow;
        context!.beginPath();
        context!.arc(center.sx, center.sy, glowRadius, 0, Math.PI * 2);
        context!.fill();
      }

      /*
       * Human: Lid back — a sliver of the panel's reverse side behind the bezel. Without it the
       * screen reads as a floating pane rather than a lid attached to the deck.
       */
      fillPoly(
        screenQuad(-0.02, -0.015, 1.02, 1.015, -CLIENT_SURFACE_LIFT * 2),
        palette.deviceEdge,
        bodyAlpha * 0.55,
      );

      // Bezel.
      const bezel = screenQuad(0, 0, 1, 1, 0);
      fillPoly(bezel, palette.device, bodyAlpha);
      strokePoly(bezel, withAlpha(palette.deviceEdge, 0.9), bodyAlpha, hairline * 1.2);

      // Screen glass.
      const glassU0 = 0.035;
      const glassU1 = 0.965;
      const glassV0 = 0.06;
      const glassV1 = 0.94;
      fillPoly(
        screenQuad(glassU0, glassV0, glassU1, glassV1),
        palette.deviceScreen,
        bodyAlpha,
      );

      /*
       * Human: A believable app window rather than a bare grid — chrome dots, a sidebar and a
       * toolbar, so the close-up reads as "someone is using their drive" at a glance.
       * Agent: All of it is placed in screen UV, so it stays welded to the glass at any yaw.
       */
      const chromeV = glassV1 - (glassV1 - glassV0) * 0.13;
      const sidebarU = glassU0 + (glassU1 - glassU0) * 0.2;

      // Title bar with traffic-light dots.
      fillPoly(
        screenQuad(glassU0, chromeV, glassU1, glassV1),
        withAlpha(palette.device, 0.85),
        bodyAlpha * 0.9,
      );
      for (let dot = 0; dot < 3; dot += 1) {
        const dotU = glassU0 + (glassU1 - glassU0) * (0.035 + dot * 0.042);
        const dotV = (chromeV + glassV1) / 2;
        const half = (glassU1 - glassU0) * 0.013;
        fillPoly(
          screenQuad(dotU - half, dotV - half * 1.5, dotU + half, dotV + half * 1.5),
          palette.deviceEdge,
          bodyAlpha * 0.55,
        );
      }

      // Sidebar with a few nav rows.
      fillPoly(
        screenQuad(glassU0, glassV0, sidebarU, chromeV),
        withAlpha(palette.device, 0.6),
        bodyAlpha * 0.55,
      );
      for (let row = 0; row < 4; row += 1) {
        const rowV = chromeV - (chromeV - glassV0) * (0.13 + row * 0.17);
        const rowHeight = (chromeV - glassV0) * 0.06;
        const rowWidth = (sidebarU - glassU0) * (row === 3 ? 0.5 : 0.68);
        fillPoly(
          screenQuad(
            glassU0 + (sidebarU - glassU0) * 0.16,
            rowV - rowHeight,
            glassU0 + (sidebarU - glassU0) * 0.16 + rowWidth,
            rowV + rowHeight,
          ),
          row === 1 ? palette.slot : palette.deviceEdge,
          bodyAlpha * (row === 1 ? 0.8 : 0.35),
        );
      }

      // Human: The file grid — the drive, as the user sees it. Laid out in screen UV like the chrome.
      const onScreen = heroTileOnScreen(story);
      const selection = heroTileSelected(story);
      const stepU = (CLIENT_GRID_RIGHT - CLIENT_GRID_LEFT) / CLIENT_TILE_COLUMNS;
      const stepV = (CLIENT_GRID_TOP - CLIENT_GRID_BOTTOM) / CLIENT_TILE_ROWS;
      const tileHalfU = stepU * 0.4;
      const tileHalfV = stepV * 0.38;

      for (let index = 0; index < CLIENT_TILE_COUNT; index += 1) {
        const column = index % CLIENT_TILE_COLUMNS;
        const row = Math.floor(index / CLIENT_TILE_COLUMNS);
        const centerU = CLIENT_GRID_LEFT + stepU * (column + 0.5);
        const centerV = CLIENT_GRID_TOP - stepV * (row + 0.5);
        const isHeroTile = index === story.tile % CLIENT_TILE_COUNT;
        const kind = isHeroTile ? story.kind : FILE_KINDS[index % FILE_KINDS.length];
        const accent = palette.kinds[kind];
        const lift = CLIENT_SURFACE_LIFT * 2;

        if (isHeroTile && !onScreen) {
          // Human: The file is away — its place in the grid waits for it, outlined.
          const slotQuad = screenQuad(
            centerU - tileHalfU,
            centerV - tileHalfV,
            centerU + tileHalfU,
            centerV + tileHalfV,
            lift,
          );
          context!.setLineDash([screenWidth * 0.02, screenWidth * 0.016]);
          strokePoly(
            slotQuad,
            withAlpha(accent, 0.55),
            bodyAlpha * 0.5,
            Math.max(0.6, screenWidth * 0.006),
          );
          context!.setLineDash([]);
          continue;
        }

        // Thumbnail block — the coloured part of the tile.
        fillPoly(
          screenQuad(
            centerU - tileHalfU,
            centerV - tileHalfV * 0.42,
            centerU + tileHalfU,
            centerV + tileHalfV,
            lift,
          ),
          withAlpha(accent, isHeroTile ? 0.75 : 0.4),
          bodyAlpha * (isHeroTile ? 0.95 : 0.7),
        );

        // Human: Glyph is a small raster mark — centred on the projected tile, sized from its span.
        const glyphCenter = screenPt(centerU, centerV + tileHalfV * 0.28, lift);
        const glyphEdge = screenPt(centerU + tileHalfU, centerV + tileHalfV * 0.28, lift);
        const glyphSize = Math.abs(glyphEdge.sx - glyphCenter.sx) * 0.8;
        if (glyphSize > 1.2) {
          drawKindGlyph(
            context!,
            kind,
            glyphCenter.sx - glyphSize / 2,
            glyphCenter.sy - glyphSize / 2,
            glyphSize,
            palette.deviceScreen,
          );
        }

        // Filename line under it.
        fillPoly(
          screenQuad(
            centerU - tileHalfU * 0.8,
            centerV - tileHalfV * 0.86,
            centerU + tileHalfU * 0.8,
            centerV - tileHalfV * 0.64,
            lift,
          ),
          palette.deviceEdge,
          bodyAlpha * 0.45,
        );

        // Human: Selection ring — the pointer has this file under it.
        if (isHeroTile && selection > 0.01) {
          const growU = tileHalfU * 0.18 * selection;
          const growV = tileHalfV * 0.18 * selection;
          strokePoly(
            screenQuad(
              centerU - tileHalfU - growU,
              centerV - tileHalfV - growV,
              centerU + tileHalfU + growU,
              centerV + tileHalfV + growV,
              lift * 1.5,
            ),
            palette.slot,
            bodyAlpha * selection,
            Math.max(0.8, screenWidth * 0.008),
          );
        }
      }

      // Human: Transfer bar along the bottom of the screen while the upload is in flight.
      const progress = transferProgressAt(story);
      if (progress > 0.001 && progress < 0.999) {
        const barLeft = sidebarU + (glassU1 - sidebarU) * 0.15;
        const barRight = glassU1 - (glassU1 - sidebarU) * 0.15;
        const barV = glassV0 + (chromeV - glassV0) * 0.07;
        const barHalfV = (chromeV - glassV0) * 0.022;
        fillPoly(
          screenQuad(barLeft, barV - barHalfV, barRight, barV + barHalfV, CLIENT_SURFACE_LIFT * 2),
          withAlpha(palette.deviceEdge, 0.5),
          bodyAlpha * 0.6,
        );
        fillPoly(
          screenQuad(
            barLeft,
            barV - barHalfV,
            barLeft + (barRight - barLeft) * progress,
            barV + barHalfV,
            CLIENT_SURFACE_LIFT * 2.5,
          ),
          palette.kinds[story.kind],
          bodyAlpha,
        );
      }

      /*
       * Human: The deck — a real keyboard base receding toward the viewer, with keys, a trackpad
       * and a front lip. This is what makes the object read as a laptop rather than a framed panel.
       */
      const deckTop = deckQuad(0, 0, 1, 1);
      fillPoly(deckTop, palette.device, bodyAlpha);
      strokePoly(deckTop, withAlpha(palette.deviceEdge, 0.7), bodyAlpha, hairline);

      // Hinge bar across the back of the deck.
      fillPoly(deckQuad(0.06, 0.0, 0.94, 0.07), withAlpha(palette.deviceEdge, 0.55), bodyAlpha * 0.8);

      // Keyboard — a proper key grid, inset from the deck edges.
      const keyRows = 4;
      const keyColumns = 12;
      const keyTop = 0.16;
      const keyBottom = 0.62;
      const keyLeft = 0.08;
      const keyRight = 0.92;
      const keyStepU = (keyRight - keyLeft) / keyColumns;
      const keyStepW = (keyBottom - keyTop) / keyRows;
      for (let row = 0; row < keyRows; row += 1) {
        for (let column = 0; column < keyColumns; column += 1) {
          const u0 = keyLeft + keyStepU * (column + 0.12);
          const u1 = keyLeft + keyStepU * (column + 0.88);
          const w0 = keyTop + keyStepW * (row + 0.16);
          const w1 = keyTop + keyStepW * (row + 0.84);
          fillPoly(
            deckQuad(u0, w0, u1, w1),
            palette.deviceScreen,
            bodyAlpha * 0.42,
          );
        }
      }
      // Space bar.
      fillPoly(
        deckQuad(0.34, keyBottom + keyStepW * 0.12, 0.66, keyBottom + keyStepW * 0.72),
        palette.deviceScreen,
        bodyAlpha * 0.42,
      );

      // Trackpad.
      const trackpad = deckQuad(0.37, 0.74, 0.63, 0.95);
      fillPoly(trackpad, palette.deviceScreen, bodyAlpha * 0.3);
      strokePoly(trackpad, withAlpha(palette.deviceEdge, 0.6), bodyAlpha * 0.7, hairline);

      /*
       * Human: Front lip — the deck's thickness, seen edge-on. Also the nearest surface, so it is
       * painted last.
       * Agent: Quad between the deck's front edge and the same edge dropped by the deck thickness.
       */
      fillPoly(
        [
          deckPt(0, 1, 0),
          deckPt(1, 1, 0),
          deckPt(1, 1, CLIENT_DECK_THICKNESS),
          deckPt(0, 1, CLIENT_DECK_THICKNESS),
        ],
        palette.deviceEdge,
        bodyAlpha * 0.9,
      );
    }

    /*
     * Human: The mouse pointer that actually picks the file. A click ripple and a press dip
     * make the pick read as a deliberate action rather than the file drifting off by itself.
     */
    function drawCursor(viewport: SceneViewport, palette: ScenePalette, story: StoryFrame) {
      const cursor = cursorStateAt(story);
      if (cursor.opacity <= 0.02) return;
      const point = project(cursor.position, viewport);
      if (point.depth <= 0.2) return;

      const size = 0.05 * point.scale * unit;
      const press = 1 - cursor.press * 0.18;

      // Click ripple.
      if (cursor.ripple > 0.001) {
        const radius = size * (0.25 + cursor.ripple * 1.3);
        context!.globalAlpha = cursor.opacity * (1 - cursor.ripple) * 0.6;
        context!.strokeStyle = palette.slot;
        context!.lineWidth = Math.max(0.8, size * 0.12);
        context!.beginPath();
        context!.arc(point.sx, point.sy, radius, 0, Math.PI * 2);
        context!.stroke();
      }

      // Arrow.
      context!.save();
      context!.globalAlpha = cursor.opacity;
      context!.translate(point.sx, point.sy);
      context!.scale(press, press);
      context!.beginPath();
      context!.moveTo(0, 0);
      context!.lineTo(0, size * 1.35);
      context!.lineTo(size * 0.36, size * 1.02);
      context!.lineTo(size * 0.62, size * 1.55);
      context!.lineTo(size * 0.82, size * 1.44);
      context!.lineTo(size * 0.56, size * 0.92);
      context!.lineTo(size * 0.98, size * 0.86);
      context!.closePath();
      context!.fillStyle = palette.cursor;
      context!.fill();
      context!.strokeStyle = palette.cursorEdge;
      context!.lineWidth = Math.max(0.5, size * 0.08);
      context!.stroke();
      context!.restore();
    }

    /*
     * Human: The server — an enclosure of drive bays. Bays hold older files; the hero file's bay
     * lights as it lands, and a scan line sweeps the unit while the upload is processed.
     */
    function drawStore(viewport: SceneViewport, palette: ScenePalette, story: StoryFrame) {
      const center = project(STORE_CENTER, viewport);
      if (center.depth <= 0.2) return;

      const pixelsPerUnit = center.scale * unit;
      const halfWidth = SLOT_HALF_WIDTH + 0.045;
      const halfHeight = (STORE_SLOTS * SLOT_PITCH) / 2 + 0.04;
      const energy = storeEnergyAt(story);
      /*
       * Human: The shell cross-fades out as the camera crosses into the enclosure, and back in as
       * it leaves. drawStoreInterior takes over across the same window.
       */
      const shell = storeShellOpacityAt(story);
      if (shell <= 0.01) return;
      const bodyAlpha = Math.min(0.95, palette.opacity * 1.5) * shell;

      // Light pool — the server is the one thing in the scene lit from within.
      const poolRadius = halfWidth * 5 * pixelsPerUnit;
      const pool = context!.createRadialGradient(
        center.sx,
        center.sy,
        0,
        center.sx,
        center.sy,
        poolRadius,
      );
      pool.addColorStop(0, withAlpha(palette.slot, (0.1 + energy * 0.12) * palette.opacity));
      pool.addColorStop(1, withAlpha(palette.slot, 0));
      context!.globalAlpha = 1;
      context!.fillStyle = pool;
      context!.beginPath();
      context!.arc(center.sx, center.sy, poolRadius, 0, Math.PI * 2);
      context!.fill();

      /*
       * Human: The enclosure is a real slab — a front face plus the side and top the camera
       * can see past it. That thickness is what stops it reading as a flat UI panel.
       */
      const corner = (dx: number, dy: number, dz: number) =>
        project(
          {
            x: STORE_CENTER.x + dx * halfWidth,
            y: STORE_CENTER.y + dy * halfHeight,
            z: STORE_CENTER.z + dz * (STORE_DEPTH / 2),
          },
          viewport,
        );

      const frontTopLeft = corner(-1, -1, -1);
      const frontTopRight = corner(1, -1, -1);
      const frontBottomRight = corner(1, 1, -1);
      const frontBottomLeft = corner(-1, 1, -1);
      const backTopLeft = corner(-1, -1, 1);
      const backTopRight = corner(1, -1, 1);
      const backBottomRight = corner(1, 1, 1);
      const backBottomLeft = corner(-1, 1, 1);

      const quad = (
        a: ProjectedPoint,
        b: ProjectedPoint,
        c: ProjectedPoint,
        d: ProjectedPoint,
        fill: string,
        alpha: number,
      ) => {
        context!.globalAlpha = alpha;
        context!.fillStyle = fill;
        context!.beginPath();
        context!.moveTo(a.sx, a.sy);
        context!.lineTo(b.sx, b.sy);
        context!.lineTo(c.sx, c.sy);
        context!.lineTo(d.sx, d.sy);
        context!.closePath();
        context!.fill();
      };

      quad(frontTopLeft, backTopLeft, backBottomLeft, frontBottomLeft, palette.storeSide, bodyAlpha);
      quad(
        frontTopRight,
        backTopRight,
        backBottomRight,
        frontBottomRight,
        palette.storeSide,
        bodyAlpha,
      );
      quad(frontTopLeft, backTopLeft, backTopRight, frontTopRight, palette.storeSide, bodyAlpha);
      quad(
        frontBottomLeft,
        backBottomLeft,
        backBottomRight,
        frontBottomRight,
        palette.storeSide,
        bodyAlpha * 0.85,
      );
      quad(
        frontTopLeft,
        frontTopRight,
        frontBottomRight,
        frontBottomLeft,
        palette.store,
        bodyAlpha,
      );
      context!.strokeStyle = withAlpha(palette.storeEdge, 0.85);
      context!.lineWidth = Math.max(0.6, pixelsPerUnit * 0.005);
      context!.stroke();

      const occupied = new Set(ambientSlots(story.loop));
      const heroStored =
        story.act === "dock" ||
        story.act === "ingest" ||
        story.act === "seal" ||
        (story.act === "transit" && story.t > 0.92) ||
        (story.act === "retrieve" && story.t < 0.12);
      if (heroStored) occupied.add(story.slot);

      /*
       * Human: Bays live on the chassis front face, placed the same way its corners are. They used
       * to be axis-aligned screen rectangles, which slid off the enclosure as the camera yawed.
       * Agent: facePoly takes face-UV corners; lift keeps a decal in front of the panel behind it.
       */
      const facePt = (u: number, v: number, lift = 0.004) =>
        project(storeFacePoint(u, v, lift), viewport);
      const faceQuad = (u0: number, v0: number, u1: number, v1: number, lift?: number) => [
        facePt(u0, v0, lift),
        facePt(u1, v0, lift),
        facePt(u1, v1, lift),
        facePt(u0, v1, lift),
      ];
      const facePoly = (points: ProjectedPoint[], fill: string, alpha: number) => {
        context!.globalAlpha = alpha;
        context!.fillStyle = fill;
        context!.beginPath();
        points.forEach((point, index) => {
          if (index === 0) context!.moveTo(point.sx, point.sy);
          else context!.lineTo(point.sx, point.sy);
        });
        context!.closePath();
        context!.fill();
      };

      // Human: Ventilation grille down each side of the bay stack — reads as real hardware.
      for (let vent = 0; vent < 16; vent += 1) {
        const v0 = 0.06 + vent * 0.056;
        const v1 = v0 + 0.028;
        if (v1 > 0.96) break;
        facePoly(faceQuad(0.022, v0, 0.055, v1), palette.storeSide, bodyAlpha * 0.5);
        facePoly(faceQuad(0.945, v0, 0.978, v1), palette.storeSide, bodyAlpha * 0.5);
      }

      const bayLeft = 0.085;
      const bayRight = 0.915;

      for (let slot = 0; slot < STORE_SLOTS; slot += 1) {
        const span = slotFaceSpan(slot);
        const bayHeight = span.bottom - span.top;
        const isHero = slot === story.slot;
        const filled = occupied.has(slot);
        const accent = isHero
          ? palette.kinds[story.kind]
          : palette.kinds[FILE_KINDS[slot % FILE_KINDS.length]];
        const slotEnergy = isHero && heroStored ? energy : filled ? 0.2 : 0;
        const bayPixelHeight = Math.abs(
          facePt(bayLeft, span.bottom).sy - facePt(bayLeft, span.top).sy,
        );

        // Bay body — a recessed caddy slot, dark whether or not anything lives in it.
        const bay = faceQuad(bayLeft, span.top, bayRight, span.bottom);
        facePoly(bay, palette.storeSide, bodyAlpha);
        context!.globalAlpha = bodyAlpha;
        context!.strokeStyle = withAlpha(palette.storeEdge, 0.55);
        context!.lineWidth = Math.max(0.4, bayPixelHeight * 0.05);
        context!.beginPath();
        bay.forEach((point, index) => {
          if (index === 0) context!.moveTo(point.sx, point.sy);
          else context!.lineTo(point.sx, point.sy);
        });
        context!.closePath();
        context!.stroke();

        if (filled) {
          // Caddy handle rail down the left of the bay, in the colour of what lives there.
          facePoly(
            faceQuad(
              bayLeft + 0.018,
              span.top + bayHeight * 0.2,
              bayLeft + 0.05,
              span.bottom - bayHeight * 0.2,
              0.008,
            ),
            withAlpha(accent, 0.55 + slotEnergy * 0.45),
            bodyAlpha,
          );

          // Drive face plate.
          facePoly(
            faceQuad(
              bayLeft + 0.075,
              span.top + bayHeight * 0.24,
              bayLeft + 0.5,
              span.bottom - bayHeight * 0.24,
              0.006,
            ),
            withAlpha(accent, 0.14 + slotEnergy * 0.3),
            bodyAlpha,
          );
        }

        if (slotEnergy > 0.24) {
          // The hero bay lights up as its file lands and while it is being processed.
          const pulse = (slotEnergy - 0.24) / 0.76;
          context!.save();
          context!.shadowColor = withAlpha(accent, 0.9);
          context!.shadowBlur = bayPixelHeight * 2.4;
          facePoly(
            faceQuad(bayLeft, span.top, bayRight, span.bottom, 0.01),
            withAlpha(accent, 0.5),
            bodyAlpha * pulse,
          );
          context!.restore();
        }

        // Drive activity LED, sitting on the right of the bay face.
        const blink = 0.35 + 0.65 * Math.abs(Math.sin(story.loop + slot * 1.7 + story.t * 9));
        const ledCenter = facePt(bayRight - 0.035, (span.top + span.bottom) / 2, 0.01);
        context!.globalAlpha = bodyAlpha * (filled ? blink : 0.14);
        context!.fillStyle = filled ? accent : palette.storeEdge;
        context!.beginPath();
        context!.arc(
          ledCenter.sx,
          ledCenter.sy,
          Math.max(0.5, bayPixelHeight * 0.15),
          0,
          Math.PI * 2,
        );
        context!.fill();
      }

      /*
       * Human: The processing pass — a scan line running down the bays while the freshly
       * stored file is indexed and thumbnailed. This is the "and then it is handled" beat.
       */
      const sweep = processSweepAt(story);
      if (sweep >= 0) {
        const topY = frontTopLeft.sy;
        const sweepY = topY + (frontBottomLeft.sy - topY) * sweep;
        const leftX = frontTopLeft.sx + (frontBottomLeft.sx - frontTopLeft.sx) * sweep;
        const rightX = frontTopRight.sx + (frontBottomRight.sx - frontTopRight.sx) * sweep;
        const fade = Math.sin(Math.PI * sweep);
        context!.save();
        context!.globalAlpha = bodyAlpha * fade;
        context!.strokeStyle = palette.kinds[story.kind];
        context!.shadowColor = withAlpha(palette.kinds[story.kind], 0.9);
        context!.shadowBlur = pixelsPerUnit * 0.06;
        context!.lineWidth = Math.max(1, pixelsPerUnit * 0.008);
        context!.beginPath();
        context!.moveTo(leftX, sweepY);
        context!.lineTo(rightX, sweepY);
        context!.stroke();
        context!.restore();
      }
    }

    /*
     * Human: What the server is doing, drawn as a flat schematic panel rather than a fake 3D room.
     * Chunks arrive on the left, are sealed at the gate, ride their lane to a drive, get checked,
     * then land in the manifest. Plain 2D means every edge is crisp and every row sits on one
     * shared grid — a perspective interior could never be either, and it fought the camera.
     * Agent: NO projection here. Coordinates come from the pure layout in auth-scene-pipeline and
     *        are mapped onto the pixel rect returned by interiorPanelRect().
     */
    function drawStoreInterior(
      viewport: SceneViewport,
      palette: ScenePalette,
      story: StoryFrame,
    ) {
      const presence = interiorOpacityAt(story);
      if (presence <= 0.01) return;

      const stage = interiorStageAt(story);
      const accent = palette.kinds[story.kind];
      const sealedColor = palette.slot;
      const verifiedColor = palette.verified;
      const alpha = Math.min(0.95, palette.opacity * 1.4) * presence;

      const panel = interiorPanelRect(viewport.width, viewport.height);
      // Human: Panel-space helpers — u and v run 0 to 1 inside the panel.
      const px = (u: number) => panel.x + panel.width * u;
      const py = (v: number) => panel.y + panel.height * v;
      const pw = (u: number) => panel.width * u;
      const ph = (v: number) => panel.height * v;

      const fill = (
        u0: number,
        v0: number,
        u1: number,
        v1: number,
        color: string,
        a: number,
        radius = 0.18,
      ) => {
        if (a <= 0.004) return;
        const w = pw(u1 - u0);
        const h = ph(v1 - v0);
        if (w <= 0.2 || h <= 0.2) return;
        context!.globalAlpha = a;
        context!.fillStyle = color;
        roundRect(context!, px(u0), py(v0), w, h, Math.min(w, h) * radius);
        context!.fill();
      };

      const rowHalf = interiorRowHalfHeight();
      const stackTop = interiorRowY(0) - rowHalf * 1.5;
      const stackBottom = interiorRowY(INTERIOR_LANES - 1) + rowHalf * 1.5;

      /* Panel shell */
      context!.globalAlpha = alpha * 0.92;
      context!.fillStyle = palette.card;
      roundRect(context!, panel.x, panel.y, panel.width, panel.height, panel.height * 0.07);
      context!.fill();
      context!.globalAlpha = alpha * 0.5;
      context!.strokeStyle = palette.cardEdge;
      context!.lineWidth = 1;
      context!.stroke();

      /* Heading */
      const headingSize = Math.max(8, Math.min(11, panel.height * 0.062));
      context!.save();
      context!.globalAlpha = alpha * 0.75;
      context!.fillStyle = palette.label;
      context!.textAlign = "left";
      context!.textBaseline = "middle";
      context!.letterSpacing = `${(headingSize * 0.16).toFixed(2)}px`;
      context!.font = `600 ${headingSize}px "Geist Variable", ui-sans-serif, system-ui, sans-serif`;
      context!.fillText("INSIDE YOUR SERVER", px(INTERIOR_STAGE_X.intake), py(0.155));

      /*
       * Human: The beat caption sits on the same line, right-aligned — it names what is happening
       * right now, which is what turns four moving bars into a process you can follow.
       * Agent: Fades per beat via interiorCaptionAt; drawn inside the panel so it can never clip.
       */
      const caption = interiorCaptionAt(story);
      if (caption && caption.alpha > 0.02) {
        context!.globalAlpha = alpha * caption.alpha;
        context!.fillStyle = accent;
        context!.textAlign = "right";
        context!.fillText(caption.text, px(INTERIOR_STAGE_X.manifestEnd), py(0.155));
      }
      context!.restore();

      /* Lane rails */
      for (let lane = 0; lane < INTERIOR_LANES; lane += 1) {
        const v = interiorRowY(lane);
        fill(
          INTERIOR_STAGE_X.laneStart,
          v - rowHalf * 0.1,
          INTERIOR_STAGE_X.laneEnd,
          v + rowHalf * 0.1,
          palette.cardInk,
          alpha * 0.38,
          0.5,
        );
      }

      /* Intake — chunks waiting in the file's own colour */
      const waiting = stage.arrive * (1 - stage.encrypt);
      for (let lane = 0; lane < INTERIOR_LANES; lane += 1) {
        const v = interiorRowY(lane);
        fill(
          INTERIOR_STAGE_X.intake,
          v - rowHalf,
          INTERIOR_STAGE_X.intakeEnd,
          v + rowHalf,
          accent,
          alpha * (0.16 + waiting * 0.66),
        );
      }

      /* Gate — a shutter closing across every lane as the chunks are sealed */
      const gateGlow = stage.encrypt * (1 - stage.sealed * 0.4);
      fill(
        INTERIOR_STAGE_X.gate,
        stackTop,
        INTERIOR_STAGE_X.gateEnd,
        stackBottom,
        palette.cardInk,
        alpha * 0.3,
        0.1,
      );
      if (gateGlow > 0.01) {
        const edge = stackTop + (stackBottom - stackTop) * gateGlow;
        fill(
          INTERIOR_STAGE_X.gate,
          stackTop,
          INTERIOR_STAGE_X.gateEnd,
          edge,
          sealedColor,
          alpha * 0.45,
          0.1,
        );
        context!.save();
        context!.shadowColor = withAlpha(sealedColor, 0.9);
        context!.shadowBlur = panel.height * 0.05;
        fill(
          INTERIOR_STAGE_X.gate,
          edge - 0.011,
          INTERIOR_STAGE_X.gateEnd,
          edge + 0.011,
          sealedColor,
          alpha,
          0.5,
        );
        context!.restore();
      }

      /* Shards riding their lanes, sealed blue */
      for (let lane = 0; lane < INTERIOR_LANES; lane += 1) {
        const travel = interiorShardProgress(stage, lane, INTERIOR_LANES);
        if (stage.encrypt <= 0.05 || travel >= 0.999) continue;
        const v = interiorRowY(lane);
        const centerU = interiorLaneX(travel);
        const half = rowHalf * 0.84;
        context!.save();
        context!.shadowColor = withAlpha(sealedColor, 0.85);
        context!.shadowBlur = panel.height * 0.04;
        fill(
          centerU - half * 0.6,
          v - half,
          centerU + half * 0.6,
          v + half,
          sealedColor,
          alpha * Math.min(1, stage.encrypt * 1.6),
        );
        context!.restore();
      }

      /* Drives — dark, then sealed blue as written, then green once verified */
      for (let lane = 0; lane < INTERIOR_LANES; lane += 1) {
        const v = interiorRowY(lane);
        const landed = interiorShardProgress(stage, lane, INTERIOR_LANES);
        const written = landed >= 0.99 ? 1 : 0;
        const verified = written * stage.verify;
        const face = verified > 0.5 ? verifiedColor : written ? sealedColor : palette.cardInk;
        const driveSpan = INTERIOR_STAGE_X.driveEnd - INTERIOR_STAGE_X.drive;

        fill(
          INTERIOR_STAGE_X.drive,
          v - rowHalf,
          INTERIOR_STAGE_X.driveEnd,
          v + rowHalf,
          palette.cardInk,
          alpha * 0.26,
        );
        fill(
          INTERIOR_STAGE_X.drive,
          v - rowHalf,
          INTERIOR_STAGE_X.drive + driveSpan * (0.18 + written * 0.82),
          v + rowHalf,
          face,
          alpha * (written ? 0.55 + verified * 0.4 : 0.28),
        );
        fill(
          INTERIOR_STAGE_X.driveEnd - 0.02,
          v - rowHalf * 0.36,
          INTERIOR_STAGE_X.driveEnd - 0.006,
          v + rowHalf * 0.36,
          face,
          alpha * (written ? 1 : 0.3),
          0.5,
        );
      }

      /* Verify — a bright bar sweeping across the drive column */
      if (stage.verify > 0.001 && stage.verify < 0.999) {
        const driveSpan = INTERIOR_STAGE_X.driveEnd - INTERIOR_STAGE_X.drive;
        const u = INTERIOR_STAGE_X.drive + driveSpan * stage.verify;
        context!.save();
        context!.shadowColor = withAlpha(verifiedColor, 0.95);
        context!.shadowBlur = panel.height * 0.06;
        fill(u - 0.005, stackTop, u + 0.005, stackBottom, verifiedColor, alpha * 0.95, 0.5);
        context!.restore();
      }

      /* Manifest — older rows already there, the hero file's row writes last */
      fill(
        INTERIOR_STAGE_X.manifest,
        stackTop,
        INTERIOR_STAGE_X.manifestEnd,
        stackBottom,
        palette.cardInk,
        alpha * 0.14,
        0.08,
      );
      const rowLeft = INTERIOR_STAGE_X.manifest + 0.018;
      const rowRight = INTERIOR_STAGE_X.manifestEnd - 0.018;
      for (let row = 0; row < INTERIOR_MANIFEST_ROWS; row += 1) {
        const span = interiorManifestSpan(row);
        const isHeroRow = row === INTERIOR_MANIFEST_ROWS - 1;
        const written = isHeroRow ? stage.index : 1;
        if (written <= 0.01) continue;
        fill(
          rowLeft,
          span.top + 0.014,
          rowLeft + 0.013,
          span.bottom - 0.014,
          isHeroRow ? accent : palette.cardInk,
          alpha * (isHeroRow ? 0.95 : 0.42),
          0.5,
        );
        fill(
          rowLeft + 0.024,
          span.top + 0.024,
          rowLeft + 0.024 + (rowRight - rowLeft - 0.024) * written,
          span.bottom - 0.024,
          isHeroRow ? accent : palette.cardInk,
          alpha * (isHeroRow ? 0.75 : 0.3),
          0.5,
        );
      }
    }


    /*
     * Human: The hero file — a whole card, or the blobs it breaks into. The blobs start bunched
     * at the card's own position and pull apart along the route, so you see it come apart rather
     * than one thing swapping for another.
     */
    function drawHero(viewport: SceneViewport, palette: ScenePalette, story: StoryFrame) {
      const hero = heroStateAt(story);
      if (hero.opacity <= 0.01) return;
      const accent = palette.kinds[story.kind];
      const spread = blobSpreadAt(story);
      const burst = burstAt(story);

      const blobAlpha = (1 - hero.wholeness) * hero.opacity;
      if (blobAlpha > 0.01 && hero.route) {
        const pointAt = (t: number) =>
          hero.route === "upload"
            ? uploadPointAt(t, 0, story.slot)
            : accessPointAt(t, 0, story.slot);

        // Human: Spacing opens up as they separate and closes again as they reassemble.
        const spacing = 0.062 * spread * (1 - smoothstep(0.88, 1, hero.routeT));
        // Human: A sideways bulge that peaks mid-split, so they scatter before falling into line.
        const scatter = 0.055 * Math.sin(Math.PI * spread);

        for (let index = 0; index < CHUNK_COUNT; index += 1) {
          const lane = index - (CHUNK_COUNT - 1) / 2;
          const t = Math.min(1, Math.max(0, hero.routeT + lane * spacing));
          const base = pointAt(t);
          const wobble = Math.sin(index * 2.4 + hero.routeT * 9);
          const point = project(
            {
              x: base.x,
              y: base.y + lane * scatter * 0.5 + wobble * scatter * 0.35,
              z: base.z + lane * scatter * 0.4,
            },
            viewport,
          );
          if (point.depth <= 0.2) continue;
          // Human: Slight size variation makes them read as pieces of data, not identical dots.
          drawChunk(
            context!,
            point,
            unit * (0.85 + (index % 2) * 0.3),
            accent,
            palette,
            blobAlpha,
          );
        }
      }

      const cardAlpha = hero.wholeness * hero.opacity;
      const cardPoint = project(hero.position, viewport);

      // Human: A flash ring at the instant it breaks apart, and again when it snaps together.
      if (burst > 0.01 && cardPoint.depth > 0.2) {
        const radius = CARD_WIDTH * cardPoint.scale * unit * (0.5 + burst * 1.5);
        context!.globalAlpha = burst * 0.5 * palette.opacity;
        context!.strokeStyle = accent;
        context!.lineWidth = Math.max(1, radius * 0.05);
        context!.beginPath();
        context!.arc(cardPoint.sx, cardPoint.sy, radius, 0, Math.PI * 2);
        context!.stroke();
      }

      if (cardAlpha > 0.01 && cardPoint.depth > 0.2) {
        drawCard(context!, cardPoint, unit * hero.scale, story.kind, palette, cardAlpha);
      }
    }

    function drawScene(elapsed: number) {
      const palette = AUTH_SCENE_PALETTES[themeRef.current];
      unit = Math.max(width, height) * 0.4;
      const viewport: SceneViewport = { width, height, unit };


      const story = storyAt(elapsed);
      const hero = heroStateAt(story);
      viewport.centerX = width * story.camera.frame.x;
      viewport.centerY = height * story.camera.frame.y;

      // Human: The director sets the shot; a slow drift and the pointer only nudge it.
      camera.target = story.camera.target;
      camera.distance = story.camera.distance + Math.sin(elapsed * 0.16) * 0.04;
      camera.yaw = story.camera.yaw + Math.sin(elapsed * 0.07) * 0.02 + pointer.x * 0.05;
      camera.pitch = story.camera.pitch + Math.sin(elapsed * 0.05) * 0.012 + pointer.y * 0.035;

      context!.clearRect(0, 0, width, height);
      context!.globalCompositeOperation = palette.composite;
      context!.lineCap = "round";
      context!.lineJoin = "round";

      // Human: The routes only matter once both ends are in frame.
      const railAlpha =
        story.act === "capture"
          ? smoothstep(0.7, 1, story.t) * 0.5
          : story.act === "display"
            ? 1 - smoothstep(0, 0.4, story.t)
            : 1;
      // Agent: Rails run between the hover point and the bays, matching uploadPointAt/accessPointAt.
      drawRail(CLIENT_LIFT, PATH_UPLOAD_CONTROL, STORE_CENTER, viewport, palette, elapsed, railAlpha);
      drawRail(STORE_CENTER, PATH_ACCESS_CONTROL, CLIENT_LIFT, viewport, palette, elapsed, railAlpha);

      // Human: The house appears as the camera pulls back to show where the server actually lives.
      const houseAlpha =
        story.act === "transit"
          ? smoothstep(0.35, 0.8, story.t) * 0.75
          : story.act === "dock"
            ? 0.75 - smoothstep(0.3, 0.8, story.t) * 0.35
            : story.act === "ingest" || story.act === "seal"
              ? 0
            : story.act === "retrieve"
              ? 0.4 - smoothstep(0.5, 1, story.t) * 0.4
              : 0;
      drawHouse(viewport, palette, houseAlpha);

      const drawables: Drawable[] = [
        {
          depth: project(CLIENT_CENTER, viewport).depth,
          draw: () => drawClient(viewport, palette, story),
        },
        {
          depth: project(STORE_CENTER, viewport).depth,
          draw: () => drawStore(viewport, palette, story),
        },
        {
          depth: project(hero.position, viewport).depth,
          draw: () => drawHero(viewport, palette, story),
        },
      ];
      drawables.sort((left, right) => right.depth - left.depth);
      for (const drawable of drawables) {
        if (drawable.depth <= 0.2) continue;
        drawable.draw();
      }

      // Human: The interior panel is flat 2D, so it is an overlay rather than a sorted 3D object.
      drawStoreInterior(viewport, palette, story);

      drawCursor(viewport, palette, story);

      // Human: Captions last, so nothing is drawn over them.
      const clientAnchor = project(CLIENT_CENTER, viewport);
      const storeAnchor = project(STORE_CENTER, viewport);
      const clientLabelAlpha =
        story.act === "capture" || story.act === "display" ? 0.85 : houseAlpha > 0 ? 0.5 : 0.3;
      /*
       * Human: While the camera is inside, the outside captions would be naming something the
       * viewer cannot see — the interior names itself instead.
       */
      const interiorPresence = interiorOpacityAt(story);
      const storeLabelAlpha =
        (story.act === "capture" ? 0.25 : 0.8) * (1 - interiorPresence);
      drawLabel(
        ["YOUR DEVICE"],
        clientAnchor,
        CLIENT_SCREEN_HEIGHT * clientAnchor.scale * unit * 0.85,
        palette,
        clientLabelAlpha,
      );
      drawLabel(
        ["YOUR SERVER", "SELF-HOSTED"],
        storeAnchor,
        (STORE_SLOTS * SLOT_PITCH) / 2 * storeAnchor.scale * unit + unit * 0.05,
        palette,
        storeLabelAlpha,
      );

      context!.globalAlpha = 1;
      context!.globalCompositeOperation = "source-over";
    }

    function tick(now: number) {
      if (!running) return;
      if (startTime === 0) startTime = now;
      pointer.x += (pointer.targetX - pointer.x) * 0.045;
      pointer.y += (pointer.targetY - pointer.y) * 0.045;
      drawScene((now - startTime) / 1000);
      frameId = window.requestAnimationFrame(tick);
    }

    function handlePointerMove(event: PointerEvent) {
      pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    }

    // Human: A backgrounded tab should not burn frames on decoration.
    function handleVisibility() {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frameId);
        return;
      }
      if (!running) {
        running = true;
        frameId = window.requestAnimationFrame(tick);
      }
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) drawScene(STORY_STILL_TIME);
    });
    observer.observe(canvas);
    resize();

    if (reduceMotion) {
      // Human: One still frame from the middle of the transfer — both ends and the route are visible.
      drawScene(STORY_STILL_TIME);
    } else {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      document.addEventListener("visibilitychange", handleVisibility);
      frameId = window.requestAnimationFrame(tick);
    }

    return () => {
      running = false;
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [sceneEnabled]);

  return (
    <div className={["auth-scene", className].filter(Boolean).join(" ")} aria-hidden>
      <div className="auth-scene__backdrop" />
      {sceneEnabled ? <canvas ref={canvasRef} className="auth-scene__canvas" /> : null}
      {sceneEnabled ? <div className="auth-scene__scrim" /> : null}
      <div className="auth-scene__vignette" />
    </div>
  );
}
