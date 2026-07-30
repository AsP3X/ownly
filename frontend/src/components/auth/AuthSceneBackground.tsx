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
  CLIENT_SCREEN_HEIGHT,
  CLIENT_SCREEN_WIDTH,
  CLIENT_TILE_COLUMNS,
  CLIENT_TILE_COUNT,
  CLIENT_TILE_ROWS,
  clientTilePoint,
  FILE_KINDS,
  PATH_ACCESS_CONTROL,
  PATH_UPLOAD_CONTROL,
  SLOT_HALF_WIDTH,
  SLOT_HEIGHT,
  SLOT_PITCH,
  slotPoint,
  STORE_CENTER,
  STORE_DEPTH,
  STORE_SLOTS,
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
  processSweepAt,
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
 * Human: The moment the still frame shows under reduced motion — mid-transfer, where the
 * laptop, the route and the server are all in the shot at once.
 */
const STORY_STILL_TIME = 9.5;

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
      const screenHeight = CLIENT_SCREEN_HEIGHT * pixelsPerUnit;
      const x = center.sx - screenWidth / 2;
      const y = center.sy - screenHeight / 2;
      const energy = clientEnergyAt(story);
      const bodyAlpha = Math.min(0.95, palette.opacity * 1.5);

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

      // Bezel.
      context!.globalAlpha = bodyAlpha;
      roundRect(context!, x, y, screenWidth, screenHeight, screenWidth * 0.04);
      context!.fillStyle = palette.device;
      context!.fill();
      context!.strokeStyle = withAlpha(palette.deviceEdge, 0.9);
      context!.lineWidth = Math.max(0.6, pixelsPerUnit * 0.005);
      context!.stroke();

      // Screen.
      const inset = screenWidth * 0.03;
      roundRect(
        context!,
        x + inset,
        y + inset,
        screenWidth - inset * 2,
        screenHeight - inset * 2,
        screenWidth * 0.025,
      );
      context!.fillStyle = palette.deviceScreen;
      context!.fill();

      /*
       * Human: A believable app window rather than a bare grid — chrome dots, a sidebar and a
       * toolbar, so the close-up reads as "someone is using their drive" at a glance.
       */
      const screenLeft = x + inset;
      const screenTop = y + inset;
      const screenInnerWidth = screenWidth - inset * 2;
      const screenInnerHeight = screenHeight - inset * 2;
      const chromeHeight = screenInnerHeight * 0.13;
      const sidebarWidth = screenInnerWidth * 0.2;

      // Title bar with traffic-light dots.
      context!.globalAlpha = bodyAlpha * 0.9;
      context!.fillStyle = withAlpha(palette.device, 0.85);
      context!.fillRect(screenLeft, screenTop, screenInnerWidth, chromeHeight);
      const dotRadius = Math.max(0.6, chromeHeight * 0.17);
      for (let dot = 0; dot < 3; dot += 1) {
        context!.globalAlpha = bodyAlpha * 0.55;
        context!.fillStyle = palette.deviceEdge;
        context!.beginPath();
        context!.arc(
          screenLeft + chromeHeight * (0.5 + dot * 0.55),
          screenTop + chromeHeight / 2,
          dotRadius,
          0,
          Math.PI * 2,
        );
        context!.fill();
      }

      // Sidebar with a few nav rows.
      context!.globalAlpha = bodyAlpha * 0.55;
      context!.fillStyle = withAlpha(palette.device, 0.6);
      context!.fillRect(
        screenLeft,
        screenTop + chromeHeight,
        sidebarWidth,
        screenInnerHeight - chromeHeight,
      );
      for (let row = 0; row < 4; row += 1) {
        const rowY = screenTop + chromeHeight + screenInnerHeight * (0.12 + row * 0.16);
        context!.globalAlpha = bodyAlpha * (row === 1 ? 0.8 : 0.35);
        context!.fillStyle = row === 1 ? palette.slot : palette.deviceEdge;
        roundRect(
          context!,
          screenLeft + sidebarWidth * 0.16,
          rowY,
          sidebarWidth * (row === 3 ? 0.5 : 0.68),
          Math.max(0.8, screenInnerHeight * 0.045),
          screenInnerHeight * 0.03,
        );
        context!.fill();
      }

      // Human: The file grid — the drive, as the user sees it.
      const tileWorldWidth = ((CLIENT_SCREEN_WIDTH * 0.76) / CLIENT_TILE_COLUMNS) * 0.8;
      const tileWorldHeight = ((CLIENT_SCREEN_HEIGHT * 0.7) / CLIENT_TILE_ROWS) * 0.76;
      const onScreen = heroTileOnScreen(story);
      const selection = heroTileSelected(story);

      for (let index = 0; index < CLIENT_TILE_COUNT; index += 1) {
        const tile = project(clientTilePoint(index), viewport);
        const tileWidth = tileWorldWidth * tile.scale * unit;
        const tileHeight = tileWorldHeight * tile.scale * unit;
        const tileX = tile.sx - tileWidth / 2;
        const tileY = tile.sy - tileHeight / 2;
        const isHeroTile = index === story.tile % CLIENT_TILE_COUNT;
        const kind = isHeroTile ? story.kind : FILE_KINDS[index % FILE_KINDS.length];
        const accent = palette.kinds[kind];

        if (isHeroTile && !onScreen) {
          // Human: The file is away — its place in the grid waits for it, outlined.
          roundRect(context!, tileX, tileY, tileWidth, tileHeight, tileWidth * 0.16);
          context!.globalAlpha = bodyAlpha * 0.5;
          context!.strokeStyle = withAlpha(accent, 0.55);
          context!.setLineDash([tileWidth * 0.14, tileWidth * 0.12]);
          context!.lineWidth = Math.max(0.6, tileWidth * 0.05);
          context!.stroke();
          context!.setLineDash([]);
          continue;
        }

        // Thumbnail block.
        context!.globalAlpha = bodyAlpha * (isHeroTile ? 0.95 : 0.7);
        roundRect(context!, tileX, tileY, tileWidth, tileHeight * 0.72, tileWidth * 0.14);
        context!.fillStyle = withAlpha(accent, isHeroTile ? 0.75 : 0.4);
        context!.fill();
        drawKindGlyph(
          context!,
          kind,
          tileX + tileWidth * 0.3,
          tileY + tileHeight * 0.14,
          tileWidth * 0.4,
          palette.deviceScreen,
        );

        // Filename line under it.
        context!.globalAlpha = bodyAlpha * 0.45;
        context!.fillStyle = palette.deviceEdge;
        roundRect(
          context!,
          tileX + tileWidth * 0.1,
          tileY + tileHeight * 0.82,
          tileWidth * 0.8,
          Math.max(0.7, tileHeight * 0.1),
          tileHeight * 0.05,
        );
        context!.fill();

        // Human: Selection ring — the pointer has this file under it.
        if (isHeroTile && selection > 0.01) {
          const grow = tileWidth * 0.12 * selection;
          roundRect(
            context!,
            tileX - grow,
            tileY - grow,
            tileWidth + grow * 2,
            tileHeight + grow * 2,
            tileWidth * 0.2,
          );
          context!.globalAlpha = bodyAlpha * selection;
          context!.strokeStyle = palette.slot;
          context!.lineWidth = Math.max(0.8, tileWidth * 0.06);
          context!.stroke();
        }
      }

      // Human: Transfer bar along the bottom of the screen while the upload is in flight.
      const progress = transferProgressAt(story);
      if (progress > 0.001 && progress < 0.999) {
        const barWidth = screenInnerWidth * 0.66;
        const barHeight = Math.max(1.2, screenHeight * 0.035);
        const barX = screenLeft + sidebarWidth + (screenInnerWidth - sidebarWidth - barWidth) / 2;
        const barY = screenTop + screenInnerHeight - barHeight * 2.4;
        context!.globalAlpha = bodyAlpha * 0.6;
        roundRect(context!, barX, barY, barWidth, barHeight, barHeight / 2);
        context!.fillStyle = withAlpha(palette.deviceEdge, 0.5);
        context!.fill();
        context!.globalAlpha = bodyAlpha;
        roundRect(context!, barX, barY, barWidth * progress, barHeight, barHeight / 2);
        context!.fillStyle = palette.kinds[story.kind];
        context!.fill();
      }

      // Base.
      context!.globalAlpha = bodyAlpha;
      const baseWidth = screenWidth * 1.14;
      const baseHeight = screenHeight * 0.07;
      roundRect(
        context!,
        center.sx - baseWidth / 2,
        y + screenHeight + baseHeight * 0.3,
        baseWidth,
        baseHeight,
        baseHeight * 0.45,
      );
      context!.fillStyle = palette.device;
      context!.fill();
      context!.strokeStyle = withAlpha(palette.deviceEdge, 0.75);
      context!.lineWidth = Math.max(0.5, pixelsPerUnit * 0.004);
      context!.stroke();
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
      const bodyAlpha = Math.min(0.95, palette.opacity * 1.5);

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
        story.act === "store" ||
        (story.act === "transit" && story.t > 0.92) ||
        (story.act === "retrieve" && story.t < 0.12);
      if (heroStored) occupied.add(story.slot);

      for (let slot = 0; slot < STORE_SLOTS; slot += 1) {
        const point = project(slotPoint(slot), viewport);
        const slotWidth = SLOT_HALF_WIDTH * 2 * point.scale * unit;
        const slotHeight = SLOT_HEIGHT * point.scale * unit;
        const x = point.sx - slotWidth / 2;
        const y = point.sy - slotHeight / 2;
        const isHero = slot === story.slot;
        const filled = occupied.has(slot);
        const accent = isHero
          ? palette.kinds[story.kind]
          : palette.kinds[FILE_KINDS[slot % FILE_KINDS.length]];
        const slotEnergy = isHero && heroStored ? energy : filled ? 0.2 : 0;

        // Bay body — a recessed caddy slot, dark whether or not anything lives in it.
        context!.globalAlpha = bodyAlpha;
        roundRect(context!, x, y, slotWidth, slotHeight, slotHeight * 0.28);
        context!.fillStyle = palette.storeSide;
        context!.fill();
        context!.strokeStyle = withAlpha(palette.storeEdge, 0.55);
        context!.lineWidth = Math.max(0.4, slotHeight * 0.05);
        context!.stroke();

        if (filled) {
          // Label plate in the colour of the file that lives there.
          context!.globalAlpha = bodyAlpha;
          roundRect(
            context!,
            x + slotWidth * 0.04,
            y + slotHeight * 0.22,
            slotWidth * 0.045,
            slotHeight * 0.56,
            slotHeight * 0.1,
          );
          context!.fillStyle = withAlpha(accent, 0.55 + slotEnergy * 0.45);
          context!.fill();

          roundRect(
            context!,
            x + slotWidth * 0.14,
            y + slotHeight * 0.26,
            slotWidth * 0.5,
            slotHeight * 0.48,
            slotHeight * 0.14,
          );
          context!.fillStyle = withAlpha(accent, 0.14 + slotEnergy * 0.3);
          context!.fill();
        }

        if (slotEnergy > 0.24) {
          // The hero bay lights up as its file lands and while it is being processed.
          const pulse = (slotEnergy - 0.24) / 0.76;
          context!.globalAlpha = bodyAlpha * pulse;
          context!.shadowColor = withAlpha(accent, 0.9);
          context!.shadowBlur = slotHeight * 2.4;
          roundRect(context!, x, y, slotWidth, slotHeight, slotHeight * 0.28);
          context!.fillStyle = withAlpha(accent, 0.5);
          context!.fill();
          context!.shadowBlur = 0;
          context!.shadowColor = "transparent";
        }

        // Drive activity LED.
        const blink = 0.35 + 0.65 * Math.abs(Math.sin(story.loop + slot * 1.7 + story.t * 9));
        context!.globalAlpha = bodyAlpha * (filled ? blink : 0.14);
        context!.fillStyle = filled ? accent : palette.storeEdge;
        context!.beginPath();
        context!.arc(
          x + slotWidth - slotHeight * 0.5,
          point.sy,
          Math.max(0.5, slotHeight * 0.15),
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
          : story.act === "store"
            ? 0.75 - smoothstep(0.3, 0.8, story.t) * 0.35
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

      drawCursor(viewport, palette, story);

      // Human: Captions last, so nothing is drawn over them.
      const clientAnchor = project(CLIENT_CENTER, viewport);
      const storeAnchor = project(STORE_CENTER, viewport);
      const clientLabelAlpha =
        story.act === "capture" || story.act === "display" ? 0.85 : houseAlpha > 0 ? 0.5 : 0.3;
      const storeLabelAlpha = story.act === "capture" ? 0.25 : 0.8;
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
