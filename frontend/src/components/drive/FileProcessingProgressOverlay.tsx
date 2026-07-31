// Human: Circular progress overlay on explorer thumbnails while server-side ingest/rebuild runs.
// Agent: READS fileProcessingPercent + label; RENDERS dimmed cover + SVG ring over the preview slot.

import type { FileItem } from "@/api/client";
import {
  fileProcessingLabel,
  fileProcessingPercent,
  isFileMovingToStorage,
} from "@/lib/file-processing";
import { cn } from "@/lib/utils";

type FileProcessingProgressOverlayProps = {
  file: FileItem;
  className?: string;
};

const RING_SIZE = 52;
const RING_STROKE = 3.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Human: Centered ring + percent over the thumbnail so rebuild progress is obvious at a glance.
// Agent: DETERMINATE stroke-dashoffset from conversion_progress; INDETERMINATE spin when still 0%.
export function FileProcessingProgressOverlay({
  file,
  className,
}: FileProcessingProgressOverlayProps) {
  const percent = fileProcessingPercent(file);
  const label = fileProcessingLabel(file);
  const determinate = percent > 0;
  const storing = isFileMovingToStorage(file);
  // Human: Ring sits on a black scrim in both themes, so it uses the overlay tokens, not ok/proc.
  const ringColor = storing ? "stroke-overlay-ok" : "stroke-overlay-proc";
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(100, percent) / 100);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-[1] flex items-center justify-center",
        "bg-black/45",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? percent : undefined}
      aria-valuetext={label}
      aria-label={label}
      title={label}
    >
      <div className="relative flex size-[52px] items-center justify-center">
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className={cn("absolute inset-0", !determinate && "animate-spin")}
          aria-hidden
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-white/25"
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            className={cn(ringColor, "transition-[stroke-dashoffset] duration-300 ease-out")}
            strokeDasharray={
              determinate
                ? `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`
                : `${RING_CIRCUMFERENCE * 0.22} ${RING_CIRCUMFERENCE}`
            }
            strokeDashoffset={determinate ? dashOffset : RING_CIRCUMFERENCE * 0.08}
            // Human: Start fill from 12 o'clock so the ring reads as a clock-style progress.
            // Agent: ROTATE -90deg around center; KEEPS dashoffset math on the unrotated path.
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          />
        </svg>
        <span
          className={cn(
            "relative z-[1] text-[11px] font-semibold tabular-nums tracking-tight text-white",
            "drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
          )}
        >
          {determinate ? `${percent}%` : "…"}
        </span>
      </div>
    </div>
  );
}
