// Human: Mime-based icon tint backgrounds for public share file rows — matches Pencil list row colors.
// Agent: READS mime_type string; RETURNS Tailwind class fragments for icon frame + lucide color.

export function publicShareIconFrameClass(mimeType: string | null, isFolder: boolean): string {
  if (isFolder) return "bg-[#D9770615] text-[#D97706]";
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return "bg-[#2563EB15] text-[#2563EB]";
  if (mime.includes("pdf")) return "bg-[#EF444415] text-[#EF4444]";
  if (mime.startsWith("audio/")) return "bg-[#9333EA15] text-[#9333EA]";
  if (mime.startsWith("image/")) return "bg-[#2563EB15] text-[#2563EB]";
  if (mime.includes("zip") || mime.includes("compressed")) return "bg-[#9333EA15] text-[#9333EA]";
  return "bg-[#F7F8FA] text-[#2563EB]";
}
