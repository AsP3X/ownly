import { describe, expect, it } from "vitest";
import {
  AUTH_SCENE_THEME_IDS,
  resolveAuthSceneTheme,
  themeIdForTimeOfDay,
} from "@/lib/auth-scene-themes";

describe("auth scene themes", () => {
  it("registers at least the default aurora family of themes", () => {
    expect(AUTH_SCENE_THEME_IDS).toEqual(
      expect.arrayContaining(["aurora", "sunset", "ocean", "mist", "forest"]),
    );
  });

  it("falls back to aurora for unknown theme ids", () => {
    const theme = resolveAuthSceneTheme("not-a-real-theme");
    expect(theme.id).toBe("aurora");
    expect(theme.blobs.length).toBeGreaterThan(0);
  });

  it("includes morphing washes and multi-path blobs on each theme", () => {
    for (const id of AUTH_SCENE_THEME_IDS) {
      const theme = resolveAuthSceneTheme(id);
      expect(theme.blobs.length).toBeGreaterThanOrEqual(4);
      expect((theme.washes ?? []).length).toBeGreaterThanOrEqual(1);
      expect(theme.blobs.some((b) => b.morph && b.morph !== "a")).toBe(true);
      expect(theme.blobs.some((b) => (b.rotate ?? 0) !== 0)).toBe(true);
    }
  });


  it("picks a known theme for every hour of the day", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const date = new Date(2026, 0, 1, hour, 0, 0);
      const id = themeIdForTimeOfDay(date);
      expect(AUTH_SCENE_THEME_IDS).toContain(id);
    }
  });
});
