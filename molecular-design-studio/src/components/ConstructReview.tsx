import type { ResultCandidate } from "../agent/responseTypes";
import { getConstructReview } from "./constructReviewModel";
import type { BackboneLinearization, ExpectedConstruct, ReviewStatus } from "./constructReviewModel";

const STATUS_TEXT: Record<ReviewStatus, string> = {
  passed: "可进入确认",
  review: "需要复核",
  blocked: "暂不可执行",
};

const CHECK_TEXT: Record<ReviewStatus, string> = {
  passed: "通过",
  review: "复核",
  blocked: "阻断",
};

function editDescription(expected: ExpectedConstruct): string {
  if (!expected.available || expected.editStart === null || expected.editEnd === null) {
    return "仅生成 junction，尚无精确载体编辑坐标";
  }
  if (expected.editMode === "replace") {
    return `替换 [${expected.editStart}, ${expected.editEnd})`;
  }
  return `插入位置 ${expected.editStart}`;
}

function bindingDescription(binding: Record<string, unknown>): string {
  const start = typeof binding.start === "number" ? binding.start : null;
  const end = typeof binding.end === "number" ? binding.end : null;
  if (start === null || end === null) return "载体边界区域";
  return `载体 [${start}, ${end})${binding.wrapsOrigin === true ? " · 跨原点" : ""}`;
}

function BackbonePrimer({ label, primer, tm, gc, binding }: {
  label: string;
  primer: string;
  tm: number | null;
  gc: number | null;
  binding: Record<string, unknown>;
}) {
  return (
    <div className="agent-backbone-linearization__primer">
      <div>
        <strong>{label}</strong>
        <span>{bindingDescription(binding)}</span>
      </div>
      <code>{primer || "-"}</code>
      <small>Tm {tm ?? "-"}°C · GC {gc ?? "-"}%</small>
    </div>
  );
}

function BackboneLinearizationCard({ model }: { model: BackboneLinearization }) {
  const statusLabel = model.available
    ? (model.status === "review" ? "已生成 · 需复核" : "已生成")
    : STATUS_TEXT[model.status];
  return (
    <section className="agent-backbone-linearization" aria-label="载体线性化引物">
      <div className="agent-backbone-linearization__header">
        <div>
          <strong>载体线性化</strong>
          <span>inverse PCR · 骨架</span>
        </div>
        <span className={`agent-construct-review__status agent-construct-review__status--${model.status}`}>
          {statusLabel}
        </span>
      </div>
      {model.available ? (
        <>
          <div className="agent-backbone-linearization__facts">
            <span>{model.ampliconLength?.toLocaleString() ?? "-"} bp backbone</span>
            <span>{model.vectorTopology || "circular"} · 去除 {model.removedLength ?? "-"} bp</span>
            <span>编辑 [{model.editStart ?? "-"}, {model.editEnd ?? "-"})</span>
          </div>
          <div className="agent-backbone-linearization__primers">
            <BackbonePrimer
              label="骨架正向引物"
              primer={model.forwardPrimer}
              tm={model.tmForward}
              gc={model.gcForward}
              binding={model.forwardBinding}
            />
            <BackbonePrimer
              label="骨架反向引物"
              primer={model.reversePrimer}
              tm={model.tmReverse}
              gc={model.gcReverse}
              binding={model.reverseBinding}
            />
          </div>
          {model.instructions.length > 0 && (
            <ol className="agent-backbone-linearization__instructions">
              {model.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ol>
          )}
        </>
      ) : (
        <p className="agent-backbone-linearization__reason">
          {model.reason || "当前没有可用的 backbone 线性化引物。"}
        </p>
      )}
    </section>
  );
}

export function ConstructReview({ candidate }: { candidate: ResultCandidate }) {
  const model = getConstructReview(candidate);
  if (!model) return null;

  return (
    <section className="agent-construct-review" aria-label="预期构建体复核">
      <div className="agent-construct-review__header">
        <div>
          <strong>预期构建体</strong>
          <span>{model.method === "golden_gate" ? "Golden Gate 组装复核" : "Gibson 组装复核"}</span>
        </div>
        <span className={`agent-construct-review__status agent-construct-review__status--${model.status}`}>
          {STATUS_TEXT[model.status]}
        </span>
      </div>

      {model.summary && <p className="agent-construct-review__summary">{model.summary}</p>}

      <div className="agent-construct-review__facts">
        {model.fragmentCount > 1 && <span>{model.fragmentCount} 个片段 · {model.fragmentCount * 2} 条引物</span>}
        {model.insertLength !== null && <span>插入片段 {model.insertLength.toLocaleString()} bp</span>}
        {model.expectedConstruct.length !== null && (
          <span>构建体 {model.expectedConstruct.length.toLocaleString()} bp</span>
        )}
        <span>{editDescription(model.expectedConstruct)}</span>
      </div>

      <div className="agent-construct-review__junctions">
        {model.junctions.map((junction) => (
          <div className="agent-junction-review" key={junction.side || junction.label}>
            <div className="agent-junction-review__label">
              <strong>{junction.label}</strong>
              <span>{junction.overlap.length} bp {model.method === "golden_gate" ? "突出端" : "重叠"}</span>
            </div>
            <code>{junction.assembledPreview}</code>
            <div className="agent-junction-review__legend">
              <span>载体边界</span>
              <span>插入片段边界</span>
            </div>
          </div>
        ))}
      </div>

      {model.backboneLinearization && (
        <BackboneLinearizationCard model={model.backboneLinearization} />
      )}

      <details className="agent-construct-review__details">
        <summary>查看引物结构与自动检查</summary>
        <div className="agent-primer-architecture">
          {model.primers.map((primer) => (
            <div key={primer.name}>
              <strong>{primer.name}</strong>
              <span>{primer.tailPurpose}</span>
              <code><i>{primer.tail}</i>{primer.core}</code>
            </div>
          ))}
          <p><i>有色段</i>是 5′ assembly tail；后半段是实际结合 insert 的 3′ PCR core。</p>
        </div>
        <div className="agent-construct-checks">
          {model.checks.map((check) => (
            <div className="agent-construct-check" key={check.key}>
              <span className={`agent-construct-check__status agent-construct-check__status--${check.status}`}>
                {CHECK_TEXT[check.status]}
              </span>
              <div>
                <strong>{check.label}</strong>
                {check.detail && <p>{check.detail}</p>}
              </div>
            </div>
          ))}
        </div>
        {model.expectedConstruct.sequenceDigest && (
          <div className="agent-construct-review__digest">
            预期构建体校验和 <code>{model.expectedConstruct.sequenceDigest}</code>
          </div>
        )}
      </details>
    </section>
  );
}
