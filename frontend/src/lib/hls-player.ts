// Human: Shared hls.js setup for encrypted VOD playback — drive preview and public shares.
// Agent: CONFIGURES fMP4-friendly worker remux, relaxed audio drift, and conservative gap nudging.

import Hls from "hls.js";

export type HlsAuthSetup = (xhr: XMLHttpRequest) => void;

// Human: Detect HLS playlist URLs returned by stream-url (legacy /playlist or ticket-gated manifest.m3u8).
// Agent: READS url string; RETURNS true for .m3u8 or /playlist paths so hls.js handles encrypted fMP4.
export function isHlsStreamUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes(".m3u8") || lower.includes("/playlist");
}

// Human: Prefer AVPlayer native HLS on Apple touch devices — MSE/hls.js is flaky for AES fMP4 on iOS.
// Agent: READS canPlayType + userAgent; RETURNS true before Hls.isSupported() on iPhone/iPad.
export function shouldPreferNativeHlsPlayback(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
  const isIpadDesktopUa =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return isAppleMobile || isIpadDesktopUa || !Hls.isSupported();
}

// Human: Build hls.js for AES-128 VOD — main-thread decrypt + transmux for encrypted fMP4.
// Agent: enableWorker false (worker breaks AES-128 fMP4 in hls.js); maxAudioFramesDrift 4.
export function createHlsInstance(xhrSetup?: HlsAuthSetup): Hls {
  return new Hls({
    enableWorker: false,
    lowLatencyMode: false,
    testBandwidth: false,
    stretchShortVideoTrack: true,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    backBufferLength: 30,
    maxBufferHole: 0.5,
    maxFragLookUpTolerance: 2,
    maxAudioFramesDrift: 4,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 8,
    maxStarvationDelay: 8,
    maxLoadingDelay: 8,
    fragLoadingTimeOut: 120_000,
    fragLoadingMaxRetry: 6,
    manifestLoadingTimeOut: 60_000,
    xhrSetup,
  });
}

// Human: True when `time` sits inside any buffered range (small epsilon for MSE rounding).
// Agent: READS video.buffered; USED by seek recovery to avoid redundant startLoad calls.
function hasBufferAt(video: HTMLVideoElement, time: number): boolean {
  const buffered = video.buffered;
  for (let i = 0; i < buffered.length; i++) {
    if (time >= buffered.start(i) - 0.15 && time <= buffered.end(i) - 0.05) {
      return true;
    }
  }
  return false;
}

// Human: After scrubbing, nudge hls.js only when MSE has no data at the target time.
// Agent: LISTENS seeked/waiting; CALLS debounced startLoad(time) — NEVER stopLoad (aborts in-flight XHR).
export function attachVodSeekRecovery(
  hls: Hls,
  video: HTMLVideoElement,
  isActive: () => boolean,
): () => void {
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNudgeTime = -1;

  const nudgeLoad = (time: number) => {
    if (!isActive() || time < 0) return;
    if (hasBufferAt(video, time)) return;
    if (Math.abs(time - lastNudgeTime) < 0.25) return;
    lastNudgeTime = time;
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (!isActive() || hasBufferAt(video, time)) return;
      hls.startLoad(Math.max(0, time));
    }, 120);
  };

  const onSeeked = () => nudgeLoad(video.currentTime);
  const onWaiting = () => nudgeLoad(video.currentTime);

  video.addEventListener("seeked", onSeeked);
  video.addEventListener("waiting", onWaiting);

  return () => {
    if (loadTimer) clearTimeout(loadTimer);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("waiting", onWaiting);
  };
}

// Human: Fatal error handler — media recovery + seek-back nudge; no network restart-at-zero loop.
// Agent: recoverMediaError up to 2x; then startLoad(currentTime - 12) once before surfacing fatal.
export function attachHlsErrorHandler(
  hls: Hls,
  video: HTMLVideoElement,
  isActive: () => boolean,
  onFatal: (message: string) => void,
): void {
  let mediaRecoveries = 0;
  let seekBackNudgeUsed = false;

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!isActive()) return;

    if (!data.fatal) return;

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return;
    }

    if (
      data.type === Hls.ErrorTypes.MEDIA_ERROR &&
      !seekBackNudgeUsed &&
      video.currentTime > 12
    ) {
      seekBackNudgeUsed = true;
      mediaRecoveries = 0;
      hls.recoverMediaError();
      hls.startLoad(Math.max(0, video.currentTime - 12));
      return;
    }

    onFatal("Playback failed. Try again later.");
  });
}
