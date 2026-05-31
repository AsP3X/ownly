// Human: Two-column shell for unlocked public shares — header, main slot, and Pencil sidebar.
// Agent: RENDERS PublicShareHeader + PublicShareSidebar; children hold list or inline preview panels.

import type { ReactNode } from "react";
import type { PublicShareInfo } from "@/api/client";
import { PublicShareHeader } from "@/components/public-share/PublicShareHeader";
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
  return (
    <div className="flex min-h-screen flex-col bg-[#F7F8FA] text-[#1A1A1A]">
      <PublicShareHeader
        downloadLabel={downloadLabel}
        onDownload={onDownload}
        onSave={onSave}
        downloadDisabled={downloadDisabled}
        downloadLoading={downloadLoading}
        saveDisabled={saveDisabled}
        saveLoading={saveLoading}
      />

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-6 py-8 lg:flex-row lg:px-12 lg:py-12">
        <div className="min-w-0 flex-1">{children}</div>
        <PublicShareSidebar overview={overview} />
      </div>
    </div>
  );
}
