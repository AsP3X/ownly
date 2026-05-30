// Human: Bordered setup form card — optional step title block for storage/database steps in Pencil.
// Agent: RENDERS layout slots only; all styling via Tailwind tokens from login-signup.pencil variables.

import type { ReactNode } from "react";

type SetupFormCardProps = {
  children: ReactNode;
  stepTitle?: string;
  stepSubtitle?: string;
  /** Human: Success/error banners sit under the subtitle on the database step. */
  statusBanner?: ReactNode;
  gap?: "md" | "lg";
};

export function SetupFormCard({
  children,
  stepTitle,
  stepSubtitle,
  statusBanner,
  gap = "md",
}: SetupFormCardProps) {
  return (
    <div
      className={`flex w-full flex-col rounded-2xl border border-[#E5E7EB] bg-white p-8 ${
        gap === "lg" ? "gap-6" : "gap-5"
      }`}
    >
      {stepTitle ? (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-bold text-[#1A1A1A]">{stepTitle}</h2>
          {stepSubtitle || statusBanner ? (
            <div className="flex flex-col gap-3">
              {stepSubtitle ? <p className="text-sm text-[#666666]">{stepSubtitle}</p> : null}
              {statusBanner}
            </div>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
