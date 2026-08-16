import React from "react";
import { Provider } from "react-redux";
import makeStore from "./makeStore";
import { createRoot } from "react-dom/client";

import Editor from "../Editor";
import updateEditor from "../updateEditor";
import addAlignment from "../addAlignment";
import AlignmentView from "../AlignmentView";
import sizeMe from "react-sizeme";
import VersionHistoryView from "../VersionHistoryView";

// These registries make otherwise silent integration mistakes deterministic.
// A Redux store can host multiple editors, but each editorName/storeKey pair
// must belong to only one live vector editor at a time.
const storeClaims = new WeakMap();
const mountedRoots = new WeakMap();

const normalizeIdentity = (value, fallback, label) => {
  const normalized = String(value == null ? fallback : value).trim();
  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return normalized;
};

const claimStoreIdentity = (store, { editorName, storeKey }) => {
  const claims = storeClaims.get(store) || [];
  const conflict = claims.find(
    claim =>
      claim.editorName === editorName || claim.storeKey === storeKey
  );
  if (conflict) {
    throw new Error(
      `OVE editor identity conflict: editorName "${editorName}" and storeKey "${storeKey}" ` +
        `are already in use by "${conflict.editorName}"`
    );
  }
  const claim = { editorName, storeKey };
  storeClaims.set(store, [...claims, claim]);
  return () => {
    const remaining = (storeClaims.get(store) || []).filter(
      current => current !== claim
    );
    if (remaining.length) storeClaims.set(store, remaining);
    else storeClaims.delete(store);
  };
};

const assertStore = store => {
  if (
    !store ||
    typeof store.getState !== "function" ||
    typeof store.dispatch !== "function"
  ) {
    throw new TypeError(
      "OVE store must expose Redux getState() and dispatch() methods"
    );
  }
  return store;
};

const assertMountNode = node => {
  if (!node || typeof node !== "object") {
    throw new TypeError("OVE mount node must be a DOM element");
  }
  if (mountedRoots.has(node)) {
    throw new Error(
      "OVE mount node is already in use; close the existing editor before reusing it"
    );
  }
  return node;
};

const mount = (node, element) => {
  assertMountNode(node);
  const root = createRoot(node);
  mountedRoots.set(node, root);
  try {
    root.render(element);
  } catch (error) {
    mountedRoots.delete(node);
    root.unmount();
    throw error;
  }
  return root;
};

const unmount = (node, root) => {
  if (!root) return;
  try {
    root.unmount();
  } finally {
    if (mountedRoots.get(node) === root) mountedRoots.delete(node);
  }
};

const createViewStore = (name, providedStore) =>
  assertStore(providedStore || makeStore({ name }));

const attachClose = ({ editor, node, root, releaseIdentity }) => {
  let closed = false;
  editor.close = () => {
    if (closed) return;
    closed = true;
    try {
      unmount(node, root);
    } finally {
      releaseIdentity?.();
      node.remove();
    }
  };
  return editor;
};

const resolveEditorStore = ({
  providedStore,
  storeFactory,
  editorName,
  storeKey
}) => {
  if (providedStore) return assertStore(providedStore);
  if (typeof storeFactory === "function") {
    return assertStore(storeFactory({ editorName, storeKey }));
  }
  return makeStore({
    name: `createVectorEditor:${storeKey || editorName}`
  });
};

function StandaloneEditor({ store: editorStore, strictMode = false, ...props }) {
  const editorElement = <Editor {...props} />;
  return (
    <Provider store={editorStore}>
      {strictMode ? (
        <React.StrictMode>{editorElement}</React.StrictMode>
      ) : (
        editorElement
      )}
    </Provider>
  );
}

function StandaloneAlignment({ store: alignmentStore, ...props }) {
  return (
    <Provider store={alignmentStore}>
      <AlignmentView
        {...{ ...props, dimensions: { width: props.size.width } }}
      />
    </Provider>
  );
}

function StandaloneVersionHistoryView({ store: versionStore, ...props }) {
  return (
    <Provider store={versionStore}>
      <VersionHistoryView {...{ ...props }} />
    </Provider>
  );
}

export default function createVectorEditor(
  _node,
  {
    editorName = "StandaloneEditor",
    store: providedStore,
    storeFactory: providedStoreFactory,
    createStore: compatibilityStoreFactory,
    storeKey = editorName,
    strictMode = false,
    ...rest
  } = {}
) {
  editorName = normalizeIdentity(editorName, "StandaloneEditor", "editorName");
  storeKey = normalizeIdentity(storeKey, editorName, "storeKey");
  const editorStore = resolveEditorStore({
    providedStore,
    storeFactory: providedStoreFactory || compatibilityStoreFactory,
    editorName,
    storeKey
  });
  let node;

  if (_node === "createDomNodeForMe") {
    node = document.createElement("div");
    node.className = "ove-created-div";
    document.body.appendChild(node);
  } else {
    node = _node;
  }
  assertMountNode(node);
  const releaseIdentity = claimStoreIdentity(editorStore, {
    editorName,
    storeKey
  });
  const editor = {};
  let root;
  try {
    root = mount(
      node,
      <StandaloneEditor
        store={editorStore}
        {...{ editorName, strictMode, ...rest }}
      />
    );
  } catch (error) {
    releaseIdentity();
    node.remove();
    throw error;
  }
  editor.renderResponse = undefined;
  attachClose({ editor, node, root, releaseIdentity });
  editor.updateEditor = values => {
    updateEditor(editorStore, editorName, values);
  };
  editor.addAlignment = values => {
    addAlignment(editorStore, values);
  };
  editor.getState = () => {
    return editorStore.getState().VectorEditor[editorName];
  };
  editor.getStore = () => editorStore;

  return editor;
}

export function createVersionHistoryView(
  node,
  {
    editorName = "StandaloneVersionHistoryView",
    store: providedStore,
    storeKey = editorName,
    ...rest
  } = {}
) {
  editorName = normalizeIdentity(
    editorName,
    "StandaloneVersionHistoryView",
    "editorName"
  );
  storeKey = normalizeIdentity(storeKey, editorName, "storeKey");
  const viewStore = createViewStore(
    `createVersionHistoryView:${storeKey}`,
    providedStore
  );
  assertMountNode(node);
  const editor = {};
  const root = mount(
    node,
    <StandaloneVersionHistoryView
      store={viewStore}
      {...{ editorName, ...rest }}
    />
  );
  editor.renderResponse = undefined;
  attachClose({ editor, node, root });

  editor.updateEditor = values => {
    updateEditor(viewStore, editorName, values);
  };
  editor.getState = () => {
    return viewStore.getState().VectorEditor[editorName];
  };
  editor.getStore = () => viewStore;

  return editor;
}

const SizedStandaloneAlignment = sizeMe()(StandaloneAlignment);
export function createAlignmentView(node, props = {}) {
  const { store: providedStore, storeKey, ...alignmentProps } = props;
  const alignmentStoreKey = normalizeIdentity(
    storeKey,
    alignmentProps.id || "anonymous",
    "storeKey"
  );
  const viewStore = createViewStore(
    `createAlignmentView:${alignmentStoreKey}`,
    providedStore
  );
  assertMountNode(node);
  const editor = {};
  const root = mount(
    node,
    <SizedStandaloneAlignment store={viewStore} {...alignmentProps} />
  );
  editor.renderResponse = undefined;
  attachClose({ editor, node, root });

  editor.updateAlignment = values => {
    addAlignment(viewStore, values);
  };
  editor.updateAlignment(alignmentProps);
  editor.getState = () => {
    if (!alignmentProps.id) {
      throw new Error(
        'Please pass an id when using createAlignmentView. eg createAlignmentView(myDiv, {id: "someUniqueId"})'
      );
    }
    return viewStore.getState().VectorEditor.__allEditorsOptions.alignments[
      alignmentProps.id
    ];
  };
  editor.getStore = () => viewStore;
  return editor;
}

window.createVectorEditor = createVectorEditor;
window.createAlignmentView = createAlignmentView;
window.createVersionHistoryView = createVersionHistoryView;
