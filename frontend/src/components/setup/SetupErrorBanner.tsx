// Human: Inline validation/error banner for wizard steps — reuses Pencil error palette.
// Agent: DISPLAYS parent error string; hidden when empty.

import { XCircle } from "lucide-react";

type SetupErrorBannerProps = {
  message: string;
};

export function SetupErrorBanner({ message }: SetupErrorBannerProps) {
  if (!message) return null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-[#FCA5A5] bg-[#FEE2E2] px-3 py-3 text-[13px] font-medium text-[#991B1B]"
      role="alert"
    >
      <XCircle className="size-4 shrink-0 text-[#B91C1C]" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
