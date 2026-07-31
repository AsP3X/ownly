// Human: Wide-screen step list beside the form — numbers, labels, and which step you are on.
// Agent: PURE presentational; READS SETUP_STEPS; hidden under lg where SetupStepProgress takes over.

import { Check } from "lucide-react";
import { SETUP_STEPS } from "@/components/setup/setup-steps";
import { cn } from "@/lib/utils";

type SetupStepListProps = {
  currentStep: number;
};

export function SetupStepList({ currentStep }: SetupStepListProps) {
  return (
    <ol className="hidden lg:flex lg:flex-col lg:gap-px" aria-label="Setup progress">
      {SETUP_STEPS.map((meta) => {
        const done = meta.step < currentStep;
        const active = meta.step === currentStep;

        return (
          <li key={meta.step} aria-current={active ? "step" : undefined}>
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                active ? "bg-sunken font-semibold text-ink" : "text-ink-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  done && "text-ok",
                  active && "bg-brand text-brand-on",
                  !done && !active && "border border-edge text-ink-faint",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : meta.step}
              </span>
              <span className="min-w-0 truncate">
                {meta.label}
                <span className="sr-only">
                  {done ? " (completed)" : active ? " (current step)" : " (not started)"}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
