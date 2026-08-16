/**
 * ValidationDetails — detailed BLAST/off-target hit display.
 *
 * Shows hit details, mismatch positions, risk ranking, and summary stats
 * for RT-qPCR specificity checks and sgRNA/siRNA off-target validation.
 */

interface HitDetail {
  accession?: string;
  organism?: string;
  gene?: string;
  score?: number;
  evalue?: number;
  identity?: number;
  mismatches?: number;
  query_start?: number;
  query_end?: number;
  subject_start?: number;
  subject_end?: number;
  strand?: string;
}

interface ValidationCheck {
  status?: string;
  summary?: string;
  exact_hits?: number;
  one_mismatch_hits?: number;
  two_mismatch_hits?: number;
  two_plus_mismatch_hits?: number;
  top_hits?: HitDetail[];
  hits?: HitDetail[];
  risk_level?: string;
  risk_items?: string[];
}

interface ValidationDetailsProps {
  candidateLabel: string;
  check: ValidationCheck;
}

function RiskBadge({ level }: { level?: string }) {
  const color = level === "low" || level === "pass"
    ? "var(--color-success, #4caf50)"
    : level === "medium" || level === "warning"
      ? "var(--color-warning, #ff9800)"
      : level === "high" || level === "fail"
        ? "var(--color-danger, #f44336)"
        : "var(--color-border, #ccc)";
  return (
    <span className="validation-risk-badge" style={{ background: color }}>
      {level ?? "unknown"}
    </span>
  );
}

export function ValidationDetails({ candidateLabel, check }: ValidationDetailsProps) {
  const hits = check.top_hits ?? check.hits ?? [];
  const riskItems = check.risk_items ?? [];

  return (
    <div className="validation-details">
      <div className="validation-details__header">
        <span className="validation-details__label">{candidateLabel}</span>
        <RiskBadge level={check.status ?? check.risk_level} />
      </div>

      {check.summary && (
        <div className="validation-details__summary">{check.summary}</div>
      )}

      {/* Hit statistics */}
      <div className="validation-details__stats">
        {check.exact_hits !== undefined && (
          <span className="validation-stat">
            <strong>完全匹配</strong> {check.exact_hits}
          </span>
        )}
        {check.one_mismatch_hits !== undefined && (
          <span className="validation-stat">
            <strong>1 个错配</strong> {check.one_mismatch_hits}
          </span>
        )}
        {(check.two_mismatch_hits ?? check.two_plus_mismatch_hits) !== undefined && (
          <span className="validation-stat">
            <strong>2 个以上错配</strong> {check.two_mismatch_hits ?? check.two_plus_mismatch_hits}
          </span>
        )}
      </div>

      {/* Risk items */}
      {riskItems.length > 0 && (
        <div className="validation-details__risks">
          {riskItems.map((item, i) => (
            <div key={i} className="validation-risk-item">⚠️ {item}</div>
          ))}
        </div>
      )}

      {/* Hit table */}
      {hits.length > 0 && (
        <div className="validation-details__hits">
          <div className="validation-hits-title">主要命中</div>
          <table className="validation-hits-table">
            <thead>
              <tr>
                <th>登录号</th>
                <th>物种</th>
                <th>得分</th>
                <th>E 值</th>
                <th>一致性</th>
                <th>错配</th>
              </tr>
            </thead>
            <tbody>
              {hits.slice(0, 5).map((hit, i) => (
                <tr key={i}>
                  <td><code>{hit.accession ?? "-"}</code></td>
                  <td>{hit.organism ?? "-"}</td>
                  <td>{hit.score ?? "-"}</td>
                  <td>{hit.evalue != null ? hit.evalue.toExponential(1) : "-"}</td>
                  <td>{hit.identity != null ? `${hit.identity}%` : "-"}</td>
                  <td>{hit.mismatches ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
