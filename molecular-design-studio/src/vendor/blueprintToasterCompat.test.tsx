import React from "react";
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createReact18BlueprintToaster } from "./blueprintToasterCompat";

describe("createReact18BlueprintToaster", () => {
  it("queues imperative calls until the createRoot-mounted instance is ready", async () => {
    const calls: Array<[string, unknown?]> = [];

    class FakeToaster extends React.Component<Record<string, unknown>> {
      show(toast: unknown, key = "fake-key") {
        calls.push(["show", { toast, key }]);
        return key;
      }

      dismiss(key: string) {
        calls.push(["dismiss", key]);
      }

      clear() {
        calls.push(["clear"]);
      }

      getToasts() {
        return ["mounted"];
      }

      render() {
        return null;
      }
    }

    const container = document.createElement("div");
    let toaster!: ReturnType<typeof createReact18BlueprintToaster>;
    let key = "";
    await act(async () => {
      toaster = createReact18BlueprintToaster(
        FakeToaster,
        { className: "test" },
        container,
      );
      key = toaster.show({ message: "queued" });
      toaster.dismiss(key);
      toaster.clear();
    });

    expect(key).toMatch(/^genecode-toast-/);
    expect(container.querySelector("[data-genecode-blueprint-toaster='true']"))
      .not.toBeNull();
    await waitFor(() => expect(calls).toEqual([
      ["show", { toast: { message: "queued" }, key }],
      ["dismiss", key],
      ["clear"],
    ]));
    expect(toaster.getToasts()).toEqual(["mounted"]);
  });
});
