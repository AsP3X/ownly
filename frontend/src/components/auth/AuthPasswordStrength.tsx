// Human: Live password strength meter for sign-up — four segments plus the rules that are still missing.
// Agent: PURE render of scorePassword(); collapses to nothing while the field is empty.

import type { CSSProperties } from "react";
import { Check, Circle } from "lucide-react";
import { scorePassword } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

const SEGMENT_TONE: Record<number, string> = {
  1: "bg-danger",
  2: "bg-warn",
  3: "bg-brand",
  4: "bg-ok",
};

const LABEL_TONE: Record<number, string> = {
  0: "text-ink-faint",
  1: "text-danger",
  2: "text-warn",
  3: "text-brand",
  4: "text-ok",
};

export function AuthPasswordStrength({ password }: { password: string }) {
  const { score, label, requirements } = scorePassword(password);
  const open = password.length > 0;

  return (
    <div className={cn("auth-collapse", open && "auth-collapse-open")}>
      <div>
        <div className="flex flex-col gap-2 pt-2.5">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-1.5" aria-hidden>
              {[1, 2, 3, 4].map((segment) => (
                <span key={segment} className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                  {/* Human: Segments wipe in left-to-right, each a beat behind the last. */}
                  <span
                    className={cn(
                      "auth-strength-seg block h-full w-full rounded-full",
                      SEGMENT_TONE[score] ?? "bg-sunken",
                      segment <= score ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0",
                    )}
                    style={{ transitionDelay: `${(segment - 1) * 45}ms` } as CSSProperties}
                  />
                </span>
              ))}
            </div>
            <span
              className={cn(
                "w-16 text-right text-xs font-semibold transition-colors duration-200",
                LABEL_TONE[score],
              )}
              aria-live="polite"
            >
              {open ? label : ""}
            </span>
          </div>

          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {requirements.map((requirement) => (
              <li
                key={requirement.id}
                className={cn(
                  "auth-req flex items-center gap-1 text-[11px]",
                  requirement.met ? "text-ok" : "text-ink-faint",
                )}
              >
                {requirement.met ? (
                  <Check className="auth-pop size-3 shrink-0" aria-hidden />
                ) : (
                  <Circle className="size-3 shrink-0" aria-hidden />
                )}
                {requirement.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
