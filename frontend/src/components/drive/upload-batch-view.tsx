// Human: Shared upload batch progress UI — consistent status copy, bars, and row chrome.
// Agent: READS UploadItemSnapshot[]; RENDERED by UploadTransferPanel when expanded.

import { useEffect, useRef, useState, type RefObject } from "react";
import { AlertCircle, Check, ChevronDown, Clock, Loader2, X } from "lucide-react";
import { ExplorerFileGlyph } from "@/components/drive/ExplorerFileGlyph";
import {
  type UploadItemSnapshot,
  type UploadPhase,
} from "@/lib/upload-manager";
import {
  formatUploadDoneSummary,
  formatUploadQueueSummary,
  getUploadPercentLabel,
  getUploadPhaseLabel,
  getUploadTerminalStatus,
} from "@/lib/upload-status-copy";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Human: Ceiling for the scrollable file list. The list sizes to its content and only scrolls
 * past this point — a fixed height left a large empty void whenever few files were in flight.
 *
 * Human: The flat 19rem was taller than a landscape phone's ENTIRE viewport (390px), so the
 * upload tray swallowed the screen. The value now lives in --upload-list-max-h (index.css),
 * which keeps 19rem on desktop and additionally bounds it by viewport share below lg —
 * desktop is deliberately left exactly as it was.
 * Agent: APPLIED as max-height; the list has no min-height so short batches render compactly.
 */
export const UPLOAD_PANEL_LIST_MAX_HEIGHT = "var(--upload-list-max-h)";

/**
 * Human: How long the list waits before handing space back. A file leaves the in-flight set the
 * moment its bytes land and the next file claims the free slot milliseconds later, so a list that
 * shrank on sight dropped and re-added a full row several times per batch — and because the tray is
 * anchored bottom-right, every one of those moved its top edge.
 * Agent: Only applies once nothing is queued; see useSettledListHeight.
 */
const UPLOAD_PANEL_LIST_SETTLE_MS = 700;

/** Human: Reserved height for pinned queue/done summary slots. */
export const UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT = "1.375rem";

/** Human: Above this count, completed rows collapse to one summary line. */
export const UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS = 3;

// Human: Phase accent palette — one set of drive tokens for icon, percent, bar, and status text.
// Agent: MAPS uploading | processing | encrypting | storing to token utilities so every phase
//        colour adapts to dark mode. Raw Tailwind palettes here previously did not.
function phaseStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      icon: "text-ok",
      percent: "text-ok",
      bar: "bg-ok",
      status: "text-ok",
      shimmer: "bg-ok",
      track: "bg-ok-weak",
      chip: "bg-ok-weak text-ok",
    };
  }
  if (phase === "encrypting") {
    return {
      icon: "text-warn",
      percent: "text-warn",
      bar: "bg-warn",
      status: "text-warn",
      shimmer: "bg-warn",
      track: "bg-warn-weak",
      chip: "bg-warn-weak text-warn",
    };
  }
  if (phase === "processing") {
    return {
      icon: "text-proc",
      percent: "text-proc",
      bar: "bg-proc",
      status: "text-proc",
      shimmer: "bg-proc",
      track: "bg-proc-weak",
      chip: "bg-proc-weak text-proc",
    };
  }
  return {
    icon: "text-brand",
    percent: "text-brand",
    bar: "bg-brand",
    status: "text-brand",
    shimmer: "bg-brand",
    track: "bg-brand-weak",
    chip: "bg-brand-weak text-brand",
  };
}

function isPostUploadPhase(phase: UploadPhase): boolean {
  return phase === "processing" || phase === "encrypting" || phase === "storing";
}

// Human: Shared progress track — same height/radius for per-file and overall bars.
// Agent: DETERMINATE width from value with transfer-progress-fill; SHIMMER when indeterminate.
export function UploadProgressBar({
  value,
  phase = "uploading",
  indeterminate,
  statusLabel,
  size = "sm",
  className,
}: {
  value: number;
  phase?: UploadPhase;
  indeterminate?: boolean;
  statusLabel?: string;
  /** sm = per-file (4px), md = overall batch (6px) */
  size?: "sm" | "md";
  className?: string;
}) {
  const styles = phaseStyles(phase);
  const heightClass = size === "md" ? "h-1.5" : "h-1";
  const ariaLabel = statusLabel ?? (phase === "uploading" ? "Uploading" : "Upload in progress");
  const useShimmer = Boolean(indeterminate && isPostUploadPhase(phase));

  if (useShimmer) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-edge",
          heightClass,
          className,
        )}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-full transition-colors duration-300 ease-out",
            styles.track,
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full",
            styles.shimmer,
          )}
        />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-edge",
        heightClass,
        className,
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={cn("transfer-progress-fill h-full rounded-full", styles.bar)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// Human: Soft enter only when pipeline phase text changes (Uploading → Converting), not on every tick.
// Agent: TRACKS previous label; APPLIES transfer-status-enter only on discrete label change.
function AnimatedPhaseStatus({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const prevRef = useRef(children);
  const [enter, setEnter] = useState(false);

  useEffect(() => {
    if (prevRef.current === children) return;
    prevRef.current = children;
    setEnter(true);
    const id = window.setTimeout(() => setEnter(false), 240);
    return () => window.clearTimeout(id);
  }, [children]);

  return (
    <span className={cn(enter && "transfer-status-enter", "inline-block", className)}>
      {children}
    </span>
  );
}

// Human: Percent label with a light pop when the integer value advances.
function AnimatedPercentLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const prevRef = useRef(label);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    if (prevRef.current === label) return;
    prevRef.current = label;
    if (label === "…") return;
    setTick(true);
    const id = window.setTimeout(() => setTick(false), 280);
    return () => window.clearTimeout(id);
  }, [label]);

  return (
    <span
      className={cn(
        "inline-block tabular-nums will-change-transform",
        tick && "transfer-percent-tick",
        className,
      )}
    >
      {label}
    </span>
  );
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

// Human: Meta fragments under every row — size · status · optional detail (always same separators).
function UploadRowMeta({
  sizeBytes,
  status,
  statusClassName,
  detail,
}: {
  sizeBytes: number;
  status: string;
  statusClassName?: string;
  detail?: string | null;
}) {
  return (
    <p className="truncate text-[11px] leading-tight text-ink-faint">
      <span className="tabular-nums">{formatBytes(sizeBytes)}</span>
      <span aria-hidden> · </span>
      <AnimatedPhaseStatus className={cn(statusClassName ?? "text-ink-muted")}>
        {status}
      </AnimatedPhaseStatus>
      {detail ? (
        <>
          <span aria-hidden> · </span>
          <span className="transition-opacity duration-200">{detail}</span>
        </>
      ) : null}
    </p>
  );
}

// Human: Active upload row — filename, percent, bar, and meta in one consistent layout.
// Agent: READS UploadItemSnapshot; CALLS onCancel to abort and remove row.
export function ActiveUploadRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  const postUpload = isPostUploadPhase(item.phase);
  const styles = phaseStyles(item.phase);
  const phaseStatus = getUploadPhaseLabel(item);
  const percentLabel = getUploadPercentLabel(item);
  const showIndeterminate = postUpload && Boolean(item.indeterminate) && item.progress <= 0;
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  useEffect(() => {
    if (!postUpload) return;
    const started = Date.now();
    const timerId = window.setInterval(() => {
      setPhaseElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [postUpload, item.phase]);

  const detailParts: string[] = [];
  if (item.paused) detailParts.push("Paused");
  if (postUpload && phaseElapsedSec > 0) detailParts.push(formatElapsed(phaseElapsedSec));
  // Human: Transport is diagnostic only — muted and after status, not competing with phase color.
  if (item.phase === "uploading" && item.partTransport) {
    detailParts.push(item.partTransport === "direct" ? "Direct" : "Via API");
  }

  return (
    <div className="transfer-row-enter flex gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface">
      {/* Human: File-type glyph with a spinning ring — identifies the file and shows it is live. */}
      {/* Agent: REUSES ExplorerFileGlyph so a file looks the same here as in the explorer grid. */}
      <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center">
        <Loader2
          className={cn("absolute inset-0 size-7 animate-spin opacity-40", styles.icon)}
          aria-hidden
        />
        <ExplorerFileGlyph mimeType={item.mimeType} className="size-3.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={item.fileName}>
            {item.fileName}
          </p>
          <AnimatedPercentLabel
            label={percentLabel}
            className={cn(
              "shrink-0 text-[12px] font-semibold transition-colors duration-300",
              styles.percent,
            )}
          />
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0 text-ink-faint transition-colors hover:text-danger"
              aria-label={`Cancel upload ${item.fileName}`}
              onClick={() => onCancel(item.id)}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <UploadProgressBar
          value={item.progress}
          phase={item.phase}
          indeterminate={showIndeterminate}
          statusLabel={phaseStatus}
        />

        <div className="flex min-w-0 items-center gap-1.5">
          {/* Human: Phase as a chip, not prose — scannable across a stack of rows. */}
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold leading-4",
              styles.chip,
            )}
          >
            <AnimatedPhaseStatus>{phaseStatus}</AnimatedPhaseStatus>
          </span>
          {/* Human: Rows restored from background jobs carry no byte count — omit rather than "0 B". */}
          {/* Agent: READS fileSize > 0; falls back to detail fragments alone when size is unknown. */}
          <span className="truncate text-[11px] tabular-nums text-ink-faint">
            {[item.fileSize > 0 ? formatBytes(item.fileSize) : null, ...detailParts]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        {item.relativePath ? (
          <p className="truncate text-[10px] text-ink-faint" title={item.relativePath}>
            {item.relativePath}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Human: Completed file row — same meta pattern as active (size · Done).
export function CompletedUploadRow({ item }: { item: UploadItemSnapshot }) {
  return (
    <div className="transfer-row-enter flex items-center justify-between gap-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <Check className="size-3.5 shrink-0 text-ok transition-transform duration-300" aria-hidden />
        <div className="min-w-0">
          <p className="min-w-0 truncate text-[13px] font-medium text-ink">{item.fileName}</p>
          {item.relativePath ? (
            <p className="truncate text-[11px] text-ink-faint">{item.relativePath}</p>
          ) : null}
          <UploadRowMeta
            sizeBytes={item.fileSize}
            status={getUploadTerminalStatus("done")}
            statusClassName="text-ok"
          />
        </div>
      </div>
    </div>
  );
}

// Human: Queued file row — same icon/name/meta structure as other rows.
export function QueuedFileRow({
  item,
  onCancel,
  onTogglePause,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
  onTogglePause?: (itemId: string, paused: boolean) => void;
}) {
  const status = item.paused ? "Paused" : "Queued";

  // Human: Single compact line — queued files need identity and controls, not a progress block.
  // Agent: Row controls stay mounted but reveal on hover/focus so the queue reads as a calm list.
  return (
    <div className="transfer-row-enter group flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-surface">
      <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
        <ExplorerFileGlyph mimeType={item.mimeType} className="size-3.5 opacity-70" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="min-w-0 truncate text-[12px] font-medium text-ink-muted" title={item.fileName}>
          {item.fileName}
        </p>
        {/* Agent: Same rule as active rows — a zero byte count is unknown, not "0 B". */}
        <p className="truncate text-[10px] tabular-nums text-ink-faint">
          {[item.fileSize > 0 ? formatBytes(item.fileSize) : null, status, item.relativePath]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {onTogglePause ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px] font-semibold text-ink-muted transition-colors hover:text-ink"
            onClick={() => onTogglePause(item.id, !item.paused)}
          >
            {item.paused ? "Resume" : "Pause"}
          </Button>
        ) : null}
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-ink-faint transition-colors hover:text-danger"
            aria-label={`Cancel queued upload ${item.fileName}`}
            onClick={() => onCancel(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Human: Terminal failed or cancelled row — size · Failed/Cancelled + actions.
export function FailedUploadRow({
  item,
  onRemove,
  onReattachFile,
  onRetry,
}: {
  item: UploadItemSnapshot;
  onRemove?: (itemId: string) => void;
  onReattachFile?: (itemId: string, file: File) => void;
  onRetry?: (itemId: string) => void;
}) {
  const isFailed = item.status === "error";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const status = getUploadTerminalStatus(item.status);

  return (
    <div className="transfer-row-enter flex items-center justify-between gap-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        {isFailed ? (
          <AlertCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
        ) : (
          <X className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{item.fileName}</p>
          {item.error ? (
            <p className="truncate text-[11px] text-danger" title={item.error}>
              {item.error}
            </p>
          ) : (
            <UploadRowMeta
              sizeBytes={item.fileSize}
              status={status}
              statusClassName={isFailed ? "text-danger" : "text-ink-muted"}
            />
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.canRetry && onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs font-semibold transition-colors"
            onClick={() => onRetry(item.id)}
          >
            Retry
          </Button>
        ) : null}
        {item.needsFileReselect && onReattachFile ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              aria-hidden
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) onReattachFile(item.id, picked);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs font-semibold transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
          </>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-ink-faint transition-colors hover:text-danger"
            aria-label={`Remove ${item.fileName} from uploads`}
            onClick={() => onRemove(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Human: Overall progress bar for the batch — same chrome as per-file, slightly taller.
export function UploadOverallProgressBar({ percent }: { percent: number }) {
  return (
    <UploadProgressBar
      value={percent}
      phase="uploading"
      size="md"
      statusLabel="Overall upload progress"
    />
  );
}

/**
 * Human: Batch progress split into what is banked versus what is still moving.
 * The solid green portion is files fully finished; the blue portion is work in flight.
 * A single flat bar could not distinguish "nearly done" from "one file is 99% done".
 * Agent: doneRatio and overallPercent both 0–100; active segment = overall − done, clamped ≥ 0.
 */
export function UploadSegmentedProgressBar({
  donePercent,
  overallPercent,
  isPaused = false,
}: {
  donePercent: number;
  overallPercent: number;
  isPaused?: boolean;
}) {
  const done = Math.min(100, Math.max(0, donePercent));
  const overall = Math.min(100, Math.max(done, overallPercent));
  const activeWidth = Math.max(0, overall - done);

  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full bg-edge"
      role="progressbar"
      aria-valuenow={Math.round(overall)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Overall upload progress"
    >
      {/* Human: Completed files — this portion cannot regress. */}
      <div
        className="transfer-progress-fill absolute inset-y-0 left-0 rounded-full bg-ok"
        style={{ width: `${done}%` }}
      />
      {/* Human: Work in flight — sits immediately after the banked portion. */}
      {/* Agent: Paused batches drop to a muted fill so the bar stops reading as live. */}
      <div
        className={cn(
          "transfer-progress-fill absolute inset-y-0 rounded-full",
          isPaused ? "bg-edge-strong" : "bg-brand",
        )}
        style={{ left: `${done}%`, width: `${activeWidth}%` }}
      />
    </div>
  );
}

// Human: Queue backlog line — fixed slot height when reserved for bulk batches.
export function UploadQueueBacklogSummary({
  count,
  reserveSlot = false,
}: {
  count: number;
  reserveSlot?: boolean;
}) {
  if (count === 0 && !reserveSlot) return null;
  const label = formatUploadQueueSummary(count);

  return (
    <div
      className="flex shrink-0 items-center gap-2"
      style={{ minHeight: UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT }}
    >
      {count > 0 ? (
        <>
          <Clock className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <p className="truncate text-[11px] text-ink-faint">{label}</p>
        </>
      ) : (
        <span className="sr-only">No files waiting in queue</span>
      )}
    </div>
  );
}

// Human: Done backlog line for large batches.
export function UploadDoneBacklogSummary({
  count,
  reserveSlot = false,
}: {
  count: number;
  reserveSlot?: boolean;
}) {
  if (count === 0 && !reserveSlot) return null;
  const label = formatUploadDoneSummary(count);

  return (
    <div
      className="flex shrink-0 items-center gap-2"
      style={{ minHeight: UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT }}
    >
      {count > 0 ? (
        <>
          <Check className="size-3.5 shrink-0 text-ok" aria-hidden />
          <p className="truncate text-[11px] text-ink-faint">{label}</p>
        </>
      ) : (
        <span className="sr-only">No completed uploads yet</span>
      )}
    </div>
  );
}

/**
 * Human: Expandable queue section. Previously a batch of more than three files replaced every
 * queued row with a single "N files waiting" line, so those uploads could not be paused or
 * cancelled individually. They are now one click away.
 * Agent: OWNS open state; RENDERS QueuedFileRow children; keeps per-item pause/cancel handlers.
 */
function UploadQueueDisclosure({
  items,
  defaultOpen,
  onCancelItem,
  onTogglePauseItem,
}: {
  items: UploadItemSnapshot[];
  defaultOpen: boolean;
  onCancelItem?: (itemId: string) => void;
  onTogglePauseItem?: (itemId: string, paused: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label = formatUploadQueueSummary(items.length);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface"
      >
        <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
          <Clock className="size-3.5 text-ink-faint" />
        </span>
        <span className="flex-1 truncate text-[11px] font-medium text-ink-faint">{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 border-l border-hairline pl-2 ml-4">
          {items.map((item) => (
            <QueuedFileRow
              key={item.id}
              item={item}
              onCancel={onCancelItem}
              onTogglePause={onTogglePauseItem}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Human: Height for the file list that follows content growth but resists content loss. Rows are
 * reserved while files are still queued, because a row that just left is about to be replaced.
 * Agent: RETURNS null until the first measurement so a fresh tray renders at its natural height.
 */
function useSettledListHeight(
  contentRef: RefObject<HTMLDivElement | null>,
  holdHeight: boolean,
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const appliedRef = useRef<number | null>(null);
  const holdRef = useRef(holdHeight);
  const settleTimerRef = useRef<number | null>(null);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const clearSettleTimer = () => {
      if (settleTimerRef.current === null) return;
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    };

    const apply = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      appliedRef.current = next;
      setHeight(next);
    };

    const sync = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      const applied = appliedRef.current;
      if (applied === null || next >= applied) {
        clearSettleTimer();
        appliedRef.current = next;
        setHeight(next);
        return;
      }
      if (holdRef.current || settleTimerRef.current !== null) return;
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        if (holdRef.current) return;
        apply();
      }, UPLOAD_PANEL_LIST_SETTLE_MS);
    };

    syncRef.current = sync;
    sync();

    if (typeof ResizeObserver === "undefined") return clearSettleTimer;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearSettleTimer();
    };
  }, [contentRef]);

  // Human: Releasing the hold re-checks the list so the tail of a batch still collapses.
  useEffect(() => {
    holdRef.current = holdHeight;
    if (!holdHeight) syncRef.current();
  }, [holdHeight]);

  return height;
}

// Human: Upload batch body — overall summary, divider, and unified scrollable file list.
export function UploadBatchProgressView({
  items,
  onCancelItem,
  onRemoveItem,
  onReattachFile,
  onReattachFiles,
  onRetryItem,
  onTogglePauseItem,
}: {
  items: UploadItemSnapshot[];
  onCancelItem?: (itemId: string) => void;
  onRemoveItem?: (itemId: string) => void;
  onReattachFile?: (itemId: string, file: File) => void;
  onReattachFiles?: (files: File[]) => void;
  onRetryItem?: (itemId: string) => void;
  onTogglePauseItem?: (itemId: string, paused: boolean) => void;
}) {
  const batchReselectRef = useRef<HTMLInputElement | null>(null);
  const activeItems = items.filter((item) => item.displayBucket === "in_flight");
  const waitingItems = items.filter((item) => item.displayBucket === "queued");
  const doneItems = items.filter((item) => item.displayBucket === "done");
  const failedItems = items.filter(
    (item) => item.displayBucket === "error" || item.displayBucket === "cancelled",
  );
  const needsReselectCount = items.filter((item) => item.needsFileReselect).length;
  // Human: Batch percent and counts now live in the panel header, not in this body.
  const isBulkBatch = items.length > UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const showIndividualDoneRows =
    !isBulkBatch && doneItems.length <= UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const listIsEmpty = activeItems.length === 0 && failedItems.length === 0;
  // Human: Queued files are guaranteed row space soon, so the list keeps whatever it already had.
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const listHeight = useSettledListHeight(listContentRef, waitingItems.length > 0);

  return (
    <>
      {needsReselectCount > 1 && onReattachFiles ? (
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-weak px-3 py-2">
          <p className="text-[11px] leading-snug text-warn">
            {needsReselectCount} uploads need the original files after reload.
          </p>
          <input
            ref={batchReselectRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden
            onChange={(event) => {
              const picked = event.target.files ? Array.from(event.target.files) : [];
              if (picked.length > 0) onReattachFiles(picked);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs font-semibold"
            onClick={() => batchReselectRef.current?.click()}
          >
            Choose files
          </Button>
        </div>
      ) : null}

      {/* Human: List follows its content up to a ceiling — no reserved void when few files are live. */}
      {/* Agent: height from useSettledListHeight; overscroll-contain stops the drive scrolling behind. */}
      <div
        className="transfer-list-settle min-h-0 overflow-y-auto overscroll-contain"
        style={{
          maxHeight: UPLOAD_PANEL_LIST_MAX_HEIGHT,
          height: listHeight ?? undefined,
        }}
      >
        <div ref={listContentRef} className="flex flex-col gap-0.5">
          {listIsEmpty && waitingItems.length === 0 ? (
            <p className="flex min-h-[2.5rem] items-center justify-center text-center text-[12px] text-ink-faint">
              Preparing next files…
            </p>
          ) : null}

          {activeItems.map((item) => (
            <ActiveUploadRow key={item.id} item={item} onCancel={onCancelItem} />
          ))}

          {failedItems.length > 0 ? (
            <div className="flex flex-col gap-0.5 pt-1">
              {failedItems.map((item) => (
                <FailedUploadRow
                  key={item.id}
                  item={item}
                  onRemove={onRemoveItem}
                  onReattachFile={onReattachFile}
                  onRetry={onRetryItem}
                />
              ))}
            </div>
          ) : null}

          {/* Human: Queued files are now reachable instead of collapsing to a dead count line. */}
          {/* Agent: Collapsed by default for bulk batches; every row keeps its pause/cancel controls. */}
          {waitingItems.length > 0 ? (
            <UploadQueueDisclosure
              items={waitingItems}
              defaultOpen={!isBulkBatch}
              onCancelItem={onCancelItem}
              onTogglePauseItem={onTogglePauseItem}
            />
          ) : null}

          {/* Human: Finished rows stay listed for small batches; bulk batches keep the count line. */}
          {showIndividualDoneRows ? (
            doneItems.map((item) => <CompletedUploadRow key={item.id} item={item} />)
          ) : doneItems.length > 0 ? (
            <UploadDoneBacklogSummary count={doneItems.length} />
          ) : null}
        </div>
      </div>
    </>
  );
}
