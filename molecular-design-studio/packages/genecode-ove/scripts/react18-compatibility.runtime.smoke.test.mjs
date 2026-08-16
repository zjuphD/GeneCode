import { describe, it } from "vitest";

describe("React 18 runtime compatibility", () => {
  it("mounts Reflex without legacy ReactDOM warnings", async () => {
    await import("../src/Reflex/react18-compatibility.runtime.smoke.mjs");
  });
});
