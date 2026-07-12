// Human: Unit tests for cookie-session client hint persistence across tab closes.
// Agent: ASSERTS localStorage round-trip, clear, and legacy sessionStorage migration.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionHint,
  hasSessionHint,
  setSessionHint,
} from "@/lib/session-hint";

const SESSION_HINT_KEY = "ownly_session_hint";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("session-hint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the hint in localStorage across reads", () => {
    const localStorage = createStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", createStorage());

    expect(hasSessionHint()).toBe(false);
    setSessionHint();
    expect(hasSessionHint()).toBe(true);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
  });

  it("clears the hint from localStorage on sign-out", () => {
    const localStorage = createStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", createStorage());

    setSessionHint();
    clearSessionHint();
    expect(hasSessionHint()).toBe(false);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });

  it("migrates a legacy sessionStorage hint into localStorage", () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);

    sessionStorage.setItem(SESSION_HINT_KEY, "1");
    expect(hasSessionHint()).toBe(true);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
    expect(sessionStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });
});
