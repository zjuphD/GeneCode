import { beforeEach, describe, expect, it } from "vitest";
import { repairStoredMeltingTempPreference } from "../src/utils/useMeltingTemp.js";

describe("melting-temperature preference migration", () => {
  beforeEach(() => window.localStorage.clear());

  it("removes an empty legacy value before the JSON storage hook reads it", () => {
    window.localStorage.setItem("showMeltingTemp", "");

    expect(repairStoredMeltingTempPreference()).toBe(true);
    expect(window.localStorage.getItem("showMeltingTemp")).toBeNull();
  });

  it("preserves valid boolean preferences", () => {
    window.localStorage.setItem("showMeltingTemp", "true");

    expect(repairStoredMeltingTempPreference()).toBe(false);
    expect(window.localStorage.getItem("showMeltingTemp")).toBe("true");
  });

  it("removes parseable values with the wrong type", () => {
    window.localStorage.setItem("showMeltingTemp", '"yes"');

    expect(repairStoredMeltingTempPreference()).toBe(true);
    expect(window.localStorage.getItem("showMeltingTemp")).toBeNull();
  });
});
