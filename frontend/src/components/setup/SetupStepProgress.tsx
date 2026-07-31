// Human: Compact step line for phones and tablets — "Step 2 of 4 · Instance" over a thin rule.
// Agent: PURE presentational; replaced by SetupStepList from lg up.

import { SETUP_TOTAL_STEPS, setupStepMeta } from "@/components/setup/setup-steps";

type SetupStepProgressProps = {
  currentStep: number;
};

export function SetupStepProgress({ currentStep }: SetupStepProgressProps) {
  const meta = setupStepMeta(currentStep);
  const percent = (currentStep / SETUP_TOTAL_STEPS) * 100;

  return (
    <div className="flex flex-col gap-2 lg:hidden">
      <p className="text-xs font-medium text-ink-muted">
        Step {currentStep} of {SETUP_TOTAL_STEPS}
        <span className="text-ink-faint"> · {meta.label}</span>
      </p>
      <div
        className="h-0.5 w-full bg-sunken"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={SETUP_TOTAL_STEPS}
        aria-valuenow={currentStep}
        aria-valuetext={`Step ${currentStep} of ${SETUP_TOTAL_STEPS}: ${meta.label}`}
      >
        <div
          className="h-full bg-brand transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
