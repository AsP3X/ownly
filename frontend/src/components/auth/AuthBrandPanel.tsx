// Human: Marketing column beside the auth card on wide screens — brand, promise, and three product proofs.
// Agent: PURE presentational; copy switches on `mode`; hidden under lg where the card stands alone.

import type { CSSProperties } from "react";
import { HardDrive, ShieldCheck, Share2, Sparkles, type LucideIcon } from "lucide-react";
import { AuthBrandMark } from "@/components/auth/AuthBrandMark";

type AuthBrandPanelProps = {
  mode: "login" | "register";
};

type Highlight = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const HIGHLIGHTS: Highlight[] = [
  {
    icon: ShieldCheck,
    title: "Your files, your server",
    body: "Everything stays on storage you control — no third-party cloud in the path.",
  },
  {
    icon: HardDrive,
    title: "Built for real libraries",
    body: "Stream video, preview documents, and browse thousands of files without waiting.",
  },
  {
    icon: Share2,
    title: "Sharing with a leash",
    body: "Password-protected links that expire when you say so, revocable at any time.",
  },
];

const COPY = {
  login: {
    eyebrow: "Welcome back",
    headline: "Everything you own, exactly where you left it.",
  },
  register: {
    eyebrow: "Get started",
    headline: "Your own cloud, up and running in a minute.",
  },
} as const;

export function AuthBrandPanel({ mode }: AuthBrandPanelProps) {
  const copy = COPY[mode];

  return (
    <div className="hidden max-w-[460px] flex-col gap-10 lg:flex">
      <div className="flex flex-col gap-6">
        <AuthBrandMark size="lg" className="auth-panel-enter" />

        <div className="flex flex-col gap-3">
          <span
            className="auth-panel-enter inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/25 bg-brand-weak/70 px-3 py-1 text-xs font-semibold tracking-wide text-brand uppercase backdrop-blur-sm"
            style={{ "--auth-i": 1 } as CSSProperties}
          >
            <Sparkles className="size-3.5" aria-hidden />
            {copy.eyebrow}
          </span>
          <h2
            className="auth-panel-enter text-4xl leading-[1.15] font-bold tracking-tight text-balance text-ink"
            style={{ "--auth-i": 2 } as CSSProperties}
          >
            {copy.headline}
          </h2>
        </div>
      </div>

      <ul className="flex flex-col gap-5">
        {HIGHLIGHTS.map((highlight, index) => (
          <li
            key={highlight.title}
            className="auth-panel-enter group flex items-start gap-4"
            style={{ "--auth-i": index + 3 } as CSSProperties}
          >
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-edge/60 bg-panel/60 text-brand shadow-sm backdrop-blur-sm transition-[transform,box-shadow,background-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:bg-panel/90 group-hover:shadow-md">
              <highlight.icon className="size-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-ink">{highlight.title}</p>
              <p className="text-sm leading-relaxed text-ink-muted">{highlight.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
