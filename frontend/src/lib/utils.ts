// Human: Merge Tailwind class names safely — resolves conflicts when composing shadcn variants with callers.
// Agent: CALLS clsx then twMerge; USED by all ui/* components; PURE function.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
