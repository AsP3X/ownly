// Human: Title + description + toggle capsule row from Pencil instance config step.
// Agent: WRAPS Switch with Pencil dimensions (40×24); READS checked/onCheckedChange from parent.

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SetupToggleRowProps = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function SetupToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SetupToggleRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", disabled && "opacity-50")}>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-[#1A1A1A]">{title}</span>
        <span className="text-xs text-[#888888]">{description}</span>
      </div>
      {/* Human: Override default Switch sizing to match Pencil Toggle Capsule (40×24). */}
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="h-6 w-10 data-checked:bg-[#1A1A1A] data-unchecked:bg-[#E5E7EB] [&_[data-slot=switch-thumb]]:size-5"
      />
    </div>
  );
}
