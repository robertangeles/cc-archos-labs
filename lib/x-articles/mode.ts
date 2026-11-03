export type XMode = "off" | "draft" | "publish";

// What the runner really does for a configured mode. Publish only runs on Render:
// DEV holds a clone of PROD data and X has no delete call, so anywhere else it runs
// as Draft. Kept here, not in run.ts, so the health check reports the same answer
// without loading the runner's image and X dependencies.
export function effectiveXMode(mode: XMode): XMode {
  return mode === "publish" && process.env.RENDER !== "true" ? "draft" : mode;
}
