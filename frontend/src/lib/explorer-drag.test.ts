import type { DragEvent } from "react";
import { describe, expect, it } from "vitest";
import { parseBreadcrumbDropTarget, readExplorerDragPayload } from "@/lib/explorer-drag";

describe("explorer-drag", () => {
  it("parses breadcrumb root token as null parent", () => {
    expect(parseBreadcrumbDropTarget("root")).toBeNull();
    expect(parseBreadcrumbDropTarget(undefined)).toBeNull();
  });

  it("prefers active drag session over DataTransfer MIME", () => {
    const event = {
      dataTransfer: {
        getData: (mime: string) =>
          mime === "application/x-ownly-folder-id" ? "folder-1" : "",
      },
    } as unknown as DragEvent<HTMLButtonElement>;

    expect(
      readExplorerDragPayload(event, { kind: "file", id: "file-1" }),
    ).toEqual({
      kind: "file",
      id: "file-1",
    });
  });
});
