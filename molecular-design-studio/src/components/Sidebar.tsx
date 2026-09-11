/**
 * Sidebar — project list + compact annotation browser.
 *
 * Top section: project list with create/rename/delete/switch.
 * Bottom section: one filterable annotation list for the active project.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { FileText, FolderOpen, History, Info, List, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import type { SequenceDocument, SequenceFeature, SequenceSelection } from "../types";
import type { ProjectEntry } from "../workspace/projectPersistence";
import type { DocumentHistoryEntry } from "../workspace/documentHistory";
import { resolveDisplayColor } from "../editor/adapter";
import { SequenceInspector, type NewFeatureInput } from "./SequenceInspector";
import { DocumentHistoryPanel } from "./DocumentHistoryPanel";

type AnnotationFilter = "all" | "primers" | "restriction";

export type SidebarSection = "annotations" | "inspector" | "history";

const SIDEBAR_WIDTH_STORAGE_KEY = "genecode-sidebar-width";

interface SidebarProps {
  doc: SequenceDocument | null;
  selection: SequenceSelection | null;
  projects: ProjectEntry[];
  activeId: string | null;
  /** Controlled active section (SnapGene-style footer links drive this). */
  activeSection?: SidebarSection;
  onActiveSectionChange?: (section: SidebarSection) => void;
  onCreateProject: (name: string) => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
  onSwitchProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectFeature?: (feature: SequenceFeature) => void;
  onUpdateFeature?: (feature: SequenceFeature) => void;
  onDeleteFeature?: (id: string) => void;
  onAddFeatureFromSelection?: (input: NewFeatureInput) => void;
  onExtractSelection?: () => void;
  history?: DocumentHistoryEntry[];
  onRestoreHistory?: (id: string, version?: "before" | "after") => void;
  onClearHistory?: () => void;
}

const FILTERS: Array<{ id: AnnotationFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "primers", label: "引物" },
  { id: "restriction", label: "酶切位点" },
];

function featureLabel(feature: SequenceFeature): string {
  return feature.name || feature.type || "未命名特征";
}

function FeatureList({
  items,
  empty,
  selection,
  onSelect,
}: {
  items: SequenceFeature[];
  empty: string;
  selection: SequenceSelection | null;
  onSelect?: (feature: SequenceFeature) => void;
}) {
  if (items.length === 0) return <p className="sidebar-empty">{empty}</p>;
  const visible = items.slice(0, 50);
  return (
    <>
      <ul className="sidebar-detail-list">
        {visible.map((feature, index) => (
          <li key={`${feature.start}-${feature.end}-${index}`}>
            <button
              type="button"
              className={selection?.start === feature.start && selection.end === feature.end
                ? "sidebar-feature sidebar-feature--selected"
                : "sidebar-feature"}
              onClick={() => onSelect?.(feature)}
              aria-pressed={selection?.start === feature.start && selection.end === feature.end}
              title={`在编辑器中选中 ${featureLabel(feature)}`}
            >
              <span className="sidebar-feature__name">
                <i
                  className="sidebar-feature__swatch"
                  style={{ backgroundColor: resolveDisplayColor(feature) }}
                  aria-hidden="true"
                />
                <span>{featureLabel(feature)}</span>
              </span>
              <small>{feature.start + 1}-{feature.end}</small>
            </button>
          </li>
        ))}
      </ul>
      {items.length > visible.length && (
        <p className="sidebar-list-note">共 {items.length} 个注释，显示前 50 个</p>
      )}
    </>
  );
}

// ── Project list item ──────────────────────────────────────

function ProjectItem({
  project,
  isActive,
  onSwitch,
  onRename,
  onDelete,
}: {
  project: ProjectEntry;
  isActive: boolean;
  onSwitch: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);

  const handleRename = useCallback(() => {
    if (editName.trim() && editName.trim() !== project.name) {
      onRename(editName.trim());
    }
    setEditing(false);
  }, [editName, project.name, onRename]);

  return (
    <div className={`sidebar-project${isActive ? " sidebar-project--active" : ""}`}>
      {editing ? (
        <input
          className="sidebar-project__rename-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <button type="button" className="sidebar-project__select" onClick={onSwitch} aria-current={isActive ? "page" : undefined}>
            <FileText aria-hidden="true" />
            <span className="sidebar-project__content">
              <span className="sidebar-project__name" title={project.name}>{project.name}</span>
              <small className="sidebar-project__meta">
                {project.doc.sequence.length.toLocaleString()} bp · {project.doc.circular ? "环状" : "线性"}
              </small>
            </span>
          </button>
          <div className="sidebar-project__actions">
            <button
              type="button"
              className="sidebar-project__action"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                setEditName(project.name);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button"
              className="sidebar-project__action sidebar-project__action--danger"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`确定删除 "${project.name}"？此操作无法撤销。`)) {
                  onDelete();
                }
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main sidebar ───────────────────────────────────────────

function Sidebar({
  doc,
  selection,
  projects,
  activeId,
  activeSection: activeSectionProp,
  onActiveSectionChange,
  onCreateProject,
  onOpenProject,
  onSaveProject,
  onSwitchProject,
  onRenameProject,
  onDeleteProject,
  onSelectFeature,
  onUpdateFeature,
  onDeleteFeature,
  onAddFeatureFromSelection,
  onExtractSelection,
  history = [],
  onRestoreHistory,
  onClearHistory,
}: SidebarProps) {
  const [activeFilter, setActiveFilter] = useState<AnnotationFilter>("all");
  const [internalSection, setInternalSection] = useState<SidebarSection>("annotations");
  const [featureQuery, setFeatureQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [libraryDetailsOpen, setLibraryDetailsOpen] = useState(false);
  const activeSection = activeSectionProp ?? internalSection;
  const showLibrary = activeSection === "annotations" || libraryDetailsOpen;
  const setActiveSection = (section: SidebarSection) => {
    setInternalSection(section);
    onActiveSectionChange?.(section);
  };
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 150 && stored <= 400 ? stored : null;
  });
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const measuredWidth = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
    const startWidth = measuredWidth > 0 ? measuredWidth : sidebarWidth ?? 240;
    let latestWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - startX; // dragging right = wider
      const newWidth = Math.max(150, Math.min(400, startWidth + delta));
      latestWidth = newWidth;
      setSidebarWidth(newWidth);
    };

    const handleUp = () => {
      isResizingRef.current = false;
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(latestWidth)));
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [sidebarWidth]);
  const groups = useMemo(() => {
    const features = doc?.features ?? [];
    const primer = features.filter((feature) => /primer/i.test(`${feature.type} ${feature.name}`));
    const restriction = features.filter((feature) => /(restriction|enzyme|cut site)/i.test(`${feature.type} ${feature.name}`));
    return { all: features, primers: primer, restriction };
  }, [doc]);
  const visibleFeatures = useMemo(() => {
    const query = featureQuery.trim().toLowerCase();
    if (!query) return groups[activeFilter];
    return groups[activeFilter].filter((feature) =>
      `${feature.name} ${feature.type}`.toLowerCase().includes(query),
    );
  }, [activeFilter, featureQuery, groups]);
  const visibleProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLowerCase().includes(query),
    );
  }, [projectQuery, projects]);
  const emptyMessage = activeFilter === "primers"
    ? "没有已保存的引物注释。"
    : activeFilter === "restriction"
      ? "没有已保存的酶切位点注释。"
      : "此序列没有注释。";

  const sidebarStyle = sidebarWidth ? { width: `${sidebarWidth}px` } : undefined;
  const selectedFeature = useMemo(() => {
    if (!selection || !doc) return null;
    return doc.features.find((feature) =>
      feature.start === selection.start && feature.end === selection.end,
    ) ?? null;
  }, [doc, selection]);
  const previousSelectedFeatureRef = useRef(selectedFeature?.id ?? null);

  useEffect(() => {
    const selectedId = selectedFeature?.id ?? null;
    if (selectedId && selectedId !== previousSelectedFeatureRef.current) {
      setActiveSection("inspector");
    }
    previousSelectedFeatureRef.current = selectedId;
    // onActiveSectionChange is stable via ref; the effect itself only needs
    // the selected feature id to decide whether to reveal the inspector.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setActiveSection is recreated every render
  }, [selectedFeature?.id]);

  const selectFeature = (feature: SequenceFeature) => {
    onSelectFeature?.(feature);
    setActiveSection("inspector");
  };

  return (
    <aside className="sidebar" style={sidebarStyle} aria-label="序列文库">
      <div
        className="sidebar__resize-handle"
        onMouseDown={handleResizeStart}
        title="拖动调整宽度"
      />
      {/* Sequence library */}
      <div className="sidebar-header">
        <span className="sidebar-header__context" title={doc?.name}>
          {showLibrary ? "序列文库" : doc?.name || "序列详情"}
        </span>
        {activeSection !== "annotations" && (
          <button
            type="button"
            className="sidebar-header__library-toggle"
            aria-label={showLibrary ? "收起序列文件" : "展开序列文件"}
            aria-expanded={showLibrary}
            onClick={() => setLibraryDetailsOpen(!libraryDetailsOpen)}
          >
            <FolderOpen aria-hidden="true" />
            <span>文件</span>
          </button>
        )}
      </div>
      {showLibrary && <>
      <div className="sidebar-project-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={projectQuery}
          onChange={(event) => setProjectQuery(event.target.value)}
          placeholder="搜索并筛选文件"
          aria-label="搜索并筛选文件"
        />
        {projectQuery && (
          <button
            type="button"
            className="sidebar-project-search__clear"
            onClick={() => setProjectQuery("")}
            aria-label="清除文件搜索"
            title="清除搜索"
          >
            ×
          </button>
        )}
      </div>
      <div className="sidebar-library-actions" aria-label="序列文库操作">
        <button
          type="button"
          title="打开 GeneCode 项目"
          aria-label="打开 GeneCode 项目"
          onClick={() => onOpenProject?.()}
        >
          <FolderOpen aria-hidden="true" />
          <span>打开</span>
        </button>
        <button
          type="button"
          title="保存 GeneCode 项目"
          aria-label="保存 GeneCode 项目"
          onClick={() => onSaveProject?.()}
        >
          <Save aria-hidden="true" />
          <span>保存</span>
        </button>
        <button
          type="button"
          title="新建序列"
          aria-label="新建序列"
          onClick={() => onCreateProject(`序列 ${projects.length + 1}`)}
        >
          <Plus aria-hidden="true" />
          <span>新建</span>
        </button>
      </div>
      <div className="sidebar-projects">
        {projects.length === 0 && (
          <p className="sidebar-empty sidebar-empty--padded">还没有序列。新建一个开始吧。</p>
        )}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <p className="sidebar-empty sidebar-empty--padded">没有与“{projectQuery}”匹配的文件。</p>
        )}
        {visibleProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === activeId}
            onSwitch={() => onSwitchProject(project.id)}
            onRename={(name) => onRenameProject(project.id, name)}
            onDelete={() => onDeleteProject(project.id)}
          />
        ))}
      </div>
      </>}

      <nav className="sidebar-workspace-tabs" aria-label="序列详情">
        <button type="button" className={activeSection === "annotations" ? "active" : ""} onClick={() => setActiveSection("annotations")} aria-pressed={activeSection === "annotations"}>
          <List aria-hidden="true" />
          <span>特征</span>
          {doc && <small>{groups.all.length}</small>}
        </button>
        <button type="button" className={activeSection === "inspector" ? "active" : ""} onClick={() => setActiveSection("inspector")} aria-pressed={activeSection === "inspector"}>
          <Info aria-hidden="true" />
          <span>检查器</span>
        </button>
        <button type="button" className={activeSection === "history" ? "active" : ""} onClick={() => setActiveSection("history")} aria-pressed={activeSection === "history"}>
          <History aria-hidden="true" />
          <span>历史记录</span>
          {history.length > 0 && <small>{history.length}</small>}
        </button>
      </nav>

      {activeSection === "annotations" && (
        <>
          {doc && groups.all.length > 0 && (
            <label className="sidebar-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={featureQuery}
                onChange={(event) => setFeatureQuery(event.target.value)}
                placeholder="查找特征"
                aria-label="查找特征"
              />
            </label>
          )}
          <nav className="sidebar-annotation-filters" aria-label="注释筛选">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeFilter === item.id ? "active" : ""}
                onClick={() => setActiveFilter(item.id)}
                aria-pressed={activeFilter === item.id}
                title={item.id === "restriction" ? "酶切位点" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <section className="sidebar-detail" aria-live="polite">
            {!doc && <p className="sidebar-empty">打开序列以填充此项目。</p>}
            {doc && visibleFeatures.length > 0 && (
              <FeatureList
                items={visibleFeatures}
                empty={emptyMessage}
                selection={selection}
                onSelect={selectFeature}
              />
            )}
            {doc && visibleFeatures.length === 0 && (
              <div className="sidebar-empty-state">
                <List aria-hidden="true" />
                <strong>
                  {featureQuery
                    ? "没有匹配此搜索的注释"
                    : emptyMessage}
                </strong>
                <p>
                  {featureQuery
                    ? "换个名称搜索或清除搜索。"
                    : groups.all.length === 0
                      ? selection && selection.length > 0
                        ? `已选中 ${selection.length.toLocaleString()} bp，可以添加注释。`
                        : "先在序列编辑器中选中一个区域，再在这里添加注释。"
                      : "选择其他注释筛选以查看其余特征。"}
                </p>
                {featureQuery ? (
                  <button type="button" onClick={() => setFeatureQuery("")}>清除搜索</button>
                ) : groups.all.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveSection("inspector")}
                    disabled={!selection || selection.length === 0}
                  >
                    {selection && selection.length > 0 ? "添加选中区域" : "请先选中区域"}
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}

      {activeSection === "inspector" && (
        <section className="sidebar-detail sidebar-detail--inspector" aria-live="polite">
          <SequenceInspector
            doc={doc}
            selection={selection}
            feature={selectedFeature}
            onUpdateFeature={(feature) => onUpdateFeature?.(feature)}
            onDeleteFeature={(id) => onDeleteFeature?.(id)}
            onAddFeature={(input) => onAddFeatureFromSelection?.(input)}
            onExtractSelection={() => onExtractSelection?.()}
          />
        </section>
      )}

      {activeSection === "history" && (
        <section className="sidebar-detail sidebar-detail--history" aria-live="polite">
          <DocumentHistoryPanel
            history={history}
            onRestore={(id, version) => onRestoreHistory?.(id, version)}
            onClear={() => onClearHistory?.()}
          />
        </section>
      )}
    </aside>
  );
}

export default Sidebar;
