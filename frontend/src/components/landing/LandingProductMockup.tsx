// Human: Hero product mockup — sidebar + Secure Vault cards from Pencil Mockup Browser frame.
// Agent: RENDERS decorative UI only; no live drive data.

import {
  FileText,
  FolderLock,
  HardDrive,
  Lock,
  Receipt,
  Settings,
  Shield,
  Users,
} from "lucide-react";

const sidebarItems = [
  { label: "My Drive", icon: HardDrive, active: false },
  { label: "Secure Vault", icon: Shield, active: true },
  { label: "Shared Files", icon: Users, active: false },
  { label: "Settings", icon: Settings, active: false },
] as const;

const vaultCards = [
  {
    title: "Financial Vault",
    meta: "12 files • 148 MB",
    icon: FolderLock,
  },
  {
    title: "Personal ID & Docs",
    meta: "4 files • 12 MB",
    icon: FileText,
  },
  {
    title: "Tax Archives 2025",
    meta: "36 files • 480 MB",
    icon: Receipt,
  },
] as const;

export function LandingProductMockup() {
  return (
    <div className="w-full max-w-[960px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA]">
      <div className="flex min-h-[500px]">
        {/* Human: Mock sidebar — active row uses secondary fill per Pencil Menu Row Secure Vault */}
        <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r border-[#E5E7EB] bg-white p-6 sm:flex">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 ${
                  item.active ? "bg-[#F7F8FA] font-semibold text-[#1A1A1A]" : "text-[#666666]"
                }`}
              >
                <Icon className={`size-4 ${item.active ? "text-[#2563EB]" : "text-[#666666]"}`} aria-hidden />
                <span className="text-sm">{item.label}</span>
              </div>
            );
          })}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-bold text-[#1A1A1A]">Secure Vault</h3>
            <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-1.5">
              <Lock className="size-3 text-[#2563EB]" aria-hidden />
              <span className="text-xs font-bold text-[#2563EB]">FULLY ENCRYPTED</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {vaultCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-[0_4px_12px_#00000008]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-[#EFF6FF]">
                      <Icon className="size-4 text-[#2563EB]" aria-hidden />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[15px] font-bold text-[#1A1A1A]">{card.title}</p>
                    <p className="text-xs text-[#888888]">{card.meta}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
