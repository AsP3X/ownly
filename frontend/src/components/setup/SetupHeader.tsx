// Human: Setup wizard header — cloud icon, welcome copy, and four-step progress indicator from Pencil.
// Agent: READS currentStep; RENDERS active/completed/inactive badge states with connector lines.

import { Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 4;

type SetupHeaderProps = {
  currentStep: number;
  /** Human: Steps 3–4 use a slightly larger icon box (44px) per later Pencil frames. */
  compact?: boolean;
};

export function SetupHeader({ currentStep, compact = false }: SetupHeaderProps) {
  return (
    <div className={cn("flex w-full flex-col items-center", compact ? "gap-5" : "gap-4")}>
      {/* Human: Brand icon — secondary fill, primary glyph */}
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-[#F7F8FA]",
          compact ? "size-11 rounded-xl" : "size-12 rounded-lg"
        )}
      >
        <Cloud className={cn("text-[#1A1A1A]", compact ? "size-5" : "size-6")} aria-hidden />
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[28px] font-bold leading-tight text-[#1A1A1A]">Welcome to Ownly</h1>
        <p className="text-sm text-[#888888]">Configure your personal cloud storage in a few steps.</p>
      </div>

      {/* Human: Step badges — active uses inverse text on primary fill */}
      <div className="flex items-center gap-3">
        {Array.from({ length: TOTAL_STEPS }, (_, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === currentStep;
          return (
            <div key={stepNumber} className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm",
                  isActive
                    ? "bg-[#1A1A1A] font-bold text-white"
                    : "bg-[#F7F8FA] font-normal text-[#666666]"
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {stepNumber}
              </div>
              {stepNumber < TOTAL_STEPS ? <div className="h-px w-8 bg-[#E5E7EB]" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
