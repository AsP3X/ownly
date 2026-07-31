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
          ? "border-ok/40 bg-ok-weak text-ok"
          : "border-danger/40 bg-danger-weak text-danger"
      )}
      role="status"
    >
      {isSuccess ? (
        <CheckCircle className="size-4 shrink-0 text-ok" aria-hidden />
      ) : (
        <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
      )}
      <span>{message}</span>
    </div>
  );
}
