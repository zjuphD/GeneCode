import { describe, expect, it } from "vitest";
import {
  durableStorageAvailable,
  readDurable,
  writeDurable,
} from "./durablePersistence";

describe("durable persistence", () => {
  it("is fail-safe when the test runtime has no IndexedDB", async () => {
    if (durableStorageAvailable()) return;
    expect(await readDurable("workspace")).toBeNull();
    await expect(writeDurable("workspace", { version: 1 })).resolves.toBeUndefined();
  });
});
