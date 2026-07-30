// Human: Scores a password against the rules the register form advertises, for the live strength meter.
// Agent: PURE; no zxcvbn dependency — score 0..4 derived from the same requirements shown in the UI.

export type PasswordRequirementId = "length" | "case" | "digit" | "symbol";

export type PasswordRequirement = {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
};

export type PasswordStrength = {
  /** 0 (empty) … 4 (strong) — drives the segment meter. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  requirements: PasswordRequirement[];
  /** Human: The one rule the API actually enforces. */
  meetsMinimum: boolean;
};

/** Human: Minimum the backend accepts — mirrored here so the meter and the submit check agree. */
export const PASSWORD_MIN_LENGTH = 8;

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

// Human: Score a password for the meter and the requirement checklist.
// Agent: RETURNS stable requirement order (length, case, digit, symbol); score never exceeds 1 below minimum length.
export function scorePassword(password: string): PasswordStrength {
  const requirements: PasswordRequirement[] = [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "case",
      label: "Upper and lowercase letters",
      met: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    { id: "digit", label: "A number", met: /\d/.test(password) },
    { id: "symbol", label: "A symbol", met: /[^A-Za-z0-9]/.test(password) },
  ];

  if (password.length === 0) {
    return { score: 0, label: STRENGTH_LABELS[0], requirements, meetsMinimum: false };
  }

  const met = requirements.filter((requirement) => requirement.met).length;
  // Human: A long passphrase earns credit even without symbols or digits.
  const lengthBonus = password.length >= 16 ? 1 : 0;
  let score = Math.min(4, met + lengthBonus);

  // Human: Below the enforced minimum nothing may read better than "Weak".
  if (password.length < PASSWORD_MIN_LENGTH) score = Math.min(score, 1);
  // Human: Never show an empty meter for a non-empty password.
  score = Math.max(1, score) as PasswordStrength["score"];

  return {
    score: score as PasswordStrength["score"],
    label: STRENGTH_LABELS[score],
    requirements,
    meetsMinimum: password.length >= PASSWORD_MIN_LENGTH,
  };
}
