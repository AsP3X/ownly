// Human: Full-width primary CTA for auth forms — blue fill per accent-primary (#2563EB) in the design file.
// Agent: RENDERS native button; disabled when loading; no API calls.

import { cn } from "@/lib/utils";

type AuthSubmitButtonProps = {
  children: string;
  loading?: boolean;
  loadingLabel?: string;
};

export function AuthSubmitButton({ children, loading, loadingLabel }: AuthSubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cn(
        "flex h-11 w-full items-center justify-center rounded-lg bg-[#2563EB] px-4 text-sm font-bold text-white",
        "transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
      )}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
