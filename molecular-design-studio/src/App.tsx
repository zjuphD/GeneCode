import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { AppBar, Box, Button, Chip, IconButton, Stack, Toolbar, Tooltip } from "@mui/material";
import FileText from "@mui/icons-material/DescriptionRounded";
import PanelLeft from "@mui/icons-material/ViewSidebarRounded";
import PanelLeftClose from "@mui/icons-material/MenuOpenRounded";
import Plus from "@mui/icons-material/AddRounded";
import Settings from "@mui/icons-material/SettingsRounded";
import X from "@mui/icons-material/CloseRounded";
import Sidebar, { type SidebarSection } from "./components/Sidebar";
import Editor from "./components/Editor";
// A-PERF-001: the Agent panel owns the heavy agent layer (service client,
// step graph, session hook). It collapses to a zero-width rail when closed, so
// it is only mounted after the user first opens it; the chunk loads on demand.
const AgentPanel = lazy(() => import("./components/AgentPanel"));
import { SettingsPanel } from "./components/SettingsPanel";
import { useWorkspace } from "./workspace/useWorkspace";
import { useProject } from "./workspace/useProject";
import type { SequenceDocument, SequenceFeature, SequenceFeatureInput } from "./types";
import { fromFeatureSelection } from "./editor/selection";
import { extractSelectionDocument } from "./editor/sequenceActions";
import { confirmDiscardChanges } from "./services/sequenceFiles";
import { openProjectFile, saveProjectFile } from "./services/projectFiles";
import { parseProjectFile, serializeProjectFile } from "./workspace/projectPersistence";
import type { NewFeatureInput } from "./components/SequenceInspector";
import type { AgentProjectSequence } from "./components/CloningSetupPanel";
import type { OveApplyContext, OveCommandBridge } from "./editor/oveCommandBridge";
import type { ValidationMarker } from "./agent/validationMarkers";
import type { PatchDiffMarker } from "./agent/patchDiffMarkers";
import SandboxDiffDialog from "./components/SandboxDiffDialog";

function projectFileDefaultName(name: string): string {
  const safeName = (name.trim() || "GeneCode project")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.genecode\.json$/i, "");
  return `${safeName}.genecode.json`;
}

function App() {
  const workspace = useWorkspace();
  const project = useProject();
  const updateActiveProjectState = project.updateActiveState;
  const initializedRef = useRef(false);
  const projectFilePathRef = useRef<string | null>(null);
  const commandBridgeRef = useRef<OveCommandBridge | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("annotations");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    // The document tabs above the editor are the primary sequence navigator.
    // Keep the optional library/annotation drawer closed on first launch so
    // it does not duplicate the tab strip or steal editor width. Users can
    // still open it from the top-left control when they need feature details.
    return window.localStorage.getItem("genecode-sidebar-open-v3") === "true";
  });
  const [agentOpen, setAgentOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.innerWidth < 1400) return false;
    const stored = window.localStorage.getItem("genecode-agent-open");
    if (stored !== null) return stored === "true";
    return true;
  });
  const agentToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  // Once the Agent panel has been opened it stays mounted (its collapsed rail
  // is zero-width, so there is no layout cost) — this preserves the in-panel
  // session instead of tearing it down every time the user closes the panel.
  const [agentEverOpened, setAgentEverOpened] = useState(agentOpen);
  const [validationMarkers, setValidationMarkers] = useState<ValidationMarker[]>([]);
  const [patchDiffMarkers, setPatchDiffMarkers] = useState<PatchDiffMarker[]>([]);
  const [patchDiffRevealCount, setPatchDiffRevealCount] = useState(0);
  // Side-by-side diff between the original document and the Agent copy created
  // by “复制为新文件并应用”, opened automatically for confirmation.
  const [sandboxDiff, setSandboxDiff] = useState<{
    original: SequenceDocument;
    copy: SequenceDocument;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem("genecode-agent-open", String(agentOpen));
  }, [agentOpen]);

  useEffect(() => {
    window.localStorage.setItem("genecode-sidebar-open-v3", String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    const resizeTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 180);
    return () => window.clearTimeout(resizeTimer);
  }, [agentOpen, sidebarOpen]);

  const setAgentVisibility = useCallback((open: boolean) => {
    setAgentOpen(open);
    if (open) {
      setAgentEverOpened(true);
      if (window.innerWidth < 1400) {
        setSidebarOpen(false);
      }
    } else {
      // Return keyboard users to the control that opened the panel, including
      // when the mobile scrim or Escape key closes the drawer.
      window.setTimeout(() => agentToggleRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    const handleShellEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (agentOpen) {
        event.preventDefault();
        setAgentVisibility(false);
        return;
      }
      if (sidebarOpen && window.innerWidth <= 1100) {
        event.preventDefault();
        setSidebarOpen(false);
        window.setTimeout(() => sidebarToggleRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleShellEscape);
    return () => window.removeEventListener("keydown", handleShellEscape);
  }, [agentOpen, setAgentVisibility, sidebarOpen]);

  const readLiveEditorContext = useCallback(() => {
    try {
      return commandBridgeRef.current?.readCurrentState() ?? null;
    } catch {
      return null;
    }
  }, []);

  // Initialize after either synchronous localStorage or the asynchronous
  // IndexedDB recovery has produced a document/project. The previous empty
  // dependency list marked the shell initialized on the first null render,
  // leaving a recovered workspace without a project tab after cache loss.
  useEffect(() => {
    if (initializedRef.current) return;
    if (workspace.isRestoring || project.isRestoring) return;
    if (project.projects.length === 0 && !workspace.doc) return;
    initializedRef.current = true;
    if (project.projects.length === 0 && workspace.doc) {
      const created = project.createProject(
        workspace.doc.name || "Untitled",
        workspace.doc,
        workspace.filePath,
        workspace.isDirty,
      );
      workspace.setDoc(created.doc);
      workspace.replaceHistory(created.history);
    } else if (project.projects.length > 0 && project.activeProject) {
      workspace.setDoc(project.activeProject.doc);
      workspace.replaceHistory(project.activeProject.history);
      workspace.setFilePath(project.activeProject.filePath);
      workspace.setIsDirty(project.activeProject.isDirty);
    }
  }, [project.activeProject, project.isRestoring, project.projects.length, workspace.doc, workspace.isRestoring]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge: AgentPanel sends unknown (runtime boundary), workspace accepts unknown
  const handleLoadPreview = (patch: unknown): boolean =>
    workspace.loadPatchPreview(patch);

  const commitAgentDocument = workspace.commitAgentDocument;
  const applyPendingPatch = workspace.applyPendingPatch;
  const setAgentApplyFailure = workspace.setAgentApplyFailure;
  const pendingAgentPatch = workspace.pendingPatch;

  const handleAgentCommit = useCallback(
    (nextDoc: SequenceDocument, context: OveApplyContext) =>
      void commitAgentDocument(nextDoc, {
        ...context,
        editorAlreadySynchronized: true,
      }),
    [commitAgentDocument],
  );

  const handleApplyAgentPatch = useCallback(async () => {
    const patch = pendingAgentPatch;
    if (!patch) {
      setAgentApplyFailure(["No valid Agent preview is ready to apply"]);
      return;
    }

    const bridge = commandBridgeRef.current;
    if (!bridge) {
      // Canonical fallback still reparses the normalized patch and rechecks
      // the document hash before it can write anything.
      applyPendingPatch();
      return;
    }

    try {
      // The preview shown in the panel is never written directly. Rebuild it
      // from the normalized patch against the live OVE store at click time.
      const livePreview = bridge.previewPatch(patch);
      if (livePreview.errors.length > 0 || !livePreview.proposedDocument) {
        setAgentApplyFailure(livePreview.errors);
        return;
      }

      const result = await bridge.applyConfirmedPatch(livePreview);
      if (!result.ok) {
        setAgentApplyFailure(
          result.errors,
          result.reason === "stale_preview",
        );
      }
    } catch (error) {
      setAgentApplyFailure([
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }, [applyPendingPatch, pendingAgentPatch, setAgentApplyFailure]);

  // Add a feature annotation from Agent results (primer, sgRNA, etc.)
  const handleAddFeature = useCallback((feature: SequenceFeatureInput) => {
    if (!workspace.doc) return;
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const updated = {
      ...workspace.doc,
      features: [
        ...workspace.doc.features,
        { ...feature, id },
      ],
    };
    workspace.commitDocument(updated, `Saved Agent result “${feature.name}”`, "agent");
  }, [workspace]);

  const handleUpdateFeature = useCallback((feature: SequenceFeature) => {
    if (!workspace.doc) return;
    const updated = {
      ...workspace.doc,
      features: workspace.doc.features.map((item) => item.id === feature.id ? feature : item),
    };
    workspace.commitDocument(updated, `Updated annotation “${feature.name}”`, "annotation");
  }, [workspace]);

  const handleDeleteFeature = useCallback((id: string) => {
    if (!workspace.doc) return;
    const feature = workspace.doc.features.find((item) => item.id === id);
    if (!feature) return;
    const updated = {
      ...workspace.doc,
      features: workspace.doc.features.filter((item) => item.id !== id),
    };
    workspace.commitDocument(updated, `Deleted annotation “${feature.name}”`, "annotation");
  }, [workspace]);

  const handleAddFeatureFromSelection = useCallback((input: NewFeatureInput) => {
    if (!workspace.doc || !workspace.selection) return;
    const selection = workspace.selection;
    const doc = workspace.doc;
    // A-BIO-004: an origin-spanning circular selection becomes a segments
    // feature ({start > end} + [{start, seqLen}, {0, end}]).
    if (selection.wrapsOrigin) {
      const sequenceLength = doc.sequence.length;
      const feature: SequenceFeature = {
        id: `feature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        type: input.type,
        start: selection.start,
        end: selection.end,
        strand: 1,
        qualifiers: {},
        segments: [
          { start: selection.start, end: sequenceLength },
          { start: 0, end: selection.end },
        ],
        ...(input.color ? { color: input.color } : {}),
      };
      workspace.commitDocument(
        { ...doc, features: [...doc.features, feature] },
        `Added annotation “${feature.name}”`,
        "annotation",
      );
      return;
    }
    const feature: SequenceFeature = {
      id: `feature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      type: input.type,
      start: selection.start,
      end: selection.end,
      strand: 1,
      qualifiers: {},
      ...(input.color ? { color: input.color } : {}),
    };
    workspace.commitDocument(
      { ...workspace.doc, features: [...workspace.doc.features, feature] },
      `Added annotation “${feature.name}”`,
      "annotation",
    );
  }, [workspace]);

  const handleSelectFeature = useCallback((feature: SequenceFeature) => {
    const doc = workspace.doc;
    if (!doc) return;
    const selection = fromFeatureSelection(feature, doc);
    if (selection) workspace.onSelectionChange(selection);
  }, [workspace]);

  // Locate an Agent step's result region in the editor (DAG node click).
  const handleLocateRegion = useCallback((region: { start: number; end: number }) => {
    const doc = workspace.doc;
    if (!doc) return;
    const start = Math.max(0, Math.min(doc.sequence.length, region.start));
    const end = Math.max(start, Math.min(doc.sequence.length, region.end));
    if (end <= start) {
      workspace.setStatus("This result region is not on the open sequence", "error");
      return;
    }
    workspace.onSelectionChange({
      start,
      end,
      length: end - start,
      wrapsOrigin: false,
      sequence: doc.sequence.slice(start, end),
    });
  }, [workspace]);

  // Save current project's file state before switching
  const saveCurrentProjectState = useCallback(() => {
    if (project.activeId && workspace.doc) {
      updateActiveProjectState(workspace.doc, workspace.filePath, workspace.isDirty, workspace.history);
    }
  }, [project.activeId, updateActiveProjectState, workspace.doc, workspace.filePath, workspace.isDirty, workspace.history]);

  const handleSaveProjectFile = useCallback(async () => {
    if (!workspace.doc || !project.activeId) {
      workspace.setStatus("No project is open", "error");
      return;
    }
    const snapshot = project.getPersistedState(
      workspace.doc,
      workspace.filePath,
      workspace.isDirty,
      workspace.history,
    );
    try {
      const path = await saveProjectFile(
        projectFileDefaultName(project.activeProject?.name ?? workspace.doc.name),
        serializeProjectFile(snapshot),
        projectFilePathRef.current,
      );
      if (path) {
        projectFilePathRef.current = path;
        workspace.setStatus("GeneCode project saved", "success");
      }
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Failed to save GeneCode project", "error");
    }
  }, [project, workspace]);

  const handleOpenProjectFile = useCallback(async () => {
    const selected = await openProjectFile();
    if (!selected) return;
    if (workspace.isDirty && !(await confirmDiscardChanges())) return;
    try {
      const imported = parseProjectFile(selected.contents);
      const active = project.importPersistedState(imported);
      if (!active) throw new Error("GeneCode project file does not contain an active sequence.");
      projectFilePathRef.current = selected.path;
      workspace.setDoc(active.doc);
      workspace.setFilePath(active.filePath);
      workspace.setIsDirty(active.isDirty);
      workspace.replaceHistory(active.history);
      workspace.setStatus(`Opened GeneCode project: ${active.name}`, "success");
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Failed to open GeneCode project", "error");
    }
  }, [project, workspace]);

  // Create project: create and load
  const handleCreateProject = useCallback((name: string) => {
    saveCurrentProjectState();
    projectFilePathRef.current = null;
    const created = project.createProject(name);
    workspace.setDoc(created.doc);
    workspace.setFilePath(created.filePath);
    workspace.setIsDirty(created.isDirty);
    workspace.replaceHistory(created.history);
  }, [project, workspace, saveCurrentProjectState]);

  // Switch project: save current state, load new
  const handleSwitchProject = useCallback((id: string) => {
    if (id === project.activeId) return;
    saveCurrentProjectState();
    const target = project.switchProject(id);
    if (target) {
      workspace.setDoc(target.doc);
      workspace.setFilePath(target.filePath);
      workspace.setIsDirty(target.isDirty);
      workspace.replaceHistory(target.history);
    }
  }, [project, workspace, saveCurrentProjectState]);

  const handleOpenDocument = useCallback((doc: SequenceDocument, path: string) => {
    saveCurrentProjectState();
    projectFilePathRef.current = null;
    const opened = project.importDoc(doc, path);
    workspace.setDoc(opened.doc);
    workspace.setFilePath(opened.filePath);
    workspace.setIsDirty(opened.isDirty);
    workspace.replaceHistory(opened.history);
  }, [project, saveCurrentProjectState, workspace]);

  const handleCreateDerivedDocument = useCallback((doc: SequenceDocument) => {
    saveCurrentProjectState();
    projectFilePathRef.current = null;
    const created = project.createProject(doc.name || "Derived sequence", doc, null, true);
    workspace.setDoc(created.doc);
    workspace.setFilePath(null);
    workspace.setIsDirty(true);
    workspace.replaceHistory(created.history);
    workspace.setStatus("New derived sequence added to the library", "success");
  }, [project, saveCurrentProjectState, workspace]);

  const handleExtractSelection = useCallback(() => {
    if (!workspace.doc || !workspace.selection) return;
    const extracted = extractSelectionDocument(workspace.doc, workspace.selection);
    handleCreateDerivedDocument(extracted);
  }, [handleCreateDerivedDocument, workspace.doc, workspace.selection]);

  // Sandbox edit: apply the pending change to a *copy* of the document opened
  // as a new file/project, leaving the original document and its file untouched.
  const handleApplyAgentPatchAsNewFile = useCallback(async () => {
    const patch = pendingAgentPatch;
    if (!patch) {
      setAgentApplyFailure(["No valid Agent preview is ready to apply"]);
      return;
    }

    const bridge = commandBridgeRef.current;
    if (!bridge) {
      // Canonical fallback: still reparse the normalized patch and recheck the
      // hash, but commit to a derived copy instead of the current document.
      const currentDoc = workspace.doc;
      const preview = workspace.pendingPreview;
      if (!currentDoc || !preview?.proposedDocument) {
        setAgentApplyFailure(["No valid Agent preview is ready to apply"]);
        return;
      }
      if (preview.baseHash !== workspace.currentHash) {
        setAgentApplyFailure(["Preview is stale — the document changed since preview"]);
        return;
      }
      const derived = {
        ...preview.proposedDocument,
        name: `${currentDoc.name} · Agent 副本`,
      };
      // Snapshot the untouched original before the derived copy replaces it in
      // the workspace, then open the side-by-side diff for confirmation.
      const originalSnapshot = { ...currentDoc };
      // handleCreateDerivedDocument switches to a new project via setDoc, which
      // clears the pending patch/preview automatically — no explicit reject.
      handleCreateDerivedDocument(derived);
      setSandboxDiff({ original: originalSnapshot, copy: derived });
      return;
    }

    try {
      const livePreview = bridge.previewPatch(patch);
      if (livePreview.errors.length > 0 || !livePreview.proposedDocument) {
        setAgentApplyFailure(livePreview.errors);
        return;
      }
      const baseName = workspace.doc?.name ?? "Sequence";
      const originalSnapshot = workspace.doc ? { ...workspace.doc } : null;
      const derived = {
        ...livePreview.proposedDocument,
        name: `${baseName} · Agent 副本`,
      };
      handleCreateDerivedDocument(derived);
      if (originalSnapshot) {
        setSandboxDiff({ original: originalSnapshot, copy: derived });
      }
    } catch (error) {
      setAgentApplyFailure([
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }, [
    handleCreateDerivedDocument,
    pendingAgentPatch,
    setAgentApplyFailure,
    workspace,
  ]);

  // Delete project
  const handleDeleteProject = useCallback((id: string) => {
    const deletingActive = project.activeId === id;
    const nextProject = deletingActive
      ? (project.projects.find((entry) => entry.id !== id) ?? null)
      : null;
    saveCurrentProjectState();
    project.deleteProject(id);
    if (!deletingActive) return;
    if (nextProject) {
      workspace.setDoc(nextProject.doc);
      workspace.setFilePath(nextProject.filePath);
      workspace.setIsDirty(nextProject.isDirty);
      workspace.replaceHistory(nextProject.history);
    } else {
      // No projects left — clear workspace
      workspace.setDoc({ name: "Empty", sequence: "", circular: false, features: [] });
      workspace.setFilePath(null);
      workspace.setIsDirty(false);
    }
  }, [project, workspace, saveCurrentProjectState]);

  const handleCloseProjectTab = useCallback(async (id: string) => {
    const target = project.projects.find((entry) => entry.id === id);
    if (!target) return;
    if (target.isDirty && !(await confirmDiscardChanges())) return;
    handleDeleteProject(id);
  }, [handleDeleteProject, project.projects]);

  // Sync workspace doc changes back to project
  useEffect(() => {
    if (initializedRef.current && workspace.doc && project.activeId) {
      updateActiveProjectState(workspace.doc, workspace.filePath, workspace.isDirty, workspace.history);
    }
  }, [workspace.doc, workspace.filePath, workspace.isDirty, workspace.history, project.activeId, updateActiveProjectState]);

  return (
    <div className="app-shell">
      <nav className="document-tabs" aria-label="已打开序列">
        <div className="document-tabs__list">
          {project.projects.map((entry) => (
            <div
              key={entry.id}
              className={`document-tab${entry.id === project.activeId ? " document-tab--active" : ""}`}
            >
              <button
                type="button"
                className="document-tab__select"
                onClick={() => handleSwitchProject(entry.id)}
                aria-current={entry.id === project.activeId ? "page" : undefined}
                title={`Open ${entry.name}`}
              >
                <FileText aria-hidden="true" />
                <span className="document-tab__name">{entry.name}</span>
                <span className="document-tab__meta">
                  DNA · {entry.doc.sequence.length.toLocaleString()} bp · {entry.doc.circular ? "circular" : "linear"}
                </span>
                {entry.isDirty && <span className="document-tab__dirty" aria-label="未保存更改">●</span>}
              </button>
              {project.projects.length > 1 && (
                <button
                  type="button"
                  className="document-tab__close"
                  onClick={() => void handleCloseProjectTab(entry.id)}
                  aria-label={`Close ${entry.name}`}
                  title={`Close ${entry.name}`}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="document-tabs__new"
            onClick={() => handleCreateProject(`Sequence ${project.projects.length + 1}`)}
            aria-label="新建序列标签页"
            title="New sequence"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </nav>
      <AppBar component="header" position="static" elevation={0} color="transparent" className="top-bar">
        <Toolbar disableGutters className="top-bar__toolbar">
          <Tooltip title={sidebarOpen ? "隐藏序列文库" : "显示序列文库"}>
            <IconButton
              size="small"
              className="top-bar__icon-button"
              ref={sidebarToggleRef}
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label={sidebarOpen ? "Hide sequence library" : "Show sequence library"}
              aria-pressed={sidebarOpen}
            >
              {sidebarOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeft aria-hidden="true" />}
            </IconButton>
          </Tooltip>
          <Box className="top-bar__brand">
            <span className="top-bar__brand-mark" aria-hidden="true">
              <img src="/assets/brand/genecode-mark-v4.png" alt="" />
            </span>
            <span className="top-bar__title">GeneCode</span>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1} className="top-bar__document">
            <span className="top-bar__status">
              {workspace.doc ? workspace.basename ?? workspace.doc.name : "No sequence open"}
            </span>
            {workspace.doc && (
              <Tooltip title={project.saveError || workspace.saveError || "本地自动保存状态"}>
                <Chip
                  size="small"
                  variant="outlined"
                  className={`top-bar__save-state${
                    project.saveError || workspace.saveError
                      ? " top-bar__save-state--error"
                      : workspace.isDirty
                        ? " top-bar__save-state--dirty"
                        : ""
                  }`}
                  label={project.saveError || workspace.saveError ? "保存失败" : workspace.isDirty ? "未保存" : "已保存"}
                />
              </Tooltip>
            )}
            {(project.saveError || workspace.saveError) && (
              <Button size="small" color="error" variant="outlined" className="top-bar__recover-export" onClick={handleSaveProjectFile}>
                导出恢复副本
              </Button>
            )}
          </Stack>
          <Tooltip title={agentOpen ? "隐藏 GeneCode Agent" : "打开 GeneCode Agent"}>
            <Button
              size="small"
              variant={agentOpen ? "contained" : "outlined"}
              color="secondary"
              className={`top-bar__agent-toggle${agentOpen ? " top-bar__agent-toggle--active" : ""}`}
              ref={agentToggleRef}
              onClick={() => setAgentVisibility(!agentOpen)}
              aria-label={agentOpen ? "Hide GeneCode Agent" : "Open GeneCode Agent"}
              aria-pressed={agentOpen}
              aria-controls="agent-panel"
              startIcon={<img className="top-bar__agent-toggle-avatar" src="/assets/brand/genecode-agent-avatar-v3.png" alt="" aria-hidden="true" />}
            >
              GeneCode Agent
            </Button>
          </Tooltip>
          <Tooltip title="设置">
            <IconButton size="small" className="top-bar__settings" onClick={() => setShowSettings(!showSettings)} aria-label="设置" aria-expanded={showSettings}>
              <Settings aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <div
        id="document-toolbar-slot"
        className="doc-toolbar-row"
        role="region"
        aria-label="Document commands"
      />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <div className="app-body">
        {sidebarOpen && (
          <>
            <button
              type="button"
              className="sidebar-scrim"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭序列文库"
            />
            <Sidebar
              doc={workspace.doc}
              selection={workspace.selection}
              projects={project.projects}
              activeId={project.activeId}
              activeSection={sidebarSection}
              onActiveSectionChange={setSidebarSection}
              onCreateProject={handleCreateProject}
              onOpenProject={handleOpenProjectFile}
              onSaveProject={handleSaveProjectFile}
              onSwitchProject={handleSwitchProject}
              onRenameProject={project.renameProject}
              onDeleteProject={handleDeleteProject}
              onSelectFeature={handleSelectFeature}
              onUpdateFeature={handleUpdateFeature}
              onDeleteFeature={handleDeleteFeature}
              onAddFeatureFromSelection={handleAddFeatureFromSelection}
              onExtractSelection={handleExtractSelection}
              history={workspace.history}
              onRestoreHistory={workspace.restoreHistoryEntry}
              onClearHistory={workspace.clearHistory}
            />
          </>
        )}
        <main className="main-area">
          <Editor
            doc={workspace.doc}
            isRestoring={workspace.isRestoring || project.isRestoring}
            filePath={workspace.filePath}
            basename={workspace.basename}
            isDirty={workspace.isDirty}
            remountKey={workspace.remountKey}
            status={workspace.status}
            statusType={workspace.statusType}
            setDoc={workspace.setDoc}
            setFilePath={workspace.setFilePath}
            setIsDirty={workspace.setIsDirty}
            setStatus={workspace.setStatus}
            onOveCommit={workspace.onOveCommit}
            onOveError={workspace.onOveError}
            onAgentCommit={handleAgentCommit}
            onFileOpen={handleOpenDocument}
            onSelectionChange={workspace.onSelectionChange}
            selection={workspace.selection}
            onNew={() => handleCreateProject(`Sequence ${project.projects.length + 1}`)}
            onImport={(doc) => {
              saveCurrentProjectState();
              projectFilePathRef.current = null;
              const imported = project.importDoc(doc);
              workspace.setDoc(imported.doc);
              workspace.setFilePath(imported.filePath);
              workspace.setIsDirty(imported.isDirty);
              workspace.replaceHistory(imported.history);
            }}
            onImportMulti={(docs) => {
              saveCurrentProjectState();
              projectFilePathRef.current = null;
              const imported = project.importDocs(docs);
              const first = imported[0];
              if (first) {
                workspace.setDoc(first.doc);
                workspace.setFilePath(first.filePath);
                workspace.setIsDirty(first.isDirty);
                workspace.replaceHistory(first.history);
              }
            }}
            onOpenPanel={(section) => {
              setSidebarOpen(true);
              setSidebarSection(section);
            }}
            onUndo={workspace.undoDocument}
            onRedo={workspace.redoDocument}
            canUndo={workspace.history.length > 0}
            canRedo={workspace.redoStack.length > 0}
            onCommitDocument={(doc, label, source) => workspace.commitDocument(doc, label, source)}
            onCreateDerivedDocument={handleCreateDerivedDocument}
            commandBridgeRef={commandBridgeRef}
            validationMarkers={validationMarkers}
            patchDiffMarkers={patchDiffMarkers}
            patchDiffRevealCount={patchDiffRevealCount}
          />
        </main>
        {agentEverOpened && (
          <Suspense fallback={
            <aside className="agent-panel agent-panel--loading" aria-hidden="true" />
          }>
            <AgentPanel
              key={`${project.activeId ?? "none"}:${workspace.filePath ?? workspace.doc?.name ?? "empty"}`}
              sessionKey={`${project.activeId ?? "none"}:${workspace.filePath ?? workspace.doc?.name ?? "empty"}`}
              doc={workspace.doc}
              selection={workspace.selection}
              pendingPreview={workspace.pendingPreview}
              revertDocument={workspace.revertDocument}
              onLoadPreview={handleLoadPreview}
              onApply={handleApplyAgentPatch}
              onApplyAsNewFile={handleApplyAgentPatchAsNewFile}
              onReject={workspace.rejectPendingPatch}
              onRevert={workspace.revertLastAgentChange}
              onAddFeature={handleAddFeature}
              onValidationMarkersChange={setValidationMarkers}
              onPatchDiffMarkersChange={setPatchDiffMarkers}
              onDiffRevealChange={setPatchDiffRevealCount}
              onLocateRegion={handleLocateRegion}
              sequenceLibrary={project.projects.map((entry): AgentProjectSequence => ({
                id: entry.id,
                name: entry.name,
                sequence: entry.doc.sequence,
                circular: entry.doc.circular,
                featureCount: entry.doc.features.length,
              }))}
              activeProjectId={project.activeId}
              open={agentOpen}
              id="agent-panel"
              onOpenChange={setAgentVisibility}
              hideCollapsedRail
              getLiveEditorContext={readLiveEditorContext}
            />
          </Suspense>
        )}
        {agentOpen && (
          <button
            type="button"
            className="agent-scrim"
            onClick={() => setAgentVisibility(false)}
            aria-label="关闭 GeneCode Agent"
          />
        )}
      </div>
      {sandboxDiff && (
        <SandboxDiffDialog
          original={sandboxDiff.original}
          copy={sandboxDiff.copy}
          onClose={() => setSandboxDiff(null)}
        />
      )}
    </div>
  );
}

export default App;
