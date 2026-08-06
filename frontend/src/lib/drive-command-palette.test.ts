// Human: Unit tests for command palette ranking and command filtering.
import { describe, expect, it } from "vitest";
import {
  filterCommandActions,
  rankByNameMatch,
  scoreNameMatch,
} from "@/lib/drive-command-palette";

describe("scoreNameMatch", () => {
  it("orders exact, prefix, word-prefix, and loose matches", () => {
    expect(scoreNameMatch("report.pdf", "report.pdf")).toBe(0);
    expect(scoreNameMatch("report-final.pdf", "report")).toBe(1);
    expect(scoreNameMatch("q3-report.pdf", "report")).toBe(2);
    expect(scoreNameMatch("myreport.pdf", "report")).toBe(3);
    expect(scoreNameMatch("invoice.pdf", "report")).toBe(4);
  });

  it("ignores case and treats an empty query as a match", () => {
    expect(scoreNameMatch("Report.PDF", "report.pdf")).toBe(0);
    expect(scoreNameMatch("anything", "")).toBe(0);
  });
});

describe("rankByNameMatch", () => {
  it("lifts the closest name above the server's alphabetical order", () => {
    const ranked = rankByNameMatch(
      [
        { name: "myreport-final-v2.pdf" },
        { name: "quarterly report.pdf" },
        { name: "report.pdf" },
      ],
      "report",
    );

    expect(ranked.map((item) => item.name)).toEqual([
      "report.pdf",
      "quarterly report.pdf",
      "myreport-final-v2.pdf",
    ]);
  });

  it("keeps the incoming order when nothing was typed", () => {
    const items = [{ name: "b" }, { name: "a" }];
    expect(rankByNameMatch(items, "")).toBe(items);
  });
});

describe("filterCommandActions", () => {
  it("offers every command before the user types", () => {
    expect(filterCommandActions("").length).toBeGreaterThan(0);
  });

  it("matches on label and on keywords", () => {
    expect(filterCommandActions("folder").map((action) => action.id)).toContain("new-folder");
    expect(filterCommandActions("trash").map((action) => action.id)).toEqual(["go-recycle-bin"]);
    expect(filterCommandActions("nothing-matches-this")).toEqual([]);
  });
});
