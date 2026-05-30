// Human: Ownly wordmark row — cloud icon + label from Pencil Landing Header / Footer.
// Agent: RENDERS static brand mark; no routing.

import { Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

type LandingBrandLogoProps = {
  size?: "md" | "sm";
  className?: string;
};

export function LandingBrandLogo({ size = "md", className }: LandingBrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Cloud
        className={cn("shrink-0 text-[#2563EB]", size === "md" ? "size-6" : "size-5")}
        aria-hidden
      />
      <span className={cn("font-bold text-[#1A1A1A]", size === "md" ? "text-lg" : "text-base")}>
        Ownly
      </span>
    </div>
  );
}
