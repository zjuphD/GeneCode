import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import App from "./App";
import type { SequenceDocument, SequenceSelection } from "./types";
import type { PatchPreview, SequencePatch } from "./agent/patchTypes";
import type { ProjectEntry } from "./workspace/projectPersistence";
import type { DocumentHistoryEntry } from "./workspace/documentHistory";

const originalDoc: SequenceDocument = {
  name: "pUC19",
  sequence: "A".repeat(2686),
  circular: true,
  features: [],
};

const proposedDoc: SequenceDocument = {
  name: "pUC19",
  sequence: "A".repeat(2686) + "GGGG",
  circular: true,
  features: [],
};

function makePreview(overrides: Partial<PatchPreview> = {}): PatchPreview {
  return {
    patchId: "p1",
    title: "Insert MCS",
    summary: "Adds 4 bp",
    baseHash: "fnv1a64-v1:orig",
    proposedHash: "fnv1a64-v1:proposed",
    beforeLength: 2686,
    afterLength: 2690,
    operations: [
      {
        operationId: "op1",
        kind: "insert",
        coordinates: "@2686",
        reason: "add bases",
        lengthDelta: 4,
      },
    ],
    affectedFeatures: [],
    warnings: [],
    errors: [],
    proposedDocument: proposedDoc,
    ...overrides,
  };
}

// Use a direct type alias so the `fn` value binding stays unused-but-typed.
type MockFn = ReturnType<typeof vi.fn>;

/** Strongly-typed workspace mock so handlers compile against real signatures. */
interface WorkspaceMock {
  doc: SequenceDocument | null;
  isRestoring: boolean;
  filePath: string | null;
  basename: string | null;
  isDirty: boolean;
  remountKey: number;
  status: string | null;
  statusType: "success" | "error" | null;
  currentHash: string | null;
  pendingPatch: SequencePatch | null;
  pendingPreview: PatchPreview | null;
  revertDocument: SequenceDocument | null;
  selection: SequenceSelection | null;
  history: DocumentHistoryEntry[];
  redoStack: DocumentHistoryEntry[];
  setDoc: MockFn;
  setFilePath: MockFn;
  setIsDirty: MockFn;
  setStatus: MockFn;
  remountOve: MockFn;
  onOveCommit: MockFn;
  onOveError: MockFn;
  onFileOpen: MockFn;
  onSelectionChange: MockFn;
  commitDocument: MockFn;
  commitAgentDocument: MockFn;
  restoreHistoryEntry: MockFn;
  undoDocument: MockFn;
  redoDocument: MockFn;
  clearHistory: MockFn;
  replaceHistory: MockFn;
  loadPatchPreview: MockFn;
  applyPendingPatch: MockFn;
  setAgentApplyFailure: MockFn;
  rejectPendingPatch: MockFn;
  revertLastAgentChange: MockFn;
}

interface ProjectMock {
  projects: ProjectEntry[];
  activeId: string | null;
  activeProject: ProjectEntry | null;
  isRestoring: boolean;
  createProject: MockFn;
  switchProject: MockFn;
  renameProject: MockFn;
  deleteProject: MockFn;
  updateActiveState: MockFn;
  getPersistedState: MockFn;
  importPersistedState: MockFn;
  importDoc: MockFn;
  importDocs: MockFn;
}

let mockWorkspace: WorkspaceMock;
let mockProject: ProjectMock;
let capturedOnApplyAsNewFile: (() => void) | undefined;
let installBridge = true;

vi.mock("./workspace/useWorkspace", () => ({
  useWorkspace: () => mockWorkspace,
}));

vi.mock("./workspace/useProject", () => ({
  useProject: () => mockProject,
}));

vi.mock("./components/Sidebar", () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock("./components/Editor", () => {
  const EditorMock = ({
    commandBridgeRef,
  }: {
    commandBridgeRef: React.MutableRefObject<unknown | null>;
  }) => {
    useEffect(() => {
      commandBridgeRef.current = installBridge ? mockBridge : null;
    }, [commandBridgeRef]);
    return <div data-testid="editor" />;
  };
  return { default: EditorMock };
});

vi.mock("./components/AgentPanel", () => ({
  default: (props: { onApplyAsNewFile?: () => void }) => {
    capturedOnApplyAsNewFile = props.onApplyAsNewFile;
    return (
      <button
        type="button"
        data-testid="copy-action"
        onClick={props.onApplyAsNewFile}
      >
        复制为新文件并应用
      </button>
    );
  },
}));

vi.mock("./components/SettingsPanel", () => ({
  SettingsPanel: () => <div data-testid="settings" />,
}));

vi.mock("./services/sequenceFiles", () => ({
  confirmDiscardChanges: vi.fn(),
}));

vi.mock("./services/projectFiles", () => ({
  openProjectFile: vi.fn(),
  saveProjectFile: vi.fn(),
}));

vi.mock("./workspace/projectPersistence", () => ({
  parseProjectFile: vi.fn(),
  serializeProjectFile: vi.fn(),
}));

// A fake OVE bridge installed by the Editor stub.
const mockBridge = {
  previewPatch: vi.fn(),
  applyConfirmedPatch: vi.fn(),
  readCurrentState: vi.fn(() => ({
    document: originalDoc,
    selection: null,
    caretPosition: null,
  })),
};

function makeProjectEntry(name: string, doc: SequenceDocument): ProjectEntry {
  return {
    id: "proj-1",
    name,
    doc,
    filePath: null,
    isDirty: false,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function setupWorkspace(overrides: Partial<WorkspaceMock> = {}): WorkspaceMock {
  mockWorkspace = {
    doc: originalDoc,
    isRestoring: false,
    filePath: null,
    basename: null,
    isDirty: false,
    remountKey: 0,
    status: null,
    statusType: null,
    currentHash: "fnv1a64-v1:orig",
    pendingPatch: { id: "p1", baseHash: "fnv1a64-v1:orig" } as SequencePatch,
    pendingPreview: makePreview(),
    revertDocument: null,
    selection: null,
    history: [],
    redoStack: [],
    undoDocument: vi.fn(),
    redoDocument: vi.fn(),
    setDoc: vi.fn(),
    setFilePath: vi.fn(),
    setIsDirty: vi.fn(),
    setStatus: vi.fn(),
    remountOve: vi.fn(),
    onOveCommit: vi.fn(),
    onOveError: vi.fn(),
    onFileOpen: vi.fn(),
    onSelectionChange: vi.fn(),
    commitDocument: vi.fn(),
    commitAgentDocument: vi.fn(),
    restoreHistoryEntry: vi.fn(),
    clearHistory: vi.fn(),
    replaceHistory: vi.fn(),
    loadPatchPreview: vi.fn(),
    applyPendingPatch: vi.fn(),
    setAgentApplyFailure: vi.fn(),
    rejectPendingPatch: vi.fn(),
    revertLastAgentChange: vi.fn(),
    ...overrides,
  };
  return mockWorkspace;
}

function setupProject(): ProjectMock {
  const active = makeProjectEntry("pUC19", originalDoc);
  mockProject = {
    projects: [active],
    activeId: "proj-1",
    activeProject: active,
    isRestoring: false,
    createProject: vi.fn(
      (
        name: string,
        doc?: SequenceDocument,
        filePath?: string | null,
        isDirty?: boolean,
      ): ProjectEntry => ({
        ...active,
        id: "proj-2",
        name,
        doc: doc ?? active.doc,
        filePath: filePath ?? null,
        isDirty: isDirty ?? false,
        createdAt: 2,
        updatedAt: 2,
      }),
    ),
    switchProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    updateActiveState: vi.fn(),
    getPersistedState: vi.fn(),
    importPersistedState: vi.fn(),
    importDoc: vi.fn(),
    importDocs: vi.fn(),
  };
  return mockProject;
}

describe("App sandbox edit (apply as new file)", () => {
  beforeEach(() => {
    capturedOnApplyAsNewFile = undefined;
    installBridge = true;
    mockBridge.previewPatch.mockReset();
    mockBridge.previewPatch.mockReturnValue({
      ...makePreview(),
      sourceHash: "fnv1a64-v1:orig",
      baseRevision: null,
    });
    mockBridge.applyConfirmedPatch.mockReset();
    setupProject();
    // The Agent panel is lazily imported and only mounted once opened
    // (A-PERF-001). Explicitly restore an open Agent for these sandbox tests;
    // a fresh workspace now starts with the editor only.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    window.localStorage.clear();
    window.localStorage.setItem("genecode-agent-open", "true");
  });

  it("starts editor-first and opens the Agent on demand in a fresh workspace", async () => {
    setupWorkspace();
    window.localStorage.removeItem("genecode-agent-open");
    render(<App />);
    expect(screen.queryByTestId("copy-action")).toBeNull();
    expect(screen.getByRole("main", { name: "序列工作区" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open GeneCode Agent" }));
    await screen.findByTestId("copy-action");
  });

  it("keeps the duplicate sequence library drawer closed by default", async () => {
    setupWorkspace();

    render(<App />);
    await screen.findByTestId("copy-action");

    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.getByRole("navigation", { name: "已打开序列" })).toBeTruthy();
  });

  it("keeps file navigation and commands inside the sequence workbench", async () => {
    setupWorkspace();
    render(<App />);
    await screen.findByTestId("copy-action");
    const main = screen.getByRole("main", { name: "序列工作区" });
    expect(main.contains(screen.getByRole("navigation", { name: "已打开序列" }))).toBe(true);
    expect(main.contains(screen.getByRole("region", { name: "Document commands" }))).toBe(true);
    expect(main.contains(screen.getByTestId("copy-action"))).toBe(false);
    expect(main.compareDocumentPosition(screen.getByTestId("copy-action")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("applies the pending change to a named copy without touching the original", async () => {
    const workspace = setupWorkspace();

    render(<App />);
    // App's mount effect calls setDoc once for the active project; clear it so
    // the handler's own setDoc is the only one observed.
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(capturedOnApplyAsNewFile).toBeDefined();
    const [name, doc, filePath, isDirty] = mockProject.createProject.mock.calls[0]!;
    expect(name).toBe("pUC19 · Agent 副本");
    expect(doc.sequence).toBe(proposedDoc.sequence);
    expect(filePath).toBeNull();
    expect(isDirty).toBe(true);
    // The original document was never written to (no commit boundary used).
    expect(workspace.commitAgentDocument).not.toHaveBeenCalled();
    expect(workspace.applyPendingPatch).not.toHaveBeenCalled();
    // setDoc switches to the new project (which clears pending state itself).
    expect(workspace.setDoc).toHaveBeenCalled();
  });

  it("rejects a stale preview in the no-bridge fallback", async () => {
    installBridge = false;
    const workspace = setupWorkspace({ currentHash: "fnv1a64-v1:changed" });

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(workspace.setAgentApplyFailure).toHaveBeenCalledWith([
      "Preview is stale — the document changed since preview",
    ]);
    expect(workspace.setDoc).not.toHaveBeenCalled();
    expect(mockBridge.previewPatch).not.toHaveBeenCalled();
  });

  it("uses the live bridge preview when the editor is mounted", async () => {
    const workspace = setupWorkspace();

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();
    expect(mockBridge.previewPatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(mockBridge.previewPatch).toHaveBeenCalled();
    const [, doc] = mockProject.createProject.mock.calls[0]!;
    expect(doc.sequence).toBe(proposedDoc.sequence);
    expect(workspace.setDoc).toHaveBeenCalled();
  });

  it("opens the side-by-side sandbox diff after creating the copy", async () => {
    const workspace = setupWorkspace();

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();
    expect(screen.queryByRole("dialog", { name: "沙盒差异比较" })).toBeNull();

    fireEvent.click(screen.getByTestId("copy-action"));

    // The dialog pairs the untouched original with the derived copy.
    expect(screen.getByRole("dialog", { name: "沙盒差异比较" })).toBeDefined();
    expect(screen.getByText(/pUC19 → pUC19 · Agent 副本/)).toBeDefined();
    // The copy is what the bridge proposed, not the original.
    expect(screen.getByText(/2,686 bp → 2,690 bp/)).toBeDefined();

    // Closing the dialog dismisses it without touching the workspace.
    fireEvent.click(screen.getByRole("button", { name: "关闭差异比较" }));
    expect(screen.queryByRole("dialog", { name: "沙盒差异比较" })).toBeNull();
    expect(workspace.setDoc).toHaveBeenCalled();
  });

  it("opens the sandbox diff in the no-bridge fallback path too", async () => {
    installBridge = false;
    const workspace = setupWorkspace();

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(screen.getByRole("dialog", { name: "沙盒差异比较" })).toBeDefined();
    expect(screen.getByText(/pUC19 → pUC19 · Agent 副本/)).toBeDefined();
  });

  it("fails without any pending preview", async () => {
    const workspace = setupWorkspace({ pendingPatch: null, pendingPreview: null });

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(workspace.setAgentApplyFailure).toHaveBeenCalledWith([
      "No valid Agent preview is ready to apply",
    ]);
    expect(workspace.setDoc).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "沙盒差异比较" })).toBeNull();
  });

  it("fails when the bridge preview has errors", async () => {
    const workspace = setupWorkspace();
    mockBridge.previewPatch.mockReturnValue({
      ...makePreview({ errors: ["bad op"] }),
      sourceHash: "fnv1a64-v1:orig",
    });

    render(<App />);
    await screen.findByTestId("copy-action");
    workspace.setDoc.mockClear();

    fireEvent.click(screen.getByTestId("copy-action"));

    expect(workspace.setAgentApplyFailure).toHaveBeenCalledWith(["bad op"]);
    expect(workspace.setDoc).not.toHaveBeenCalled();
  });
});
