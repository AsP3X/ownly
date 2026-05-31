// Human: Shell for unlocked public shares — mobile promo + info sheet; desktop two-column layout.
// Agent: RENDERS PublicShareHeader + sidebar; children hold list or inline preview panels.

import { useState, type ReactNode } from "react";
import type { PublicShareInfo } from "@/api/client";
import { PublicShareHeader } from "@/components/public-share/PublicShareHeader";
import { PublicShareInfoSheet } from "@/components/public-share/PublicShareInfoSheet";
import { PublicSharePromoBanner } from "@/components/public-share/PublicSharePromoBanner";
import { PublicShareSidebar } from "@/components/public-share/PublicShareSidebar";

type PublicSharePageLayoutProps = {
  children: ReactNode;
  overview: PublicShareInfo;
  downloadLabel: string;
  onDownload: () => void;
  onSave: () => void;
  downloadDisabled?: boolean;
  downloadLoading?: boolean;
  saveDisabled?: boolean;
  saveLoading?: boolean;
};

export function PublicSharePageLayout({
  children,
  overview,
  downloadLabel,
  onDownload,
  onSave,
  downloadDisabled,
  downloadLoading,
  saveDisabled,
  saveLoading,
}: PublicSharePageLayoutProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F8FA] text-[#1A1A1A]">
      <PublicSharePromoBanner />
      <PublicShareHeader
        downloadLabel={downloadLabel}
        onDownload={onDownload}
        onSave={onSave}
        onInfoClick={() => setInfoOpen(true)}
        downloadDisabled={downloadDisabled}
        downloadLoading={downloadLoading}
        saveDisabled={saveDisabled}
        saveLoading={saveLoading}
      />

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-5 px-5 py-4 pb-8 lg:flex-row lg:gap-8 lg:px-12 lg:py-12">
        <div className="min-w-0 flex-1">{children}</div>
        <PublicShareSidebar overview={overview} />
      </div>

      <PublicShareInfoSheet overview={overview} open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  );
}
