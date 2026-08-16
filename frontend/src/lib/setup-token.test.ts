import { afterEach, describe, expect, it } from "vitest";
import {
  clearSetupToken,
  getSetupToken,
  normalizeSetupTokenInput,
  setSetupToken,
} from "@/lib/setup-token";

describe("normalizeSetupTokenInput", () => {
  it("strips whitespace, quotes, CRLF, and a pasted SETUP_TOKEN= prefix", () => {
    expect(
      normalizeSetupTokenInput(
        '  SETUP_TOKEN="ownly-compose-local-dev-setup-token-not-for-production-use"\r\n',
      ),
    ).toBe("ownly-compose-local-dev-setup-token-not-for-production-use");
    expect(
      normalizeSetupTokenInput("setup_token = hexsecret0123456789abcdef0123456789ab"),
    ).toBe("hexsecret0123456789abcdef0123456789ab");
    expect(normalizeSetupTokenInput("'quoted-setup-token-value-32-chars-min'")).toBe(
      "quoted-setup-token-value-32-chars-min",
    );
  });
});

describe("setSetupToken", () => {
  afterEach(() => {
    clearSetupToken();
  });

  it("stores the normalized value for X-Setup-Token headers", () => {
    setSetupToken("SETUP_TOKEN=operator-generated-setup-token-with-32-chars!!\n");
    expect(getSetupToken()).toBe("operator-generated-setup-token-with-32-chars!!");
  });
});
