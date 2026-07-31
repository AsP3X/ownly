// Human: Password input for setup — show/hide toggle plus the rules the API enforces, listed plainly.
// Agent: WRAPS SetupField; READS scorePassword() for the requirement list; no meter, no animation.

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { scorePassword } from "@/lib/password-strength";
import { SetupField } from "@/components/setup/SetupField";
import { cn } from "@/lib/utils";

type SetupPasswordFieldProps = {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string | null;
  /** Human: Show the requirement checklist under the control (creation fields only). */
  showRequirements?: boolean;
  hint?: string;
};

export function SetupPasswordField({
  label,
  id,
  value,
  onChange,
  autoComplete,
  error,
  showRequirements,
  hint,
}: SetupPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const { requirements } = scorePassword(value);

  return (
    <div className="flex flex-col gap-1.5">
      <SetupField
        id={id}
        label={label}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        error={error}
        hint={hint}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((prev) => !prev)}
            // Human: -mr-1.5 pulls the 40px tap target into the field padding without widening the box.
            className="-mr-1.5 flex size-10 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none sm:size-8"
            aria-label={visible ? "Hide password" : "Show password"}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        }
      />

      {/* Human: Rules stay visible while typing so a rejected password is never a surprise. */}
      {showRequirements ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {requirements.map((requirement) => (
            <li
              key={requirement.id}
              className={cn(
                "flex items-center gap-1.5",
                requirement.met ? "text-ok" : "text-ink-faint",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  requirement.met ? "bg-ok" : "bg-edge-strong",
                )}
                aria-hidden
              />
              {requirement.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
