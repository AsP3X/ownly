// Human: Unit tests for connectivity-failure detection across browser wordings.
import { describe, expect, it } from "vitest";
import { isNetworkFailure, NETWORK_ERROR_MESSAGE } from "@/lib/network-errors";

describe("isNetworkFailure", () => {
  it("recognises how each browser words a dead fetch", () => {
    // Human: Chrome, Safari, Firefox — same situation, three different strings.
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
    expect(
      isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(true);
  });

  it("recognises the Chromium net error codes", () => {
    expect(isNetworkFailure(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
    expect(isNetworkFailure(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(true);
  });

  it("ignores a cancelled request — the user aborted it on purpose", () => {
    expect(isNetworkFailure(new DOMException("The operation was aborted.", "AbortError"))).toBe(
      false,
    );
  });

  it("leaves ordinary server errors alone", () => {
    expect(isNetworkFailure(new Error("Folder name is required"))).toBe(false);
    expect(isNetworkFailure(new Error(""))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure({ message: "Failed to fetch" })).toBe(false);
  });

  it("matches regardless of case", () => {
    expect(isNetworkFailure(new TypeError("FAILED TO FETCH"))).toBe(true);
  });

  it("offers copy that names the fix rather than the browser internals", () => {
    expect(NETWORK_ERROR_MESSAGE).toContain("connection");
    expect(NETWORK_ERROR_MESSAGE).not.toContain("fetch");
  });
});
