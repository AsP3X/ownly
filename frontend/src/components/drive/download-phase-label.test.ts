// Human: Tray wording for zip jobs — the "N of M files" readout and its fallbacks.
// Agent: phaseLabel is pure; DownloadJob is built inline so no manager state is needed.

import { describe, expect, it } from "vitest";

import { phaseLabel } from "./DownloadTransferPanel";
import type { DownloadJob } from "@/lib/download-manager";

function job(overrides: Partial<DownloadJob>): DownloadJob {
  return {
    id: "job-1",
    kind: "folder",
    label: "archive.zip",
    sizeBytes: 0,
    progress: 0,
    phase: "processing",
    indeterminate: false,
    status: "downloading",
    method: null,
    ...overrides,
  } as DownloadJob;
}

describe("phaseLabel — zip compression", () => {
  it("reports how many members are compressed out of the total", () => {
    expect(phaseLabel(job({ filesDone: 12, filesTotal: 40 }))).toBe(
      "Compressing folder… 12 of 40 files",
    );
  });

  it("uses the same readout for multi-file selections", () => {
    expect(phaseLabel(job({ kind: "bulk", filesDone: 3, filesTotal: 9 }))).toBe(
      "Compressing files… 3 of 9 files",
    );
  });

  it("starts at zero rather than hiding the total", () => {
    // Human: The denominator is published before the first member is written, so the user sees
    // the size of the job immediately instead of a bare spinner.
    expect(phaseLabel(job({ filesDone: 0, filesTotal: 40 }))).toBe(
      "Compressing folder… 0 of 40 files",
    );
  });

  it("singularises a one-file archive", () => {
    expect(phaseLabel(job({ filesDone: 0, filesTotal: 1 }))).toBe(
      "Compressing folder… 0 of 1 file",
    );
  });

  it("never claims more members than the archive holds", () => {
    // Human: Guards a stale poll arriving after the total shrank.
    expect(phaseLabel(job({ filesDone: 99, filesTotal: 40 }))).toBe(
      "Compressing folder… 40 of 40 files",
    );
  });

  it("falls back to percent while the entry list is still resolving", () => {
    // Human: files_total is 0 until the server has walked the folder tree.
    expect(phaseLabel(job({ filesTotal: 0, progress: 25 }))).toBe(
      "Compressing folder… 25%",
    );
  });

  it("falls back to a bare label when nothing is known yet", () => {
    expect(phaseLabel(job({ progress: 0 }))).toBe("Compressing folder…");
  });

  it("leaves single-file downloads unchanged", () => {
    expect(phaseLabel(job({ kind: "file", progress: 40 }))).toBe("Preparing file… 40%");
  });

  it("does not show counts once compression is done", () => {
    expect(phaseLabel(job({ phase: "saving", filesDone: 40, filesTotal: 40 }))).toBe(
      "Saving…",
    );
    expect(phaseLabel(job({ phase: "downloading", filesDone: 40, filesTotal: 40 }))).toBe(
      "Downloading…",
    );
  });
});
