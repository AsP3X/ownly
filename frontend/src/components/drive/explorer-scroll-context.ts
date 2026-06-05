// Human: React context holding the My Cloud scroll container ref for lazy thumbnails.
// Agent: PROVIDED by ExplorerScrollProvider; READ by useExplorerScrollRoot / useExplorerTileVisible.

import { createContext, type RefObject } from "react";

export const ExplorerScrollContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
);
