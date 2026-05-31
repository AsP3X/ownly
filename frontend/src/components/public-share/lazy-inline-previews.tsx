// Human: Code-split inline PDF/video viewers for single-file public shares.
// Agent: EXPORTS React.lazy wrappers; LOADS react-pdf/hls.js only when share page renders media.

import { lazyNamed } from "@/lib/lazy-named";

export const LazyPublicShareInlinePdf = lazyNamed(
  () => import("@/components/public-share/PublicShareInlinePdf"),
  "PublicShareInlinePdf",
);

export const LazyPublicShareInlineVideo = lazyNamed(
  () => import("@/components/public-share/PublicShareInlineVideo"),
  "PublicShareInlineVideo",
);
