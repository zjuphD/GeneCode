import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dna, FlaskConical, GitMerge, Scissors, X } from "lucide-react";
import type { SequenceDocument, SequenceSelection } from "../types";
import {
  simulateAssembly,
  type AssemblyMethod,
  type AssemblyResult,
} from "../editor/assembly";
// A-ALG-002: from the single enzyme-data.json source.
import { DEFAULT_GOLDEN_GATE_ENZYME, GOLDEN_GATE_ENZYMES } from "../editor/enzymeData";

const TYPE_IIS_OPTIONS: readonly string[] = [...GOLDEN_GATE_ENZYMES];

const CHECK_TONE_TEXT: Record<string, string> = {
  passed: "通过",
  warning: "建议",
  failed: "需修正",
  info: "提示",
};

interface CloningWizardDialogProps {
  vector: SequenceDocument;
  selection: SequenceSelection | null;
  onCreate: (construct: SequenceDocument) => void;
  onCancel: () => void;
}

export function CloningWizardDialog({
  vector,
  selection,
  onCreate,
  onCancel,
}: CloningWizardDialogProps) {
  // A-A11Y-001: Escape closes the dialog; focus returns to the trigger on
  // close. The trigger is captured once on mount (a callback-identity dep would
  // re-run and re-capture the dialog's own input as "previously focused").
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);
  const [method, setMethod] = useState<AssemblyMethod>("gibson");
  const [insertSource, setInsertSource] = useState<"selection" | "paste">(
    selection && selection.length > 0 ? "selection" : "paste",
  );
  const [insertName, setInsertName] = useState(
    selection && selection.length > 0 ? `${vector.name} insert` : "Insert",
  );
  const [insertSequence, setInsertSequence] = useState("");
  const [insertAt, setInsertAt] = useState(String((selection?.start ?? 0) + 1));
  const [gibsonLeft, setGibsonLeft] = useState("");
  const [gibsonRight, setGibsonRight] = useState("");
  const [ggEnzyme, setGgEnzyme] = useState(DEFAULT_GOLDEN_GATE_ENZYME);
  const [ggLeft, setGgLeft] = useState("");
  const [ggRight, setGgRight] = useState("");
  const [ggClamp, setGgClamp] = useState("4");

  const effectiveInsertSequence =
    insertSource === "selection" && selection ? selection.sequence : insertSequence;
  const effectiveInsertName = insertName.trim() || "Insert";

  const result: AssemblyResult = useMemo(() => {
    return simulateAssembly({
      vector,
      insert: {
        name: effectiveInsertName,
        sequence: effectiveInsertSequence,
        circular: false,
        features: [],
      },
      method,
      insertAt: Math.max(0, (Number(insertAt) || 1) - 1),

      ...(method === "gibson"
        ? {
            gibson: {
              ...(gibsonLeft.trim() ? { leftArm: gibsonLeft } : {}),
              ...(gibsonRight.trim() ? { rightArm: gibsonRight } : {}),
            },
          }
        : {
            goldenGate: {
              enzyme: ggEnzyme,
              leftOverhang: ggLeft,
              rightOverhang: ggRight,
              clampLength: Number(ggClamp) || 0,
              strict: true,
            },
          }),
    });
  }, [
    effectiveInsertName,
    effectiveInsertSequence,
    gibsonLeft,
    gibsonRight,
    ggClamp,
    ggEnzyme,
    ggLeft,
    ggRight,
    insertAt,
    method,
    vector,
  ]);

  const hasSelection = Boolean(selection && selection.length > 0);
  const hasFailedChecks = result.checks.some((check) => check.status === "failed");
  // A strict Golden Gate result is only creatable when the fragment graph was
  // derived from the actual vector recognition sites and both strand cuts.
  // Missing sites or incompatible ends remain a review-only preview.
  const simulationOnly = method === "golden_gate" && !result.goldenGateGraph?.validated;
  const canCreate = result.ok && result.construct !== null && !hasFailedChecks && !simulationOnly;

  return createPortal(
    <div className="paste-sequence-overlay" onMouseDown={onCancel}>
      <div
        className="paste-sequence create-feature-dialog cloning-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloning-wizard-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="paste-sequence__header">
          <div>
            <h2 id="cloning-wizard-title">克隆到载体</h2>
            <p className="create-feature-dialog__selection">
              Vector “{vector.name}” · {vector.sequence.length.toLocaleString()} bp ·{" "}
              {vector.circular ? "circular" : "linear"}
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭克隆对话框">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="cloning-wizard__section">
          <label className="cloning-wizard__field">
            <span>插入片段来源</span>
            <div className="cloning-wizard__source-toggle" role="group" aria-label="插入片段来源">
              <label className={insertSource === "selection" ? "cloning-wizard__source--active" : ""}>
                <input
                  type="radio"
                  name="insert-source"
                  value="selection"
                  checked={insertSource === "selection"}
                  onChange={() => setInsertSource("selection")}
                  disabled={!hasSelection}
                />
                当前选区
                <small>{hasSelection ? `${selection!.length.toLocaleString()} bp` : "请先选中碱基"}</small>
              </label>
              <label className={insertSource === "paste" ? "cloning-wizard__source--active" : ""}>
                <input
                  type="radio"
                  name="insert-source"
                  value="paste"
                  checked={insertSource === "paste"}
                  onChange={() => setInsertSource("paste")}
                />
                粘贴序列
              </label>
            </div>
          </label>
          <label className="cloning-wizard__field">
            <span>插入片段名称</span>
            <input value={insertName} onChange={(event) => setInsertName(event.target.value)} />
          </label>
          {insertSource === "paste" && (
            <label className="cloning-wizard__field">
              <span>插入序列</span>
              <textarea
                value={insertSequence}
                onChange={(event) => setInsertSequence(event.target.value)}
                placeholder="粘贴要克隆的 DNA 序列"
                rows={3}
              />
            </label>
          )}
          <label className="cloning-wizard__field">
            <span>插入位置</span>
            <input
              type="number"
              min={1}
              max={vector.sequence.length + 1}
              value={insertAt}
              onChange={(event) => setInsertAt(event.target.value)}
            />
            <small className="cloning-wizard__field-hint">
              {vector.circular
                ? "载体在此碱基之前切开，插入片段放置于此。"
                : "插入片段放置于此碱基之前（N+1 时追加到末尾）。"}
            </small>
          </label>
        </div>

        <div className="cloning-wizard__section">
          <label className="cloning-wizard__field">
            <span>组装方法</span>
            <select
              aria-label="组装方法"
              value={method}
              onChange={(event) => setMethod(event.target.value as AssemblyMethod)}
            >
              <option value="gibson">Gibson / 同源重组</option>
              <option value="golden_gate">Golden Gate / Type IIS</option>
            </select>
          </label>
          {method === "gibson" ? (
            <div className="cloning-wizard__grid">
              <label className="cloning-wizard__field">
                <span>左同源臂 <small>可选</small></span>
                <input
                  value={gibsonLeft}
                  onChange={(event) => setGibsonLeft(event.target.value)}
                  placeholder="自动取自载体末端"
                />
              </label>
              <label className="cloning-wizard__field">
                <span>右同源臂 <small>可选</small></span>
                <input
                  value={gibsonRight}
                  onChange={(event) => setGibsonRight(event.target.value)}
                  placeholder="自动取自载体末端"
                />
              </label>
            </div>
          ) : (
            <div className="cloning-wizard__grid cloning-wizard__grid--three">
              <label className="cloning-wizard__field">
                <span>Type IIS 酶</span>
                <select value={ggEnzyme} onChange={(event) => setGgEnzyme(event.target.value)}>
                  {TYPE_IIS_OPTIONS.map((enzyme) => <option key={enzyme} value={enzyme}>{enzyme}</option>)}
                </select>
              </label>
              <label className="cloning-wizard__field">
                <span>载体左侧突出</span>
                <input value={ggLeft} onChange={(event) => setGgLeft(event.target.value)} placeholder="e.g. AATG" />
              </label>
              <label className="cloning-wizard__field">
                <span>载体右侧突出</span>
                <input value={ggRight} onChange={(event) => setGgRight(event.target.value)} placeholder="e.g. TCCA" />
              </label>
              <label className="cloning-wizard__field">
                <span>钳位长度</span>
                <input type="number" min={0} max={8} value={ggClamp} onChange={(event) => setGgClamp(event.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="cloning-wizard__result">
          <div className="cloning-wizard__result-header">
            <GitMerge aria-hidden="true" />
            <strong>模拟构建体</strong>
            {result.ok && result.construct && (
              <span className="cloning-wizard__result-meta">
                {result.construct.name} · {result.construct.sequence.length.toLocaleString()} bp ·{" "}
                {result.construct.circular ? "circular" : "linear"}
              </span>
            )}
          </div>

          <div className="cloning-wizard__notice" role="note">
            <strong>模拟结果——未经实验验证</strong>
            <span>
              {method === "golden_gate"
                ? result.goldenGateGraph?.validated
                  ? "已按载体的 Type IIS 双链切点和兼容突出端生成片段图；结果仍是计算预测，需在实验室验证酶活、甲基化和组装效率。"
                  : "需要载体两处可验证的 Type IIS 位点、无内部位点且突出端兼容，当前仅显示预览，不能创建构建体。"
                : "Gibson 组装为启发式模拟（同源臂长度 / GC 检查）。订购前请实验验证连接处。"}
            </span>
          </div>

          {!result.ok && result.errors.length > 0 && (
            <ul className="cloning-wizard__errors" role="alert">
              {result.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}

          {result.junctions.length > 0 && (
            <div className="cloning-wizard__junctions">
              {result.junctions.map((junction) => (
                <div className="cloning-wizard__junction" key={junction.side}>
                  <div className="cloning-wizard__junction-label">
                    <strong>{junction.label}</strong>
                    <span>{junction.overlap.length} bp {method === "gibson" ? "重叠" : "突出端"}</span>
                  </div>
                  <code>{junction.assembledPreview}</code>
                  <small>
                    {method === "gibson" ? "重叠" : "突出端"} {junction.overlap}
                  </small>
                </div>
              ))}
            </div>
          )}
          <div className="cloning-wizard__checks">
            {result.checks.length === 0 && <p className="cloning-wizard__checks-empty">没有可报告的自检项。</p>}
            {result.checks.map((check) => (
              <div className={`cloning-wizard__check cloning-wizard__check--${check.status}`} key={check.key}>
                <span className="cloning-wizard__check-status">
                  {CHECK_TONE_TEXT[check.status]}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  {check.detail && <p>{check.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="paste-sequence__actions">
          <span className="cloning-wizard__footnote">
            {method === "gibson" ? <FlaskConical aria-hidden="true" /> : <Scissors aria-hidden="true" />}
            {method === "gibson"
              ? "构建体会作为新文档打开；可使用 Agent 从连接处设计 Gibson 引物。"
              : result.goldenGateGraph?.validated
                ? `已按 ${ggEnzyme} 双链切点生成构建体；请在实验前复核所有片段和内部位点。`
                : `Golden Gate 当前仅为预览：需要真实 ${ggEnzyme} 位点和兼容突出端后才能创建构建体。`}
          </span>
          <button type="button" className="editor-start__secondary" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="editor-start__primary"
            onClick={() => result.construct && onCreate(result.construct)}
            disabled={!canCreate}
            title={simulationOnly ? "Golden Gate 当前仅供预览，完成真实 Type IIS 切点模型前不可创建构建体" : canCreate ? "将模拟构建体作为新文档打开" : "请先修正上方错误"}
          >
            <Dna aria-hidden="true" />
            {simulationOnly ? "仅预览（不可创建）" : "创建构建体"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
