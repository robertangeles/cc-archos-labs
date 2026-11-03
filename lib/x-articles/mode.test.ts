import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveXMode } from "./mode";

afterEach(() => vi.unstubAllEnvs());

describe("effectiveXMode", () => {
  it.each(["off", "draft"] as const)("%s is the same on and off Render", (mode) => {
    vi.stubEnv("RENDER", "true");
    expect(effectiveXMode(mode)).toBe(mode);
    vi.stubEnv("RENDER", undefined);
    expect(effectiveXMode(mode)).toBe(mode);
  });

  it("publish stays publish only when RENDER is exactly the string true", () => {
    vi.stubEnv("RENDER", "true");
    expect(effectiveXMode("publish")).toBe("publish");
  });

  it.each([undefined, "", "1", "TRUE", "yes", " true"])("publish runs as draft when RENDER is %j", (render) => {
    vi.stubEnv("RENDER", render);
    expect(effectiveXMode("publish")).toBe("draft");
  });
});
