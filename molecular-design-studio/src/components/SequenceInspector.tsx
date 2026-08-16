import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  FilePlus2,
  Languages,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type {
  SequenceDocument,
  SequenceFeature,
  SequenceSelection,
  Strand,
} from "../types";
import {
  gcPercent,
  reverseComplement,
  translateSequence,
} from "../editor/sequenceActions";
import { resolveDisplayColor } from "../editor/adapter";

export interface NewFeatureInput {
  name: string;
  type: string;
  color?: string;
}

interface SequenceInspectorProps {
  doc: SequenceDocument | null;
  selection: SequenceSelection | null;
  feature: SequenceFeature | null;
  onUpdateFeature: (feature: SequenceFeature) => void;
  onDeleteFeature: (id: string) => void;
  onAddFeature: (input: NewFeatureInput) => void;
  onExtractSelection: () => void;
}

interface FeatureDraft {
  name: string;
  type: string;
  start: string;
  end: string;
  strand: Strand;
  color: string;
}

function featureToDraft(feature: SequenceFeature): FeatureDraft {
  return {
    name: feature.name,
    type: feature.type,
    start: String(feature.start + 1),
    end: String(feature.end),
    strand: feature.strand,
    color: resolveDisplayColor(feature),
  };
}

function SelectionSummary({ selection }: { selection: SequenceSelection }) {
  return (
    <dl className="inspector-summary">
      <div>
        <dt>坐标</dt>
        <dd>
          {selection.wrapsOrigin
            ? `${selection.start + 1}–end / 1–${selection.end}`
            : `${selection.start + 1}–${selection.end}`}
        </dd>
      </div>
      <div>
        <dt>长度</dt>
        <dd>{selection.length.toLocaleString()} bp</dd>
      </div>
      <div>
        <dt>GC</dt>
        <dd>{gcPercent(selection.sequence).toFixed(1)}%</dd>
      </div>
    </dl>
  );
}

export function SequenceInspector({
  doc,
  selection,
  feature,
  onUpdateFeature,
  onDeleteFeature,
  onAddFeature,
  onExtractSelection,
}: SequenceInspectorProps) {
  const [featureDraft, setFeatureDraft] = useState<FeatureDraft | null>(
    feature ? featureToDraft(feature) : null,
  );
  const [showAnnotationForm, setShowAnnotationForm] = useState(false);
  const [annotationName, setAnnotationName] = useState("");
  const [annotationType, setAnnotationType] = useState("misc_feature");
  const [annotationColor, setAnnotationColor] = useState("#4f7fa8");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setFeatureDraft(feature ? featureToDraft(feature) : null);
    setShowAnnotationForm(false);
    setMessage(null);
  }, [feature]);

  const translation = useMemo(
    () => selection
      ? translateSequence(feature?.strand === -1
          ? reverseComplement(selection.sequence)
          : selection.sequence)
      : "",
    [feature?.strand, selection],
  );

  const primerDetails = useMemo(() => {
    if (!feature || !/primer/i.test(feature.type)) return null;
    const first = (key: string) => feature.qualifiers[key]?.[0] ?? null;
    return {
      sequence: first("sequence"),
      bindingSequence: first("binding_sequence") ?? first("match_sequence"),
      tm: first("tm"),
      gc: first("gc_percent"),
      direction: first("direction") ?? (feature.strand === 1 ? "forward" : "reverse"),
    };
  }, [feature]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} 已复制`);
    } catch {
      setMessage("剪贴板不可用");
    }
  };

  if (!doc) {
    return <p className="sidebar-empty">打开序列以检查。</p>;
  }

  if (!selection) {
    return (
      <div className="inspector-empty">
        <strong>未选中</strong>
        <p>在图谱或序列视图中点击特征，或拖动选择碱基。</p>
      </div>
    );
  }

  const saveFeature = () => {
    if (!feature || !featureDraft) return;
    const start = Number(featureDraft.start) - 1;
    const end = Number(featureDraft.end);
    if (
      !featureDraft.name.trim() ||
      !featureDraft.type.trim() ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > doc.sequence.length
    ) {
      setMessage("请检查名称、类型和坐标");
      return;
    }
    onUpdateFeature({
      ...feature,
      name: featureDraft.name.trim(),
      type: featureDraft.type.trim(),
      start,
      end,
      strand: featureDraft.strand,
      color: featureDraft.color,
    });
    setMessage("注释已更新");
  };

  const addAnnotation = () => {
    if (!annotationName.trim() || !annotationType.trim()) {
      setMessage("请输入注释名称和类型");
      return;
    }
    onAddFeature({
      name: annotationName.trim(),
      type: annotationType.trim(),
      color: annotationColor,
    });
    setAnnotationName("");
    setShowAnnotationForm(false);
    setMessage("注释已添加");
  };

  return (
    <div className="sequence-inspector">
      <div className="inspector-heading">
        <strong>{feature ? feature.name || "未命名注释" : "选中区域"}</strong>
        <span>{feature ? feature.type : selection.wrapsOrigin ? "跨原点选区" : "序列选区"}</span>
      </div>

      <SelectionSummary selection={selection} />

      {primerDetails && (
        <section className="inspector-primer" aria-label="引物详情">
          <div className="inspector-primer__header">
            <strong>引物详情</strong>
            {primerDetails.direction && <span>{primerDetails.direction}</span>}
          </div>
          {primerDetails.sequence && <code>{primerDetails.sequence}</code>}
          <dl>
            {primerDetails.tm && <div><dt>Tm</dt><dd>{primerDetails.tm} C</dd></div>}
            {primerDetails.gc && <div><dt>GC</dt><dd>{primerDetails.gc}%</dd></div>}
            {primerDetails.bindingSequence && <div><dt>结合核心</dt><dd><code>{primerDetails.bindingSequence}</code></dd></div>}
          </dl>
        </section>
      )}

      <div className="inspector-actions" aria-label="选区操作">
        <button type="button" onClick={() => copyText(selection.sequence, "正向序列")}>
          <Copy aria-hidden="true" />
          正向
        </button>
        <button type="button" onClick={() => copyText(reverseComplement(selection.sequence), "反向互补")}>
          <Copy aria-hidden="true" />
          反向互补
        </button>
        <button type="button" onClick={() => copyText(translation, "翻译")} disabled={!translation}>
          <Languages aria-hidden="true" />
          翻译
        </button>
        <button type="button" onClick={onExtractSelection}>
          <FilePlus2 aria-hidden="true" />
          新建序列
        </button>
      </div>

      {feature && featureDraft ? (
        <form className="inspector-form" onSubmit={(event) => { event.preventDefault(); saveFeature(); }}>
          <label>
            <span>名称</span>
            <input value={featureDraft.name} onChange={(event) => setFeatureDraft({ ...featureDraft, name: event.target.value })} />
          </label>
          <label>
            <span>类型</span>
            <input value={featureDraft.type} onChange={(event) => setFeatureDraft({ ...featureDraft, type: event.target.value })} />
          </label>
          <div className="inspector-form__row">
            <label>
              <span>起始</span>
              <input type="number" min="1" max={doc.sequence.length} value={featureDraft.start} onChange={(event) => setFeatureDraft({ ...featureDraft, start: event.target.value })} />
            </label>
            <label>
              <span>终止</span>
              <input type="number" min="1" max={doc.sequence.length} value={featureDraft.end} onChange={(event) => setFeatureDraft({ ...featureDraft, end: event.target.value })} />
            </label>
          </div>
          <div className="inspector-form__row">
            <label>
              <span>链</span>
              <select value={featureDraft.strand} onChange={(event) => setFeatureDraft({ ...featureDraft, strand: Number(event.target.value) as Strand })}>
                <option value={1}>正向</option>
                <option value={-1}>反向</option>
              </select>
            </label>
            <label>
              <span>颜色</span>
              <input className="inspector-color" type="color" value={featureDraft.color} onChange={(event) => setFeatureDraft({ ...featureDraft, color: event.target.value })} />
            </label>
          </div>
          <div className="inspector-form__actions">
            <button type="submit" className="inspector-primary">
              <Save aria-hidden="true" />
              保存更改
            </button>
            <button type="button" className="inspector-danger" onClick={() => onDeleteFeature(feature.id)}>
              <Trash2 aria-hidden="true" />
              删除
            </button>
          </div>
        </form>
      ) : (
        <div className="inspector-annotation">
          {!showAnnotationForm ? (
            <button type="button" className="inspector-add" onClick={() => setShowAnnotationForm(true)}>
              <Plus aria-hidden="true" />
              添加注释
            </button>
          ) : (
            <div className="inspector-form">
              <label>
                <span>名称</span>
                <input autoFocus value={annotationName} onChange={(event) => setAnnotationName(event.target.value)} placeholder="例如：启动子" />
              </label>
              <label>
                <span>类型</span>
                <input value={annotationType} onChange={(event) => setAnnotationType(event.target.value)} />
              </label>
              <label>
                <span>颜色</span>
                <input className="inspector-color" type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} />
              </label>
              <div className="inspector-form__actions">
                <button type="button" className="inspector-primary" onClick={addAnnotation}>添加</button>
                <button type="button" onClick={() => setShowAnnotationForm(false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p className="inspector-message" role="status">{message}</p>}
    </div>
  );
}
