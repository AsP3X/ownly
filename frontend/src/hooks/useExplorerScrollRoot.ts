// Human: Read the explorer scroll container ref from ExplorerScrollProvider.
// Agent: RETURNS RefObject for IntersectionObserver root in thumbnail hooks.

import { useContext } from "react";
import { ExplorerScrollContext } from "@/components/drive/explorer-scroll-context";

export function useExplorerScrollRoot() {
  return useContext(ExplorerScrollContext);
}
