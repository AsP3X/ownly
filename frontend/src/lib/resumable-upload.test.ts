// Human: Unit tests for resumable upload session helpers on the client.
// Agent: COVERS threshold routing, direct_upload session typing, and the direct part request sequence.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  RESUMABLE_VIDEO_THRESHOLD_BYTES,
  shouldUseResumableUpload,
  uploadFileResumableBytes,
  UPLOAD_CHUNK_SIZE_BYTES,
  type ResumableServerSession,
} from "@/lib/resumable-upload";

describe("resumable upload constants", () => {
  it("uses a 32 MiB threshold before switching away from single POST uploads", () => {
    expect(RESUMABLE_UPLOAD_THRESHOLD_BYTES).toBe(32 * 1024 * 1024);
  });

  it("uses an 8 MiB threshold for video uploads", () => {
    expect(RESUMABLE_VIDEO_THRESHOLD_BYTES).toBe(8 * 1024 * 1024);
  });

  it("uses 16 MiB chunks aligned with the backend default", () => {
    expect(UPLOAD_CHUNK_SIZE_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("shouldUseResumableUpload", () => {
  it("routes large non-video files through chunked upload", () => {
    const file = new File([new Uint8Array(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1)], "big.bin", {
      type: "application/octet-stream",
    });
    expect(shouldUseResumableUpload(file)).toBe(true);
  });

  it("routes small video files through chunked upload below the global threshold", () => {
    const file = new File([new Uint8Array(RESUMABLE_VIDEO_THRESHOLD_BYTES + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    expect(shouldUseResumableUpload(file)).toBe(true);
  });

  it("keeps small non-video files on single POST upload", () => {
    const file = new File([new Uint8Array(1024)], "note.txt", { type: "text/plain" });
    expect(shouldUseResumableUpload(file)).toBe(false);
  });
});

describe("ResumableServerSession direct_upload", () => {
  it("treats missing direct_upload as false (proxy part PUT path)", () => {
    const session: ResumableServerSession = {
      session_id: "s1",
      file_id: "f1",
      chunk_size: UPLOAD_CHUNK_SIZE_BYTES,
      total_parts: 1,
      total_size: 100,
      bytes_received: 0,
      parts_received: [],
      status: "active",
      expires_at: new Date().toISOString(),
    };
    expect(Boolean(session.direct_upload)).toBe(false);
  });

  it("exposes dedup_source_file_id for instant complete without parts", () => {
    const session: ResumableServerSession = {
      session_id: "s1",
      file_id: "f1",
      chunk_size: UPLOAD_CHUNK_SIZE_BYTES,
      total_parts: 2,
      total_size: UPLOAD_CHUNK_SIZE_BYTES * 2,
      bytes_received: 0,
      parts_received: [],
      status: "active",
      expires_at: new Date().toISOString(),
      dedup_source_file_id: "existing-file",
    };
    expect(session.dedup_source_file_id).toBe("existing-file");
  });
});

/** Human: One request the client made, reduced to what the flow assertions care about. */
type RecordedCall = { method: string; url: string };

const PART_SIZE = 8;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionBody(overrides: Partial<ResumableServerSession> = {}): ResumableServerSession {
  return {
    session_id: "sess-1",
    file_id: "file-1",
    chunk_size: PART_SIZE,
    total_parts: 2,
    total_size: PART_SIZE * 2,
    bytes_received: 0,
    parts_received: [],
    status: "active",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

/**
 * Human: Stub every request the upload makes, recording the sequence.
 * Agent: `putStatus` drives the direct-PUT branch — 200 confirms, anything else forces the proxy fallback.
 */
function stubUploadFetch(options: {
  session: ResumableServerSession;
  putStatus?: number;
}): RecordedCall[] {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });

      if (method === "POST" && url.endsWith("/api/v1/uploads")) {
        return jsonResponse(options.session);
      }
      if (url.includes("/signed-url")) {
        const partNumber = Number(url.match(/\/parts\/(\d+)\//)?.[1] ?? 0);
        return jsonResponse({
          part_number: partNumber,
          upload_url: `/media/upload-staging/sess-1/${partNumber}?signature=test`,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          content_type: "application/octet-stream",
          expected_bytes: PART_SIZE,
          confirm_token: `tok-${partNumber}`,
        });
      }
      if (url.includes("/media/upload-staging/")) {
        return new Response("", { status: options.putStatus ?? 200 });
      }
      if (url.includes("/confirm")) {
        return jsonResponse({ part_number: 0, bytes_received: PART_SIZE, total_size: PART_SIZE * 2 });
      }
      if (url.includes("/complete")) {
        return jsonResponse({
          file: {
            id: "file-1",
            name: "big.bin",
            mime_type: "application/octet-stream",
            size_bytes: PART_SIZE * 2,
            folder_id: null,
          },
        });
      }
      // Human: Proxy part PUT — the fallback path, and the only path when direct_upload is off.
      if (method === "PUT" && /\/uploads\/[^/]+\/parts\/\d+$/.test(url)) {
        return jsonResponse({ ok: true });
      }
      return new Response("not mocked", { status: 404 });
    }),
  );

  return calls;
}

function bigFile(): File {
  return new File([new Uint8Array(PART_SIZE * 2)], "big.bin", {
    type: "application/octet-stream",
  });
}

/**
 * Human: The steps one part went through, in the order the client issued them.
 * Agent: Parts run concurrently, but the calls *within* one part are strictly ordered.
 */
function partSequence(calls: RecordedCall[], partNumber: number): string[] {
  const steps: string[] = [];
  for (const call of calls) {
    if (call.url.includes(`/media/upload-staging/sess-1/${partNumber}`)) {
      steps.push("storage-put");
    } else if (call.url.includes(`/parts/${partNumber}/signed-url`)) {
      steps.push("signed-url");
    } else if (call.url.includes(`/parts/${partNumber}/confirm`)) {
      steps.push("confirm");
    } else if (call.method === "PUT" && call.url.endsWith(`/parts/${partNumber}`)) {
      steps.push("proxy-put");
    }
  }
  return steps;
}

describe("uploadFileResumableBytes direct upload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints a signed URL, PUTs the bytes to storage, then confirms each part", async () => {
    const calls = stubUploadFetch({ session: sessionBody({ direct_upload: true }) });

    const file = await uploadFileResumableBytes(bigFile(), {
      folderId: null,
      // Human: Supplied so the helper skips content hashing, which needs crypto.subtle.
      contentHash: "hash",
    });

    expect(file.id).toBe("file-1");
    expect(calls[0]).toEqual({ method: "POST", url: "/api/v1/uploads" });
    expect(calls.at(-1)?.url).toContain("/uploads/sess-1/complete");

    // Human: Both parts take the direct route in order, and neither falls back to the proxy endpoint.
    for (const partNumber of [0, 1]) {
      expect(partSequence(calls, partNumber)).toEqual(["signed-url", "storage-put", "confirm"]);
    }
    expect(calls.some((call) => /\/uploads\/sess-1\/parts\/\d+$/.test(call.url))).toBe(false);
  });

  it("falls back to the proxy part PUT when the storage PUT is rejected", async () => {
    const calls = stubUploadFetch({
      session: sessionBody({ direct_upload: true, total_parts: 1, total_size: PART_SIZE }),
      putStatus: 502,
    });

    await uploadFileResumableBytes(
      new File([new Uint8Array(PART_SIZE)], "big.bin", { type: "application/octet-stream" }),
      { folderId: null, contentHash: "hash" },
    );

    // Human: A dead direct path must not confirm — the bytes go through Ownly instead.
    expect(calls.some((call) => call.url.includes("/confirm"))).toBe(false);
    expect(
      calls.some((call) => call.method === "PUT" && call.url.endsWith("/uploads/sess-1/parts/0")),
    ).toBe(true);
  });

  it("skips signed URLs entirely when the session is not direct_upload", async () => {
    const calls = stubUploadFetch({
      session: sessionBody({ direct_upload: false, total_parts: 1, total_size: PART_SIZE }),
    });

    await uploadFileResumableBytes(
      new File([new Uint8Array(PART_SIZE)], "big.bin", { type: "application/octet-stream" }),
      { folderId: null, contentHash: "hash" },
    );

    expect(calls.some((call) => call.url.includes("/signed-url"))).toBe(false);
    expect(
      calls.some((call) => call.method === "PUT" && call.url.endsWith("/uploads/sess-1/parts/0")),
    ).toBe(true);
  });

  it("completes immediately when the server reports a dedup match", async () => {
    const calls = stubUploadFetch({
      session: sessionBody({ direct_upload: true, dedup_source_file_id: "existing-file" }),
    });

    await uploadFileResumableBytes(bigFile(), { folderId: null, contentHash: "hash" });

    // Human: The bytes are already stored — no part traffic at all, just create then complete.
    expect(calls.some((call) => call.url.includes("/parts/"))).toBe(false);
    expect(calls.at(-1)?.url).toContain("/uploads/sess-1/complete");
  });
});
