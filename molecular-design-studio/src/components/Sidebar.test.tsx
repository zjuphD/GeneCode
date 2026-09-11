import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { SequenceDocument, SequenceFeature } from "../types";
import type { ProjectEntry } from "../workspace/projectPersistence";

const FEATURES: SequenceFeature[] = [
  { id: "f1", name: "AmpR", type: "CDS", start: 10, end: 90, strand: 1, qualifiers: {} },
  { id: "f2", name: "Primer F", type: "primer_bind", start: 100, end: 120, strand: 1, qualifiers: {} },
  { id: "f3", name: "EcoRI cut site", type: "restriction_site", start: 150, end: 156, strand: 1, qualifiers: {} },
];

function makeDoc(): SequenceDocument {
  return {
    name: "pTest",
    sequence: "A".repeat(300),
    circular: true,
    features: FEATURES,
  };
}

function makeProject(doc: SequenceDocument): ProjectEntry {
  return {
    id: "p1",
    name: "pTest",
    doc,
    filePath: null,
    isDirty: false,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("Sidebar", () => {
  const onSelectFeature = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("genecode-sidebar-width");
  });

  function renderSidebar(selection: import("../types").SequenceSelection | null = null) {
    const doc = makeDoc();
    return render(
      <Sidebar
        doc={doc}
        selection={selection}
        projects={[makeProject(doc)]}
        activeId="p1"
        onCreateProject={vi.fn()}
        onSwitchProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onSelectFeature={onSelectFeature}
      />,
    );
  }

  it("shows one annotation browser instead of separate feature pages", () => {
    renderSidebar();
    expect(screen.getByText("特征")).toBeDefined();
    expect(screen.getByLabelText("注释筛选")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sequences" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cloning" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restriction Map" })).toBeNull();
  });

  it("offers portable project open and save actions", () => {
    const onOpenProject = vi.fn();
    const onSaveProject = vi.fn();
    const doc = makeDoc();
    render(
      <Sidebar
        doc={doc}
        selection={null}
        projects={[makeProject(doc)]}
        activeId="p1"
        onCreateProject={vi.fn()}
        onOpenProject={onOpenProject}
        onSaveProject={onSaveProject}
        onSwitchProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 GeneCode 项目" }));
    fireEvent.click(screen.getByRole("button", { name: "保存 GeneCode 项目" }));
    expect(screen.getByText("打开")).toBeDefined();
    expect(screen.getByText("保存")).toBeDefined();
    expect(screen.getByText("新建")).toBeDefined();
    expect(onOpenProject).toHaveBeenCalledOnce();
    expect(onSaveProject).toHaveBeenCalledOnce();
  });

  it("turns an empty annotation area into a selection-driven next action", () => {
    const doc: SequenceDocument = {
      name: "empty-features",
      sequence: "A".repeat(120),
      circular: false,
      features: [],
    };
    const props = {
      doc,
      projects: [makeProject(doc)],
      activeId: "p1",
      onCreateProject: vi.fn(),
      onSwitchProject: vi.fn(),
      onRenameProject: vi.fn(),
      onDeleteProject: vi.fn(),
    };
    const view = render(<Sidebar {...props} selection={null} />);

    const chooseRegion = screen.getByRole("button", { name: "请先选中区域" }) as HTMLButtonElement;
    expect(chooseRegion.disabled).toBe(true);

    view.rerender(
      <Sidebar
        {...props}
        selection={{
          start: 10,
          end: 30,
          length: 20,
          wrapsOrigin: false,
          sequence: "A".repeat(20),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加选中区域" }));
    expect(screen.getByRole("button", { name: "检查器" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters annotations without changing tools or workspaces", () => {
    renderSidebar();
    expect(screen.getByText("AmpR")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "引物" }));
    expect(screen.getByText("Primer F")).toBeDefined();
    expect(screen.queryByText("AmpR")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "酶切位点" }));
    expect(screen.getByText("EcoRI cut site")).toBeDefined();
    expect(screen.queryByText("Primer F")).toBeNull();
  });

  it("selects an annotation in the editor", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Primer F/ }));
    expect(onSelectFeature).toHaveBeenCalledWith(FEATURES[1]);
  });

  it("marks the annotation matching the current selection", () => {
    renderSidebar({
      start: 100,
      end: 120,
      length: 20,
      wrapsOrigin: false,
      sequence: "A".repeat(20),
    });
    const primer = screen.getByRole("button", { name: /Primer F/ });
    expect(primer.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the inspector when a feature becomes selected from the editor", () => {
    const doc = makeDoc();
    const props = {
      doc,
      projects: [makeProject(doc)],
      activeId: "p1",
      onCreateProject: vi.fn(),
      onSwitchProject: vi.fn(),
      onRenameProject: vi.fn(),
      onDeleteProject: vi.fn(),
      onSelectFeature,
    };
    const view = render(<Sidebar {...props} selection={null} />);

    view.rerender(
      <Sidebar
        {...props}
        selection={{
          start: 100,
          end: 120,
          length: 20,
          wrapsOrigin: false,
          sequence: "A".repeat(20),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "检查器" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Primer F")).toBeDefined();
  });

  it("resizes without jumping and restores the saved width", () => {
    const view = renderSidebar();
    const handle = screen.getByTitle("拖动调整宽度");
    fireEvent.mouseDown(handle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 300 });

    const sidebar = view.container.querySelector(".sidebar") as HTMLElement;
    expect(sidebar.style.width).toBe("300px");

    fireEvent.mouseUp(document);
    expect(window.localStorage.getItem("genecode-sidebar-width")).toBe("300");

    view.unmount();
    const restored = renderSidebar();
    const restoredSidebar = restored.container.querySelector(".sidebar") as HTMLElement;
    expect(restoredSidebar.style.width).toBe("300px");
  });

  it("gives the inspector room and keeps sequence files available on demand", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "检查器" }));
    expect(screen.queryByRole("searchbox", { name: "搜索并筛选文件" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开序列文件" }));
    expect(screen.getByRole("searchbox", { name: "搜索并筛选文件" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "收起序列文件" }));
    expect(screen.queryByRole("searchbox", { name: "搜索并筛选文件" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /特征/ }));
    expect(screen.getByRole("searchbox", { name: "搜索并筛选文件" })).toBeDefined();
  });
});
