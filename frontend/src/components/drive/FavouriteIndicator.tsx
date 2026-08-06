// Human: Star badge shown on files the account has favourited.
// Agent: READS a boolean from DrivePage's favouriteIds Set; MIRRORS SharedIndicator's shape.

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type FavouriteIndicatorProps = {
  favourite?: boolean;
  className?: string;
};

export function FavouriteIndicator({ favourite, className }: FavouriteIndicatorProps) {
  if (!favourite) return null;

  return (
    <span title="Starred" className={cn("inline-flex shrink-0", className)}>
      <Star className="size-3.5 fill-warn text-warn" aria-label="Starred" />
    </span>
  );
}
