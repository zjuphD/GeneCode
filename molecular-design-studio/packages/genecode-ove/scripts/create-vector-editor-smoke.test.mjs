import React, { act } from "react";
import { vi } from "vitest";

const makeStore = () => ({
  state: { VectorEditor: {} },
  getState() {
    return this.state;
  },
  dispatch() {},
  subscribe() {
    return () => {};
  }
});

vi.mock("../src/createVectorEditor/makeStore.js", () => ({
  default: vi.fn(() => makeStore())
}));
vi.mock("../src/Editor/index.js", () => ({
  default: () => React.createElement("div", { "data-testid": "editor" })
}));
vi.mock("../src/AlignmentView/index.js", () => ({
  default: () => React.createElement("div", { "data-testid": "alignment" })
}));
vi.mock("../src/VersionHistoryView/index.js", () => ({
  default: () => React.createElement("div", { "data-testid": "history" })
}));
vi.mock("../src/addAlignment.js", () => ({ default: vi.fn() }));
vi.mock("../src/updateEditor.js", () => ({ default: vi.fn() }));
vi.mock("react-sizeme", () => ({
  default: () => Component => Component
}));

const { default: createVectorEditor } = await import(
  "../src/createVectorEditor/index.js"
);

describe("createVectorEditor React 18 lifecycle", () => {
  it("mounts under StrictMode and makes close idempotent", async () => {
    const node = document.createElement("div");
    document.body.appendChild(node);

    const editor = createVectorEditor(node, {
      editorName: "LifecycleEditor",
      strictMode: true
    });
    await act(async () => {});
    expect(node.querySelector('[data-testid="editor"]')).not.toBeNull();

    expect(() => {
      editor.close();
      editor.close();
    }).not.toThrow();
    expect(node.isConnected).toBe(false);
  });

  it("supports rapid close and remount on the same DOM node", () => {
    const node = document.createElement("div");
    document.body.appendChild(node);

    const first = createVectorEditor(node, { editorName: "RapidFirst" });
    first.close();

    const second = createVectorEditor(node, { editorName: "RapidSecond" });
    expect(second.getStore()).toBeDefined();
    second.close();
    expect(node.isConnected).toBe(false);
  });

  it("keeps two default editor instances isolated", () => {
    const firstNode = document.createElement("div");
    const secondNode = document.createElement("div");
    document.body.append(firstNode, secondNode);

    const first = createVectorEditor(firstNode, {
      editorName: "FirstDefault"
    });
    const second = createVectorEditor(secondNode, {
      editorName: "SecondDefault"
    });

    expect(first.getStore()).not.toBe(second.getStore());
    first.close();
    expect(secondNode.isConnected).toBe(true);
    second.close();
  });

  it("rejects editorName and storeKey collisions on one explicit store", () => {
    const store = makeStore();
    const firstNode = document.createElement("div");
    const secondNode = document.createElement("div");
    document.body.append(firstNode, secondNode);

    const first = createVectorEditor(firstNode, {
      store,
      editorName: "SharedEditor",
      storeKey: "shared-key"
    });

    expect(() =>
      createVectorEditor(secondNode, {
        store,
        editorName: "SharedEditor",
        storeKey: "different-key"
      })
    ).toThrow(/identity conflict/);

    expect(() =>
      createVectorEditor(secondNode, {
        store,
        editorName: "DifferentEditor",
        storeKey: "shared-key"
      })
    ).toThrow(/identity conflict/);

    first.close();
    expect(() =>
      createVectorEditor(secondNode, {
        store,
        editorName: "SharedEditor",
        storeKey: "shared-key"
      })
    ).not.toThrow();
  });
});
