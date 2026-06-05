// Human: Desktop vs narrow viewport for Excel spreadsheet preview (wide layout required).
// Agent: READS min-width 1024px MQ; SKIPS xlsx load on mobile where preview is unsupported.

import { useEffect, useState } from "react";
import { EXCEL_DESKTOP_MIN_WIDTH_PX } from "@/components/drive/excel/excel-dialog-scale";

function readIsDesktopExcelViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(`(min-width: ${EXCEL_DESKTOP_MIN_WIDTH_PX}px)`).matches;
}

// Human: True when the Excel dialog should render the full spreadsheet workspace.
// Agent: LISTENS matchMedia + resize; DEFERS reads on Safari orientationchange.
export function useIsDesktopExcelViewport(enabled = true): boolean {
  const [isDesktop, setIsDesktop] = useState(readIsDesktopExcelViewport);

  useEffect(() => {
    if (!enabled) return;

    const desktopMq = window.matchMedia(`(min-width: ${EXCEL_DESKTOP_MIN_WIDTH_PX}px)`);
    let orientationTimer: number | undefined;

    const apply = () => setIsDesktop(desktopMq.matches);

    const applyDeferred = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(apply);
      });
      if (orientationTimer !== undefined) {
        window.clearTimeout(orientationTimer);
      }
      orientationTimer = window.setTimeout(apply, 150);
    };

    desktopMq.addEventListener("change", applyDeferred);
    window.addEventListener("resize", applyDeferred);
    window.addEventListener("orientationchange", applyDeferred);
    apply();

    return () => {
      desktopMq.removeEventListener("change", applyDeferred);
      window.removeEventListener("resize", applyDeferred);
      window.removeEventListener("orientationchange", applyDeferred);
      if (orientationTimer !== undefined) window.clearTimeout(orientationTimer);
    };
  }, [enabled]);

  return isDesktop;
}
