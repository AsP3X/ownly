// Human: Cross-browser fullscreen helpers — video element first on mobile (iOS webkit), then container.
// Agent: CALLS requestFullscreen / webkitEnterFullscreen; READS fullscreenchange + webkit video events.

type VideoFullscreenTargets = {
  container: HTMLElement | null;
  video: HTMLVideoElement | null;
};

type WebkitVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitEnterFullScreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
};

type DocumentWithWebkit = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

// Human: True when any fullscreen target (or iOS video fullscreen) is active.
// Agent: READS document.fullscreenElement and video.webkitDisplayingFullscreen.
export function isVideoFullscreenActive(targets: VideoFullscreenTargets): boolean {
  const doc = document as DocumentWithWebkit;
  const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  const { container, video } = targets;

  if (video) {
    const webkitVideo = video as WebkitVideoElement;
    if (webkitVideo.webkitDisplayingFullscreen) return true;
  }

  if (!active) return false;
  if (active === container || active === video) return true;
  if (container?.contains(active)) return true;
  if (video?.contains(active)) return true;
  return false;
}

// Human: Prefer native video fullscreen on mobile — iOS only allows webkitEnterFullscreen on <video>.
// Agent: RETURNS which path succeeded; 'failed' lets caller enable CSS immersive fallback.
export async function enterVideoFullscreen(
  targets: VideoFullscreenTargets,
  preferVideo: boolean,
): Promise<"video" | "container" | "failed"> {
  const { container, video } = targets;
  const webkitVideo = video as WebkitVideoElement | null;

  if (preferVideo && video) {
    if (typeof webkitVideo?.webkitEnterFullscreen === "function") {
      webkitVideo.webkitEnterFullscreen();
      return "video";
    }
    if (typeof webkitVideo?.webkitEnterFullScreen === "function") {
      webkitVideo.webkitEnterFullScreen();
      return "video";
    }
    try {
      await video.requestFullscreen();
      return "video";
    } catch {
      // Fall through to container attempt.
    }
  }

  if (container) {
    try {
      await container.requestFullscreen();
      return "container";
    } catch {
      return "failed";
    }
  }

  if (video) {
    try {
      await video.requestFullscreen();
      return "video";
    } catch {
      return "failed";
    }
  }

  return "failed";
}

// Human: Exit whichever fullscreen mode the browser used.
// Agent: CALLS document.exitFullscreen or webkitExitFullscreen when element fullscreen is active.
export async function exitVideoFullscreen(): Promise<void> {
  const doc = document as DocumentWithWebkit;
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === "function") {
    await Promise.resolve(doc.webkitExitFullscreen()).catch(() => undefined);
  }
}
