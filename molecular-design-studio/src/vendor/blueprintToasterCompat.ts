import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

type ToastKey = string;

interface BlueprintToasterInstance {
  show: (toast: unknown, key?: ToastKey) => ToastKey;
  dismiss: (key: ToastKey) => void;
  clear: () => void;
  getToasts: () => unknown[];
}

type BlueprintToasterComponent = ComponentType<Record<string, unknown>>;

let nextToastKey = 1;

/**
 * React 18 replacement for Blueprint v3's `Toaster.create()`.
 *
 * Blueprint v3 mounts its global toaster with `ReactDOM.render`, which emits
 * two legacy-root warnings as soon as `@teselagen/ui` is imported.  The OVE
 * dependency still expects the imperative Blueprint toaster contract, so this
 * adapter keeps that API while mounting with `createRoot`.
 *
 * `createRoot().render()` is intentionally asynchronous. Calls made before
 * the class-component ref is available are queued; `show()` reserves and
 * returns a stable key immediately, matching Blueprint's public contract.
 */
export function createReact18BlueprintToaster(
  ToasterComponent: BlueprintToasterComponent,
  props: Record<string, unknown>,
  container: HTMLElement = document.body,
): BlueprintToasterInstance {
  const mountNode = document.createElement("div");
  mountNode.dataset.genecodeBlueprintToaster = "true";
  container.appendChild(mountNode);

  let instance: BlueprintToasterInstance | null = null;
  const pending: Array<(toaster: BlueprintToasterInstance) => void> = [];
  const invoke = (operation: (toaster: BlueprintToasterInstance) => void) => {
    if (instance) operation(instance);
    else pending.push(operation);
  };

  const root = createRoot(mountNode);
  root.render(createElement(ToasterComponent, {
    ...props,
    usePortal: false,
    ref: (value: BlueprintToasterInstance | null) => {
      if (!value) return;
      instance = value;
      pending.splice(0).forEach((operation) => operation(value));
    },
  }));

  return {
    show(toast, key = `genecode-toast-${nextToastKey++}`) {
      invoke((toaster) => toaster.show(toast, key));
      return key;
    },
    dismiss(key) {
      invoke((toaster) => toaster.dismiss(key));
    },
    clear() {
      invoke((toaster) => toaster.clear());
    },
    getToasts() {
      return instance?.getToasts() ?? [];
    },
  };
}
