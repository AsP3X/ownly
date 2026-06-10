// Human: Sidebar card showing how many uploads remain in the current per-minute window.
// Agent: READS UploadRateLimitStatus; RENDERS progress bar + remaining count text.

import type { UploadRateLimitStatus } from "@/api/client";
import { cn } from "@/lib/utils";

type UploadRateLimitWidgetProps = {
  status: UploadRateLimitStatus | null;
  loading?: boolean;
};

// Human: Format upload counts for compact sidebar labels (e.g. 1,200).
// Agent: USES Intl.NumberFormat; FALLBACK to String for older engines.
function formatUploadCount(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(value);
  }
}

// Human: Remaining-upload progress block pinned above the storage quota widget.
// Agent: COMPUTES fill from remaining/limit; SHOWS retry hint when remaining is zero.
export function UploadRateLimitWidget({ status, loading = false }: UploadRateLimitWidgetProps) {
  if (!status && loading) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-[#F7F8FA] p-4" aria-busy="true">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">Upload rate</p>
        <p className="text-xs text-[#666666]">Loading…</p>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const { limit_per_minute: limit, remaining_in_window: remaining, retry_after_seconds } = status;
  const ratio = limit > 0 ? remaining / limit : 0;
  const percentRemaining = Math.min(100, Math.round(ratio * 100));
  const fillWidth = remaining > 0 ? Math.max(percentRemaining, 2) : 0;
  const isLow = percentRemaining > 0 && percentRemaining <= 15;
  const isExhausted = remaining <= 0;

  const detailText = isExhausted
    ? retry_after_seconds
      ? `Rate limited — retry in ${retry_after_seconds}s`
      : "Rate limited — try again shortly"
    : `${formatUploadCount(remaining)} of ${formatUploadCount(limit)} uploads left this minute`;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[#F7F8FA] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">Upload rate</p>
      <p
        className={cn(
          "text-xs leading-snug",
          isExhausted ? "font-semibold text-[#DC2626]" : "text-[#666666]",
          isLow && !isExhausted && "text-[#D97706]",
        )}
      >
        {detailText}
      </p>
      <div
        className="h-1 w-full overflow-hidden rounded-sm bg-[#E5E7EB]"
        role="progressbar"
        aria-valuenow={percentRemaining}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Upload rate limit remaining this minute"
      >
        <div
          className={cn(
            "h-full rounded-sm transition-[width] duration-300 ease-out",
            isExhausted ? "bg-[#DC2626]" : isLow ? "bg-[#F59E0B]" : "bg-[#2563EB]",
          )}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}
