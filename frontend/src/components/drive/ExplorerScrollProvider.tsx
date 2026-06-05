// Human: Supplies the drive main scroll ref to explorer grid thumbnails.
// Agent: WRAPS grid in DriveCloudExplorer; VALUE is scrollElementRef from DrivePage mainScrollRef.

import type { ReactNode, RefObject } from "react";
import { ExplorerScrollContext } from "@/components/drive/explorer-scroll-context";

type ExplorerScrollProviderProps = {
  scrollElementRef: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function ExplorerScrollProvider({
  scrollElementRef,
  children,
}: ExplorerScrollProviderProps) {
  return (
    <ExplorerScrollContext.Provider value={scrollElementRef}>
      {children}
    </ExplorerScrollContext.Provider>
  );
}
