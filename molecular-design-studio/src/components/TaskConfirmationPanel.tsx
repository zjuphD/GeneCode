/**
 * TaskConfirmationPanel — structured parameter input for missing/assumed values.
 *
 * Renders missing parameters as input fields, blockers as errors,
 * assumptions as dismissible notices, and warnings as alerts.
 * Replaces pure-chat-based parameter collection.
 */

import { useState, useCallback } from "react";
import { AlertCircle, AlertTriangle, ChevronDown } from "lucide-react";
import type { TaskConfirmation, TaskConfirmationItem } from "../agent/responseTypes";

interface TaskConfirmationPanelProps {
  confirmation: TaskConfirmation;
  onSubmit: (params: Record<string, string>) => void;
}

// ── Parameter input field mapping ──────────────────────────

const PARAM_INPUT_CONFIG: Record<string, {
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "select" | "checkbox";
}> = {
  insertSequence: { label: "插入片段序列", placeholder: "粘贴 FASTA 或原始序列…", type: "textarea" },
  insertName: { label: "插入片段名称", placeholder: "例如：GFP 或 APOBEC3A", type: "text" },
  sequence: { label: "模板序列", placeholder: "粘贴序列或 FASTA…", type: "textarea" },
  query: { label: "目标基因或登录号", placeholder: "例如：GAPDH 或 NM_002046", type: "text" },
  species: { label: "物种", placeholder: "例如：Homo sapiens", type: "text" },
  strain: { label: "品系或分离株", placeholder: "例如：C57BL/6", type: "text" },
  method: { label: "克隆方法", placeholder: "Gibson、酶切或 Golden Gate", type: "text" },
  leftHomology: { label: "左同源臂", placeholder: "15-40 bp", type: "text" },
  rightHomology: { label: "右同源臂", placeholder: "15-40 bp", type: "text" },
  forwardSite: { label: "正向酶切位点", placeholder: "例如：EcoRI", type: "text" },
  reverseSite: { label: "反向酶切位点", placeholder: "例如：BamHI", type: "text" },
  mutationMode: { label: "突变方式", placeholder: "DNA 或氨基酸", type: "text" },
  position: { label: "突变位置", placeholder: "例如：42", type: "text" },
  reference: { label: "参考序列", placeholder: "例如：ATG", type: "text" },
  alternate: { label: "目标序列", placeholder: "例如：GCG", type: "text" },
  cdsStart: { label: "CDS 起始", placeholder: "例如：1", type: "text" },
  aaPosition: { label: "氨基酸位置", placeholder: "例如：14", type: "text" },
  sourceAa: { label: "源氨基酸", placeholder: "例如：M", type: "text" },
  targetAa: { label: "目标氨基酸", placeholder: "例如：A", type: "text" },
  vectorSequence: { label: "载体序列", placeholder: "粘贴载体序列…", type: "textarea" },
  insertionAnchorLabel: { label: "插入位置", placeholder: "载体上的 CDS 或特征名称", type: "text" },
  insertionAnchorSide: { label: "相对位置", placeholder: "之后、之前、下游或上游", type: "text" },
  expressionStrategy: { label: "表达策略", placeholder: "选择表达策略", type: "select" },
  removeUpstreamStop: { label: "移除上游终止密码子", placeholder: "", type: "checkbox" },
  selectedAccession: { label: "已选登录号", placeholder: "例如：NM_002046.3", type: "text" },
};

function formatUnknownKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function getConfigForKey(key: string) {
  return PARAM_INPUT_CONFIG[key] ?? {
    label: formatUnknownKey(key),
    placeholder: `Enter ${formatUnknownKey(key).toLowerCase()}...`,
    type: "text" as const,
  };
}

// ── Components ─────────────────────────────────────────────

function BlockerCard({ item }: { item: TaskConfirmationItem }) {
  return (
    <div className="task-confirmation__blocker">
      <AlertCircle className="task-confirmation__icon" aria-hidden="true" />
      <span>{item.label}</span>
    </div>
  );
}

function WarningCard({ item }: { item: TaskConfirmationItem }) {
  return (
    <div className="task-confirmation__warning">
      <AlertTriangle className="task-confirmation__icon" aria-hidden="true" />
      <span>{item.label}</span>
    </div>
  );
}

function AssumptionCard({ item }: { item: TaskConfirmationItem }) {
  return (
    <div className="task-confirmation__assumption">
      <span>{item.label}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function TaskConfirmationPanel({ confirmation, onSubmit }: TaskConfirmationPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    // Only submit non-empty values
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) filled[k] = v.trim();
    }
    if (Object.keys(filled).length > 0) {
      onSubmit(filled);
    }
  }, [values, onSubmit]);

  const filledCount = Object.values(values).filter((v) => v.trim()).length;
  const totalMissing = confirmation.missingParameters.length;

  return (
    <div className="task-confirmation">
      {/* Blockers — hard stop */}
      {confirmation.blockers.length > 0 && (
        <div className="task-confirmation__section">
          <div className="task-confirmation__section-title">阻断项</div>
          {confirmation.blockers.map((item, i) => (
            <BlockerCard key={item.key || i} item={item} />
          ))}
        </div>
      )}

      {/* Missing parameters — input fields */}
      {confirmation.missingParameters.length > 0 && (
        <div className="task-confirmation__section">
          <div className="task-confirmation__section-title">
            必填输入
            {totalMissing > 0 && (
              <span className="task-confirmation__counter">
                {filledCount}/{totalMissing}
              </span>
            )}
          </div>
          {confirmation.missingParameters.map((item, index) => {
            const config = getConfigForKey(item.key);
            const inputType = item.kind ?? config.type;
            const options = item.options ?? [];
            const fieldId = `task-confirmation-${item.key || "missing"}-${index}`;
            return (
              <div key={`${item.key}-${index}`} className="task-confirmation__field">
                <label className="task-confirmation__label" htmlFor={fieldId}>{config.label}</label>
                {inputType === "textarea" ? (
                  <textarea
                    id={fieldId}
                    className="task-confirmation__textarea"
                    placeholder={config.placeholder}
                    value={values[item.key] ?? ""}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                    rows={3}
                  />
                ) : inputType === "select" ? (
                  <select
                    id={fieldId}
                    className="task-confirmation__input"
                    value={values[item.key] ?? ""}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                  >
                    <option value="">{config.placeholder}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : inputType === "checkbox" || inputType === "confirmation" ? (
                  <label className="task-confirmation__checkbox">
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={values[item.key] === "true"}
                      onChange={(e) => handleChange(item.key, e.target.checked ? "true" : "")}
                    />
                    <span>{item.prompt || item.label}</span>
                  </label>
                ) : (
                  <input
                    id={fieldId}
                    className="task-confirmation__input"
                    type="text"
                    placeholder={config.placeholder}
                    value={values[item.key] ?? ""}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            onClick={handleSubmit}
            disabled={filledCount === 0}
          >
            {filledCount > 0
              ? `提交参数（${filledCount} 项）`
              : "补全必填输入"}
          </button>
        </div>
      )}

      {/* Assumptions — informational */}
      {confirmation.assumptions.length > 0 && (
        <div className="task-confirmation__section">
          <details className="agent-disclosure">
          <summary>采用的假设<span>{confirmation.assumptions.length} 项</span><ChevronDown aria-hidden="true" /></summary>
          {confirmation.assumptions.map((item, i) => (
            <AssumptionCard key={item.key || i} item={item} />
          ))}
          </details>
        </div>
      )}

      {/* Warnings — attention needed */}
      {confirmation.warnings.length > 0 && (
        <div className="task-confirmation__section">
          <div className="task-confirmation__section-title">警告</div>
          {confirmation.warnings.map((item, i) => (
            <WarningCard key={item.key || i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
