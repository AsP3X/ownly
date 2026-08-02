// Human: Form panel for one wizard step — heading, mobile step line, fields, and the actions row.
// Agent: WRAPS children in a <form> when onSubmit is given so Enter advances the wizard.

import type { FormEvent, ReactNode } from "react";
import { SetupStepProgress } from "@/components/setup/SetupStepProgress";
import { setupStepMeta } from "@/components/setup/setup-steps";

type SetupFormCardProps = {
  children: ReactNode;
  currentStep: number;
  /** Human: Connection test results for the storage and database steps. */
  statusBanner?: ReactNode;
  /** Human: The back/continue row — pinned to the bottom of the viewport on phones. */
  actions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

export function SetupFormCard({
  children,
  currentStep,
  statusBanner,
  actions,
  onSubmit,
}: SetupFormCardProps) {
  const meta = setupStepMeta(currentStep);

  const body = (
    <>
      {/* Agent: overflow-hidden lives here, NOT on an ancestor of the sticky actions bar. */}
      <div className="overflow-hidden border-y border-edge bg-panel sm:rounded-lg sm:border">
        <div className="flex flex-col gap-3 border-b border-edge px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-[15px] font-semibold tracking-tight text-ink">{meta.title}</h1>
            <p className="text-[13px] leading-relaxed text-ink-muted">{meta.blurb}</p>
          </div>
          {statusBanner}
        </div>

        <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">{children}</div>
      </div>

      {actions ? (
        // Human: Every step's primary action stays in reach on a phone instead of below a long form.
        // Agent: sticky + safe-area inset under sm; a plain row inside the panel from sm up.
        <div
          className={[
            // Agent: NO -mx-4 here — the outer wrapper already bleeds to the screen edges;
            // doubling it pushed this row 16px past both edges and scrolled the whole page sideways.
            "sticky bottom-0 z-10 border-t border-edge bg-panel px-4 py-3",
            "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            "sm:static sm:-mt-px sm:rounded-b-lg sm:border sm:border-edge sm:bg-surface sm:px-5 sm:py-3.5 sm:pb-3.5",
          ].join(" ")}
        >
          {actions}
        </div>
      ) : null}
    </>
  );

  return (
    // Human: -mx-4 lets the panel meet the screen edges on phones, buying back gutter width for inputs.
    <div className="-mx-4 flex flex-col gap-4 sm:mx-0 sm:gap-5">
      <div className="px-4 sm:px-0">
        <SetupStepProgress currentStep={currentStep} />
      </div>

      {onSubmit ? (
        <form onSubmit={onSubmit} noValidate>
          {body}
        </form>
      ) : (
        body
      )}
    </div>
  );
}
