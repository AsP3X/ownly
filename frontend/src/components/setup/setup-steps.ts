// Human: Shared metadata for the four first-run steps — labels and what each step actually does.
// Agent: SINGLE SOURCE for SetupPage, SetupStepList and SetupStepProgress; order matches Step.

export type SetupStepNumber = 1 | 2 | 3 | 4;

export type SetupStepMeta = {
  step: SetupStepNumber;
  /** Human: Short label for the step list and the mobile "Step 2 of 4 · Instance" line. */
  label: string;
  /** Human: Panel heading for the step. */
  title: string;
  /** Human: What this step configures. Factual — the admin already installed the software. */
  blurb: string;
};

export const SETUP_STEPS: SetupStepMeta[] = [
  {
    step: 1,
    label: "Administrator",
    title: "Administrator account",
    blurb:
      "The setup token authorises this wizard. The account you create here becomes the instance owner.",
  },
  {
    step: 2,
    label: "Instance",
    title: "Instance settings",
    blurb: "The display name for this instance, and whether people can sign themselves up.",
  },
  {
    step: 3,
    label: "Storage",
    title: "Object storage",
    blurb: "The Nebular OS endpoint that holds file data, and the default per-user quota.",
  },
  {
    step: 4,
    label: "Database",
    title: "Database connection",
    blurb: "Check that PostgreSQL is reachable, review the configuration, then finish.",
  },
];

export const SETUP_TOTAL_STEPS = SETUP_STEPS.length;

/** Human: Metadata for one step — falls back to the first step for out-of-range values. */
export function setupStepMeta(step: number): SetupStepMeta {
  return SETUP_STEPS.find((entry) => entry.step === step) ?? SETUP_STEPS[0]!;
}
