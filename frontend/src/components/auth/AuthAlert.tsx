// Human: Inline auth banner — error (shakes once), info, or success, in the drive semantic colours.
// Agent: RENDER with key={message} so a repeated failure remounts and replays the attention animation.

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthAlertProps = {
  tone?: "error" | "info" | "success";
  children: ReactNode;
};

const TONE = {
  error: {
    icon: AlertTriangle,
    shell: "border-danger/35 bg-danger-weak text-danger",
    animation: "auth-shake",
  },
  info: {
    icon: Info,
    shell: "border-brand/30 bg-brand-weak text-brand",
    animation: "auth-alert-enter",
  },
  success: {
    icon: CheckCircle2,
    shell: "border-ok/35 bg-ok-weak text-ok",
    animation: "auth-alert-enter",
  },
} as const;

export function AuthAlert({ tone = "error", children }: AuthAlertProps) {
  const { icon: Icon, shell, animation } = TONE[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium",
        shell,
        animation,
      )}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
    </div>
  );
}
