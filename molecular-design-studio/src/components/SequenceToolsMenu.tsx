import { useEffect, useMemo, useRef, useState } from "react";
import Activity from "@mui/icons-material/AnalyticsRounded";
import ChevronDown from "@mui/icons-material/ExpandMoreRounded";
import Dna from "@mui/icons-material/BiotechRounded";
import FilePlus2 from "@mui/icons-material/NoteAddRounded";
import GitCompareArrows from "@mui/icons-material/CompareArrowsRounded";
import RefreshCcw from "@mui/icons-material/AutorenewRounded";
import ScanSearch from "@mui/icons-material/FindInPageRounded";
import Scissors from "@mui/icons-material/ContentCutRounded";
import Sparkles from "@mui/icons-material/AutoAwesomeRounded";
import Wrench from "@mui/icons-material/BuildRounded";
import type { SequenceDocument, SequenceSelection } from "../types";
import {
  analyzeSequence,
  findCommonFeatureAnnotations,
  findOpenReadingFrames,
  reverseComplementDocument,
  scanRestrictionSites,
} from "../editor/sequenceAnalysis";
import { analyzeSequenceInWorker } from "../performance/sequenceWorkerClient";
import { extractSelectionDocument } from "../editor/sequenceActions";
import { SequenceVerificationDialog } from "./SequenceVerificationDialog";
import type { Ab1TraceData } from "../editor/ab1Parser";

interface SequenceToolsMenuProps {
  doc: SequenceDocument;
  selection: SequenceSelection | null;
  onCommitDocument: (doc: SequenceDocument, label: string, source: "annotation" | "manual") => void;
  onCreateDocument: (doc: SequenceDocument) => void;
  onStatus: (message: string, type: "success" | "error") => void;
  /** Opens the engine AlignmentView with a trace read against this document. */
  onOpenTraceAlignment?: (request: {
    name: string;
    sequence: string;
    chromatogramData?: Ab1TraceData;
  }) => void;
}

export function SequenceToolsMenu({
  doc,
  selection,
  onCommitDocument,
  onCreateDocument,
  onStatus,
  onOpenTraceAlignment,
}: SequenceToolsMenuProps) {
  const [open, setOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const offloadAnalysis = doc.sequence.length >= 50_000;
  const localStats = useMemo(() => analyzeSequence(doc.sequence), [doc.sequence]);
  const localRestrictionSites = useMemo(
    () => offloadAnalysis ? [] : scanRestrictionSites(doc.sequence),
    [doc.sequence, offloadAnalysis],
  );
  const [backgroundAnalysis, setBackgroundAnalysis] = useState<{
    sequence: string;
    stats: ReturnType<typeof analyzeSequence>;
    restrictionSites: ReturnType<typeof scanRestrictionSites>;
    loading: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (!offloadAnalysis) {
      setBackgroundAnalysis(null);
      return () => { active = false; };
    }
    setBackgroundAnalysis({
      sequence: doc.sequence,
      stats: localStats,
      restrictionSites: [],
      loading: true,
    });
    void analyzeSequenceInWorker(doc.sequence).then((result) => {
      if (!active) return;
      setBackgroundAnalysis({
        sequence: doc.sequence,
        stats: result.stats,
        restrictionSites: result.restrictionSites,
        loading: false,
      });
    });
    return () => { active = false; };
  }, [doc.sequence, localStats, offloadAnalysis]);
  const stats = backgroundAnalysis?.sequence === doc.sequence ? backgroundAnalysis.stats : localStats;
  const restrictionSites = backgroundAnalysis?.sequence === doc.sequence
    ? backgroundAnalysis.restrictionSites
    : localRestrictionSites;
  const totalRestrictionSites = restrictionSites.reduce((sum, item) => sum + item.positions.length, 0);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const annotateCommonFeatures = () => {
    const features = findCommonFeatureAnnotations(doc);
    if (!features.length) {
      onStatus("未发现新的常见特征", "success");
      setOpen(false);
      return;
    }
    onCommitDocument(
      { ...doc, features: [...doc.features, ...features] },
      `已自动注释 ${features.length} 个常见特征`,
      "annotation",
    );
    setOpen(false);
  };

  const findOrfs = () => {
    const features = findOpenReadingFrames(doc, 30);
    if (!features.length) {
      onStatus("未发现长度至少 30 个氨基酸的新开放阅读框", "success");
      setOpen(false);
      return;
    }
    onCommitDocument(
      { ...doc, features: [...doc.features, ...features] },
      `已添加 ${features.length} 个预测的开放阅读框`,
      "annotation",
    );
    setOpen(false);
  };

  const createFromSelection = () => {
    if (!selection) return;
    onCreateDocument(extractSelectionDocument(doc, selection));
    setOpen(false);
  };

  const createReverseComplement = () => {
    const source = selection ? extractSelectionDocument(doc, selection) : doc;
    onCreateDocument(reverseComplementDocument(source));
    setOpen(false);
  };

  return (
    <div className="sequence-tools" ref={rootRef}>
      <button
        type="button"
        className="doc-toolbar__btn"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="序列工具"
      >
        <Wrench aria-hidden="true" />
        <span>工具</span>
        <ChevronDown className="sequence-tools__chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="sequence-tools__menu" role="menu" aria-label="序列工具">
          <div className="sequence-tools__summary">
            <span><Dna aria-hidden="true" /> {stats.length.toLocaleString()} bp</span>
            <span>GC {stats.gcPercent.toFixed(1)}%</span>
            <span>{stats.counts.other ? `${stats.counts.other} 个模糊碱基` : "DNA 就绪"}</span>
          </div>

          <div className="sequence-tools__section">
            <strong>分析与注释</strong>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setVerificationOpen(true); }}>
              <GitCompareArrows aria-hidden="true" />
              <span><b>与测序读段比对</b><small>自动判断方向并报告替换或插入缺失</small></span>
            </button>
            <button type="button" role="menuitem" onClick={annotateCommonFeatures}>
              <Sparkles aria-hidden="true" />
              <span><b>自动注释常见特征</b><small>启动子、操纵子和标准引物</small></span>
            </button>
            <button type="button" role="menuitem" onClick={findOrfs}>
              <ScanSearch aria-hidden="true" />
              <span><b>查找开放阅读框</b><small>六帧阅读，至少 30 个氨基酸</small></span>
            </button>
          </div>

          <div className="sequence-tools__section">
            <strong>创建序列</strong>
            <button type="button" role="menuitem" onClick={createFromSelection} disabled={!selection}>
              <Scissors aria-hidden="true" />
              <span><b>从选区新建序列</b><small>{selection ? `已选 ${selection.length.toLocaleString()} 个碱基` : "请先选中碱基"}</small></span>
            </button>
            <button type="button" role="menuitem" onClick={createReverseComplement}>
              <RefreshCcw aria-hidden="true" />
              <span><b>反向互补为新序列</b><small>{selection ? "使用当前选区" : "使用完整序列"}</small></span>
            </button>
          </div>

          <div className="sequence-tools__section sequence-tools__section--restriction">
            <strong><Activity aria-hidden="true" /> 酶切位点摘要</strong>
            {restrictionSites.length ? (
              <>
                <p>{restrictionSites.length} 种常见酶共 {totalRestrictionSites} 个位点</p>
                <div>{restrictionSites.slice(0, 8).map((site) => <span key={site.enzyme}>{site.enzyme} {site.positions.length}</span>)}</div>
              </>
            ) : <p>{backgroundAnalysis?.loading ? "正在后台扫描常见酶切位点…" : "未找到支持的常见酶切位点。"}</p>}
          </div>

          <div className="sequence-tools__footer">
            <FilePlus2 aria-hidden="true" /> 新序列会添加到本地文库。
          </div>
        </div>
      )}
      {verificationOpen && (
        <SequenceVerificationDialog
          doc={doc}
          onClose={() => setVerificationOpen(false)}
          onOpenAlignment={onOpenTraceAlignment}
        />
      )}
    </div>
  );
}
