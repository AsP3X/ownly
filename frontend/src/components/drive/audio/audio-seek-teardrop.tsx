// Human: Pencil hover teardrop geometry for the audio seek bar — inverted drop with circular cap.
// Agent: EXPORTS static SVG path + dimensions; CONSUMED by AudioSeekBar hover preview only.

/** Rendered teardrop width in px (Pencil Hover Drop Container). */
export const AUDIO_SEEK_TEARDROP_WIDTH_PX = 44;

/** Rendered teardrop height in px (Pencil Hover Drop Container). */
export const AUDIO_SEEK_TEARDROP_HEIGHT_PX = 52;

/** SVG viewBox from Pencil Drop Shape path node. */
export const AUDIO_SEEK_TEARDROP_VIEWBOX = "0 0 40 48";

/**
 * Human: Upside-down water drop — round top, sharp point at bottom center (40×48 user space).
 * Agent: STATIC path; FILLS #1A1A1A; bottom tip aligns with timeline hover dot.
 */
export const AUDIO_SEEK_TEARDROP_PATH =
  "M20 0C31.046 0 40 8.954 40 20C40 32 20 48 20 48C20 48 0 32 0 20C0 8.954 8.954 0 20 0Z";

type AudioSeekTeardropTooltipProps = {
  timeLabel: string;
};

/**
 * Human: Hover time bubble — dark teardrop with centered timestamp in the circular header.
 * Agent: READS timeLabel; RENDERS 44×52 SVG + white 10px bold text overlay.
 */
export function AudioSeekTeardropTooltip({ timeLabel }: AudioSeekTeardropTooltipProps) {
  return (
    <div
      className="relative h-[52px] w-11 pointer-events-none"
      aria-hidden
    >
      <svg
        width={AUDIO_SEEK_TEARDROP_WIDTH_PX}
        height={AUDIO_SEEK_TEARDROP_HEIGHT_PX}
        viewBox={AUDIO_SEEK_TEARDROP_VIEWBOX}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block"
      >
        <path d={AUDIO_SEEK_TEARDROP_PATH} fill="#1A1A1A" />
      </svg>
      {/* Human: Pencil Hover Time Text — 10px bold white, vertically centered in the round cap (y≈8, h=24). */}
      <span className="absolute inset-x-0 top-2 flex h-6 items-center justify-center text-[10px] font-bold leading-none text-white tabular-nums">
        {timeLabel}
      </span>
    </div>
  );
}
