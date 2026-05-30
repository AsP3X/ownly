// Human: Green/red database test result banners from Pencil success and error frames.
// Agent: RENDERS icon + message; variant selects Pencil fill/stroke/text colors.

import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type SetupDbStatusBannerProps = {
  variant: "success" | "error";
  message: string;
};

export function SetupDbStatusBanner({ variant, message }: SetupDbStatusBannerProps) {
  const isSuccess = variant === "success";

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-3 text-[13px] font-medium",
        isSuccess
          ? "border-[#86EFAC] bg-[#DCFCE7] text-[#166534]"
          : "border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]"
      )}
      role="status"
    >
      {isSuccess ? (
        <CheckCircle className="size-4 shrink-0 text-[#15803D]" aria-hidden />
      ) : (
        <XCircle className="size-4 shrink-0 text-[#B91C1C]" aria-hidden />
      )}
      <span>{message}</span>
    </div>
  );
}
