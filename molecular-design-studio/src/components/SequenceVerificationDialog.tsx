import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ClipboardCopy, FileUp, GitCompareArrows, X } from "lucide-react";
import type { SequenceDocument } from "../types";
import { parseAb1File, type Ab1TraceData } from "../editor/ab1Parser";
import {
  normalizeVerificationSequence,
  verifySequence,
  type SequenceVerificationResult,
  type VerificationChange,
} from "../editor/sequenceVerification";

interface SequenceVerificationDialogProps {
  doc: SequenceDocument;
  onClose: () => void;
  /** Opens the engine AlignmentView with a trace read against the reference. */
  onOpenAlignment?: (request: {
    name: string;
    sequence: string;
    chromatogramData?: Ab1TraceData;
  }) => void;
}

function formatLocation(result: SequenceVerificationResult, referenceLength: number): string {
  const start = result.referenceStart + 1;
  const end = result.referenceEnd === 0 && !result.wrapsOrigin
    ? referenceLength
    : result.referenceEnd;
  return result.wrapsOrigin ? `${start}-end / 1-${end}` : `${start}-${end}`;
}

function changeLabel(change: VerificationChange): string {
  if (change.kind === "insertion") {
    return `读段第 ${(change.queryPosition ?? 0) + 1} 位插入 ${change.queryBase}`;
  }
  const position = (change.referencePosition ?? 0) + 1;
  if (change.kind === "deletion") return `参考第 ${position} 位缺失 ${change.referenceBase}`;
  return `参考第 ${position} 位 ${change.referenceBase} → ${change.queryBase}`;
}

function buildVerificationReport(
  name: string,
  doc: SequenceDocument,
  result: SequenceVerificationResult,
): string {
  return [            `序列比对验证：${name || "粘贴读段"}`,
    `Reference: ${doc.name} (${doc.sequence.length} bp, ${doc.circular ? "circular" : "linear"})`,
    `Orientation: ${result.orientation}`,
    `Reference location: ${formatLocation(result, doc.sequence.length)}`,
    `Identity: ${result.identityPercent.toFixed(2)}%`,
    `Query coverage: ${result.queryCoveragePercent.toFixed(1)}%`,
    `Matches: ${result.matches}`,
    `Substitutions: ${result.substitutions}`,
    `Insertions: ${result.insertions}`,
    `Deletions: ${result.deletions}`,
    result.changes.length
      ? `Changes:\n${result.changes.map((change) => `- ${changeLabel(change)}`).join("\n")}`
      : "变化：无",
  ].join("\n");
}

export function SequenceVerificationDialog({ doc, onClose, onOpenAlignment }: SequenceVerificationDialogProps) {
  const [readName, setReadName] = useState("Sequencing read");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SequenceVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [trace, setTrace] = useState<Ab1TraceData | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const normalizedLength = useMemo(() => normalizeVerificationSequence(query).length, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const runVerification = (sequenceOverride?: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    window.setTimeout(() => {
      try {
        setResult(verifySequence(doc.sequence, sequenceOverride ?? query, doc.circular));
      } catch (value) {
        setError(value instanceof Error ? value.message : "无法比较这些序列");
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const copyReport = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildVerificationReport(readName, doc, result));
      setCopyStatus("报告已复制");
    } catch {
      setCopyStatus("剪贴板不可用");
    }
  };

  const loadTraceFile = async (file: File | undefined) => {
    if (!file) return;
    setTraceLoading(true);
    setTraceError(null);
    setTrace(null);
    try {
      const parsed = await parseAb1File(file);
      setTrace(parsed);
      const fileBase = file.name.replace(/\.(ab1|abi)$/i, "");
      setReadName(fileBase || parsed.name || "Sequencing read");
      setQuery(parsed.sequence);
      // Import → compare in one motion: run the verification immediately.
      runVerification(parsed.sequence);
    } catch (value) {
      setTraceError(value instanceof Error ? value.message : "无法解析 ABI 色谱文件");
    } finally {
      setTraceLoading(false);
      // Allow selecting the same file again after a failed parse.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openTraceAlignment = () => {
    if (!trace || !onOpenAlignment) return;
    onOpenAlignment({ name: readName, sequence: trace.sequence, chromatogramData: trace });
    onClose();
  };

  return createPortal(
    <div className="verification-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="verification-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="verification-dialog__header">
          <span className="verification-dialog__icon" aria-hidden="true"><GitCompareArrows /></span>
          <div>
            <h2 id="verification-title">与测序读段比对</h2>
            <p>将粘贴的读段按两个方向与 {doc.name} 比对。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭序列比对"><X aria-hidden="true" /></button>
        </header>

        <div className="verification-dialog__body">
          <div className="verification-inputs">
            <label>
              <span>读段名称</span>
              <input value={readName} onChange={(event) => setReadName(event.target.value)} />
            </label>
            <label>
              <span>DNA 序列</span>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="粘贴 Sanger 读段，或从下方加载 .ab1 色谱文件…"
                autoFocus
              />
            </label>
            <div className="verification-trace-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".ab1,.abi"
                aria-label="加载 ABI 色谱文件"
                onChange={(event) => loadTraceFile(event.target.files?.[0])}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={traceLoading}>
                <FileUp aria-hidden="true" />
                {traceLoading ? "正在解析色谱…" : "加载 .ab1 色谱"}
              </button>
              {trace && <span className="verification-trace-badge">{trace.sequence.length.toLocaleString()} bp trace</span>}
            </div>
            {traceError && <p className="verification-error" role="alert">{traceError}</p>}
            <div className="verification-inputs__footer">
              <span>{normalizedLength.toLocaleString()} bases</span>
              <button type="button" onClick={() => runVerification()} disabled={!normalizedLength || running}>
                <GitCompareArrows aria-hidden="true" />
                {running ? "正在比对…" : "开始比对"}
              </button>
            </div>
            {error && <p className="verification-error" role="alert">{error}</p>}
          </div>

          <div className="verification-results" aria-live="polite">
            {!result && !running && (
              <div className="verification-results__empty">
                <GitCompareArrows aria-hidden="true" />
                <strong>准备比对</strong>
                <p>将自动选择最佳的正向或反向定位。</p>
              </div>
            )}
            {running && <div className="verification-results__empty"><span className="verification-spinner" /><strong>正在比对读段</strong></div>}
            {result && (
              <>
                <div className="verification-result__hero">
                  <CheckCircle2 aria-hidden="true" />
                  <div>
                    <strong>{result.identityPercent.toFixed(1)}% identity</strong>
                    <span>{result.orientation} orientation · reference {formatLocation(result, doc.sequence.length)}</span>
                  </div>
                </div>
                <dl className="verification-metrics">
                  <div><dt>读段覆盖率</dt><dd>{result.queryCoveragePercent.toFixed(1)}%</dd></div>
                  <div><dt>匹配数</dt><dd>{result.matches.toLocaleString()}</dd></div>
                  <div><dt>替换</dt><dd>{result.substitutions}</dd></div>
                  <div><dt>插入缺失</dt><dd>{result.insertions + result.deletions}</dd></div>
                </dl>
                <section className="verification-changes">
                  <div className="verification-changes__header">
                    <strong>差异</strong>
                    <span>{result.changes.length}</span>
                  </div>
                  {result.changes.length ? (
                    <ol>{result.changes.slice(0, 40).map((change, index) => <li key={`${change.kind}-${index}`}>{changeLabel(change)}</li>)}</ol>
                  ) : <p>未检测到序列差异。</p>}
                  {result.changes.length > 40 && <small>显示前 40 处差异。</small>}
                </section>
                <div className="verification-result__footer">
                  <span>{result.method === "gapped" ? "带空位比对" : "快速无空位定位"}</span>
                  <button type="button" onClick={copyReport}><ClipboardCopy aria-hidden="true" /> 复制报告</button>
                  {trace && onOpenAlignment && (
                    <button type="button" className="verification-result__align" onClick={openTraceAlignment}>
                      <GitCompareArrows aria-hidden="true" /> 打开色谱比对
                    </button>
                  )}
                </div>
                {copyStatus && <p className="verification-copy-status" role="status">{copyStatus}</p>}
              </>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
