/**
 * Structured entry point for complex cloning plans.
 *
 * The chat remains available for natural-language tasks, while this compact
 * form gives multi-fragment designs an unambiguous ordered input surface.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentStructuredInputs } from "../agent/service";
// A-ALG-002: from the single enzyme-data.json source.
import {
  COMMON_TYPE_IIS_ENZYMES,
  DEFAULT_GOLDEN_GATE_ENZYME,
} from "../editor/enzymeData";

interface FragmentDraft {
  name: string;
  sequence: string;
  sourceProjectId?: string;
}

export interface AgentProjectSequence {
  id: string;
  name: string;
  sequence: string;
  circular: boolean;
  featureCount: number;
}

interface CloningSetupPanelProps {
  busy: boolean;
  available: boolean;
  onSubmit: (
    message: string,
    inputs: AgentStructuredInputs,
    displayMessage: string,
  ) => void;
  sequenceLibrary?: AgentProjectSequence[];
  activeProjectId?: string | null;
}

const MIN_FRAGMENT_COUNT = 2;
const MAX_FRAGMENT_COUNT = 8;

function sequenceLength(value: string): number {
  return value.replace(/[^A-Za-z]/g, "").length;
}

function parseTokens(value: string): string[] {
  return value
    .split(/[,，、;；\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function CloningSetupPanel({
  busy,
  available,
  onSubmit,
  sequenceLibrary = [],
  activeProjectId = null,
}: CloningSetupPanelProps) {
  const [method, setMethod] = useState<"gibson" | "golden_gate">("gibson");
  const [fragments, setFragments] = useState<FragmentDraft[]>([
    { name: "Fragment 1", sequence: "" },
    { name: "Fragment 2", sequence: "" },
  ]);
  const [leftHomology, setLeftHomology] = useState("");
  const [rightHomology, setRightHomology] = useState("");
  const [typeIisEnzyme, setTypeIisEnzyme] = useState(DEFAULT_GOLDEN_GATE_ENZYME);
  const [leftOverhang, setLeftOverhang] = useState("");
  const [fragmentOverhangs, setFragmentOverhangs] = useState("");
  const [rightOverhang, setRightOverhang] = useState("");
  const [clampLength, setClampLength] = useState("4");
  const [error, setError] = useState<string | null>(null);

  const updateFragment = (index: number, patch: Partial<FragmentDraft>) => {
    setFragments((previous) => previous.map((fragment, fragmentIndex) => (
      fragmentIndex === index ? { ...fragment, ...patch } : fragment
    )));
    setError(null);
  };

  const selectProjectSequence = (index: number, projectId: string) => {
    const project = sequenceLibrary.find((item) => item.id === projectId);
    if (!project) return;
    setFragments((previous) => previous.map((fragment, fragmentIndex) => (
      fragmentIndex === index
        ? { ...fragment, name: project.name, sequence: project.sequence, sourceProjectId: project.id }
        : fragment
    )));
    setError(null);
  };

  const clearProjectSequence = (index: number) => {
    setFragments((previous) => previous.map((fragment, fragmentIndex) => (
      fragmentIndex === index
        ? { ...fragment, sourceProjectId: undefined }
        : fragment
    )));
  };

  const addFragment = () => {
    if (fragments.length >= MAX_FRAGMENT_COUNT) return;
    setFragments((previous) => [
      ...previous,
      { name: `Fragment ${previous.length + 1}`, sequence: "" },
    ]);
  };

  const removeFragment = (index: number) => {
    if (fragments.length <= MIN_FRAGMENT_COUNT) return;
    setFragments((previous) => previous.filter((_, fragmentIndex) => fragmentIndex !== index));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filledFragments = fragments.map((fragment, index) => ({
      name: fragment.name.trim() || `Fragment ${index + 1}`,
      sequence: fragment.sequence,
    }));
    const missingIndex = filledFragments.findIndex((fragment) => sequenceLength(fragment.sequence) === 0);
    if (missingIndex >= 0) {
      setError(`请先为 ${filledFragments[missingIndex]?.name || `片段 ${missingIndex + 1}`} 填写序列。`);
      return;
    }

    const inputs: AgentStructuredInputs = {
      method,
      fragments: filledFragments,
    };
    if (method === "gibson") {
      if (leftHomology.trim()) inputs.leftHomology = leftHomology;
      if (rightHomology.trim()) inputs.rightHomology = rightHomology;
    } else {
      const internalOverhangs = parseTokens(fragmentOverhangs);
      if (!leftOverhang.trim() || !rightOverhang.trim()) {
        setError("Golden Gate 需要左、右载体突出端以及各内部突出端。");
        return;
      }
      if (internalOverhangs.length !== filledFragments.length - 1) {
        const requiredOverhangs = filledFragments.length - 1;
        setError(`${filledFragments.length} 个片段需要 ${requiredOverhangs} 个内部突出端。`);
        return;
      }
      inputs.typeIisEnzyme = typeIisEnzyme;
      inputs.leftOverhang = leftOverhang;
      inputs.fragmentOverhangs = internalOverhangs;
      inputs.rightOverhang = rightOverhang;
      inputs.goldenGateClampLength = Number(clampLength) || 0;
    }

    const methodLabel = method === "gibson" ? "Gibson / homologous recombination" : `Golden Gate / ${typeIisEnzyme}`;
    const displayMessage = `Structured setup: ${methodLabel} · ${filledFragments.length} fragments`;
    onSubmit(
      `Plan a ${method === "gibson" ? "multi-fragment Gibson cloning" : "multi-fragment Golden Gate cloning"} workflow for the current vector using these structured inputs.`,
      inputs,
      displayMessage,
    );
  };

  return (
    <details className="agent-cloning-setup">
      <summary>
        <span>多片段克隆</span>
        <span className="agent-cloning-setup__summary-detail">
          {fragments.length} fragments · {method === "gibson" ? "Gibson" : "Golden Gate"}
        </span>
      </summary>
      <div className="agent-cloning-setup__body">
        <p className="agent-cloning-setup__hint">
          当前打开的序列即载体。片段顺序决定最终组装。提交前先生成计划，不会改动载体。
        </p>
        <form onSubmit={handleSubmit}>
          <label className="agent-cloning-setup__field">
            <span>组装方法</span>
            <select
              aria-label="组装方法"
              value={method}
              onChange={(event) => setMethod(event.target.value as "gibson" | "golden_gate")}
              disabled={busy || !available}
            >
              <option value="gibson">Gibson / 同源重组</option>
              <option value="golden_gate">Golden Gate / Type IIS</option>
            </select>
          </label>

          <div className="agent-cloning-setup__section-header">
            <span>有序片段</span>
            <button
              type="button"
              className="agent-btn agent-btn--secondary agent-cloning-setup__add"
              onClick={addFragment}
              disabled={busy || !available || fragments.length >= MAX_FRAGMENT_COUNT}
            >
              <Plus aria-hidden="true" />
              添加片段
            </button>
          </div>
          <div className="agent-cloning-setup__fragments">
            {fragments.map((fragment, index) => (
              <div className="agent-cloning-setup__fragment" key={index}>
                <div className="agent-cloning-setup__fragment-header">
                  <strong>{index + 1}</strong>
                  <input
                    aria-label={`片段 ${index + 1} 名称`}
                    value={fragment.name}
                    onChange={(event) => updateFragment(index, { name: event.target.value })}
                    disabled={busy || !available}
                  />
                  <span>{sequenceLength(fragment.sequence).toLocaleString()} bp</span>
                  <button
                    type="button"
                    className="agent-btn agent-btn--icon"
                    onClick={() => removeFragment(index)}
                    disabled={busy || !available || fragments.length <= MIN_FRAGMENT_COUNT}
                    aria-label={`移除片段 ${index + 1}`}
                    title="移除片段"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
                {sequenceLibrary.length > 0 && (
                  <label className="agent-cloning-setup__source-field">
                    <span>片段来源</span>
                    <select
                      aria-label={`片段 ${index + 1} 来源`}
                      value={fragment.sourceProjectId ?? ""}
                      onChange={(event) => {
                        if (event.target.value) selectProjectSequence(index, event.target.value);
                        else clearProjectSequence(index);
                      }}
                      disabled={busy || !available}
                    >
                      <option value="">手动粘贴序列</option>
                      {sequenceLibrary
                        .filter((project) => project.id !== activeProjectId)
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name} · {project.sequence.length.toLocaleString()} bp{project.circular ? " · circular" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <textarea
                  aria-label={`片段 ${index + 1} 序列`}
                  placeholder="粘贴 FASTA 或 DNA 序列"
                  value={fragment.sequence}
                  onChange={(event) => updateFragment(index, { sequence: event.target.value, sourceProjectId: undefined })}
                  disabled={busy || !available}
                  rows={3}
                />
              </div>
            ))}
          </div>

          {method === "gibson" ? (
            <div className="agent-cloning-setup__grid">
              <label className="agent-cloning-setup__field">
                <span>载体左侧同源臂 <small>可选；当前选区优先</small></span>
                <input aria-label="载体左侧同源臂" value={leftHomology} onChange={(event) => setLeftHomology(event.target.value)} disabled={busy || !available} placeholder="15–40 bp" />
              </label>
              <label className="agent-cloning-setup__field">
                <span>载体右侧同源臂 <small>可选；当前选区优先</small></span>
                <input aria-label="载体右侧同源臂" value={rightHomology} onChange={(event) => setRightHomology(event.target.value)} disabled={busy || !available} placeholder="15–40 bp" />
              </label>
            </div>
          ) : (
            <div className="agent-cloning-setup__golden-gate">
              <div className="agent-cloning-setup__grid">
                <label className="agent-cloning-setup__field">
                  <span>Type IIS 酶</span>
                  <select aria-label="Type IIS 酶" value={typeIisEnzyme} onChange={(event) => setTypeIisEnzyme(event.target.value)} disabled={busy || !available}>
                    {COMMON_TYPE_IIS_ENZYMES.map((enzyme) => (
                      <option key={enzyme} value={enzyme}>{enzyme}</option>
                    ))}
                  </select>
                </label>
                <label className="agent-cloning-setup__field">
                  <span>钳位长度</span>
                  <input aria-label="钳位长度" type="number" min={0} max={8} value={clampLength} onChange={(event) => setClampLength(event.target.value)} disabled={busy || !available} />
                </label>
              </div>
              <div className="agent-cloning-setup__grid agent-cloning-setup__grid--three">
                <label className="agent-cloning-setup__field">
                  <span>载体左侧边界</span>
                  <input aria-label="载体左侧边界" value={leftOverhang} onChange={(event) => setLeftOverhang(event.target.value)} disabled={busy || !available} placeholder="e.g. AATG" />
                </label>
                <label className="agent-cloning-setup__field">
                  <span>内部突出端 <small>按片段顺序</small></span>
                  <input aria-label="内部突出端" value={fragmentOverhangs} onChange={(event) => setFragmentOverhangs(event.target.value)} disabled={busy || !available} placeholder="e.g. GCTT, CGAG" />
                </label>
                <label className="agent-cloning-setup__field">
                  <span>载体右侧边界</span>
                  <input aria-label="载体右侧边界" value={rightOverhang} onChange={(event) => setRightOverhang(event.target.value)} disabled={busy || !available} placeholder="e.g. TCCA" />
                </label>
              </div>
            </div>
          )}

          {error && <p className="agent-cloning-setup__error" role="alert">{error}</p>}
          <button
            type="submit"
            className="agent-btn agent-btn--primary agent-cloning-setup__submit"
            disabled={busy || !available}
          >
            生成克隆计划
          </button>
        </form>
      </div>
    </details>
  );
}
