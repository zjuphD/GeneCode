/**
 * Runtime-normalized Agent response view models.
 *
 * All service responses are treated as `unknown` and normalized here.
 * Unknown fields are safely ignored.
 */

// ── Health ───────────────────────────────────────────────────

export interface AgentHealth {
  status: "online" | "offline";
  label: string;
  /** A-API-001: per-process nonce for server-restart detection. */
  nonce?: string;
  /** A-API-001: server API version (e.g. "1.0.0"). */
  apiVersion?: string;
}

// ── Plan row ─────────────────────────────────────────────────

export interface PlanRow {
  label: string;
  tool: string;
  status: string;
  summary: string;
  /**
   * Explicit prerequisite steps for LLM-planned executions. Values are the
   * tool names of earlier plan steps this step depends on (e.g.
   * ["resolve_rt_target"]). Rules-planned steps leave this empty so the DAG
   * falls back to the derived chain/handoff edges.
   */
  dependsOn?: string[];
}

// ── Plan provenance ───────────────────────────────────────────

/** Which track produced the execution plan (design doc §5.5). */
export type PlanSource = "llm" | "rules" | null;

export interface PlanProvenance {
  source: PlanSource;
  validated: boolean;
  errors: string[];
}

// ── Run log row ──────────────────────────────────────────────

export interface RunLogRow {
  step: string;
  tool: string;
  status: string;
  message: string;
  /**
   * Compacted resolved tool inputs (LLM-planned executions). Shown in the
   * step detail panel; long sequences are truncated server-side.
   */
  args?: Record<string, unknown>;
  /**
   * Compact per-step result summary ({ message, resultCount, topResult })
   * carried on step_done so the detail panel can show what the tool returned.
   */
  result?: Record<string, unknown>;
  /** Step wall-clock duration in ms (measured server-side). */
  durationMs?: number;
}

// ── Recommendation ───────────────────────────────────────────

export interface AgentRecommendation {
  title: string;
  summary: string;
  risks: string[];
  confidence: number | null;
}

// ── Task confirmation ──────────────────────────────────────

export interface TaskConfirmationItem {
  key: string;
  label: string;
  severity?: string;
  source?: string;
  prompt?: string;
  kind?: "text" | "textarea" | "select" | "checkbox" | "confirmation";
  options?: Array<{ value: string; label: string }>;
}

export interface TaskConfirmation {
  taskType: string;
  canProceed: boolean;
  confidence: number | null;
  blockers: TaskConfirmationItem[];
  missingParameters: TaskConfirmationItem[];
  assumptions: TaskConfirmationItem[];
  warnings: TaskConfirmationItem[];
  extractedParameters: Record<string, unknown>;
  requiresConfirmation: boolean;
}

// ── Result candidate ────────────────────────────────────────

export interface SequenceRow {
  label: string;
  value: string;
}

export interface ResultCandidate {
  title: string | null;
  summary: string | null;
  forwardPrimer: string | null;
  reversePrimer: string | null;
  tmForward: number | null;
  tmReverse: number | null;
  gcForward: number | null;
  gcReverse: number | null;
  fullLengthForward: number | null;
  fullLengthReverse: number | null;
  insertLength: number | null;
  tmDelta: number | null;
  crossDimer: boolean | null;
  annealTemp: number | null;
  extensionSec: number | null;
  /** Binding positions (0-based half-open) for write-back to editor. */
  bindingStartForward?: number | null;
  bindingEndForward?: number | null;
  bindingStartReverse?: number | null;
  bindingEndReverse?: number | null;
  bindingTarget?: string | null;
  bindingTargetLength?: number | null;
  coordinateSystem?: string | null;
  forwardCore?: string | null;
  reverseCore?: string | null;
  workspace?: string | null;
  sequenceRows?: SequenceRow[];
  metrics?: string[];
  /** Original service candidate, retained for follow-up validation calls. */
  raw?: Record<string, unknown>;
}

// ── Agent run metadata ───────────────────────────────────────

export interface AgentRunMeta {
  runId: string | null;
  status: string | null;
}

// ── LLM status ───────────────────────────────────────────────

export interface LlmStatus {
  label: string;
  message: string;
}

// ── Remote validation check result ───────────────────────────

export interface AgentCheckResult {
  messages: string[];
  results: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

// ── Normalized response ──────────────────────────────────────

export interface AgentResponse {
  messages: string[];
  plan: PlanRow[];
  runLog: RunLogRow[];
  workspace: string | null;
  readyToExecute: boolean;
  draft: Record<string, unknown> | null;
  agentRun: AgentRunMeta;
  llmStatus: LlmStatus | null;
  recommendation: AgentRecommendation | null;
  resultCount: number | null;
  candidates: ResultCandidate[];
  sequencePatch: unknown;
  taskConfirmation?: TaskConfirmation | null;
  agentMode?: string | null;
  autoExecuted?: boolean;
  executeSnapshotHash?: string | null;
  runRecord?: RunRecord | null;
  timeline?: TimelineEvent[];
  artifactPackage?: AgentArtifactPackage | null;
  conversationOnly?: boolean;
  /**
   * Remote verification outcome when this execute ran a registered check tool
   * (check_rt_specificity / check_sgrna_offtarget / check_sirna_offtarget).
   * Carries the raw per-candidate check results for ValidationDetails.
   */
  check?: AgentCheckResult | null;
  /** Which track produced the plan (llm / rules) and its validation state. */
  planProvenance?: PlanProvenance | null;
  /**
   * Raw backend meta, retained for claim provenance (A-AGT-002):
   * meta.claimLevel / meta.verificationStatus / meta.executionStatus / meta.runStatus.
   */
  meta?: Record<string, unknown>;
}

export interface RunRecord {
  run_id: string;
  status: string;
  plan_snapshot_hash: string;
  execute_snapshot_hash: string;
  event_count: number;
}

export interface TimelineEvent {
  event_id: string;
  type: string;
  tool: string;
  status: string;
  summary: string;
  timestamp: number;
}

export interface AgentArtifact {
  artifact_id: string;
  type: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  status: string;
  filename: string;
  created_at: number;
}

export interface AgentArtifactPackage {
  workspace: string;
  status: string;
  artifacts: AgentArtifact[];
  summaryMarkdown: string;
}

// ── Normalization helpers ────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function safeNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeMessages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim().length > 0) {
      result.push(item.trim());
    }
  }
  return result;
}

function normalizePlan(raw: unknown): PlanRow[] {
  if (!Array.isArray(raw)) return [];
  const result: PlanRow[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const label = nonEmptyString(item.label ?? item.step) ?? "";
    const tool = nonEmptyString(item.tool) ?? "";
    const status = nonEmptyString(item.status) ?? "";
    const summary = nonEmptyString(item.summary) ?? "";
    if (label || tool || status || summary) {
      const dependsOn = Array.isArray(item.dependsOn)
        ? item.dependsOn.flatMap((dep) => {
            const name = nonEmptyString(dep);
            return name ? [name] : [];
          })
        : undefined;
      result.push({
        label,
        tool,
        status,
        summary,
        ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
      });
    }
  }
  return result;
}

/**
 * Normalize plan provenance (which track planned the execution) from meta.
 *
 * Backend emits meta.plannedBy ("llm" | "rules"), meta.planValidated (bool)
 * and meta.planErrors (string[]).  Absent plannedBy means no plan info
 * (e.g. planning-stage responses) → source null.
 */
function normalizePlanProvenance(meta: Record<string, unknown>): PlanProvenance | null {
  const source = meta.plannedBy === "llm" || meta.plannedBy === "rules" ? meta.plannedBy : null;
  if (!source) return null;
  const errors = Array.isArray(meta.planErrors)
    ? meta.planErrors.flatMap((item) => {
        const text = nonEmptyString(item);
        return text ? [text] : [];
      })
    : [];
  return {
    source,
    validated: meta.planValidated === true,
    errors,
  };
}

function normalizeRunLog(raw: unknown): RunLogRow[] {
  if (!Array.isArray(raw)) return [];
  const result: RunLogRow[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const step = nonEmptyString(item.step) ?? "";
    const tool = nonEmptyString(item.tool) ?? "";
    const status = nonEmptyString(item.status) ?? "";
    const message = nonEmptyString(item.message) ?? "";
    if (step || tool || status || message) {
      const durationMs = safeNumber(item.durationMs);
      result.push({
        step,
        tool,
        status,
        message,
        ...(isPlainObject(item.args) ? { args: item.args } : {}),
        ...(isPlainObject(item.result) ? { result: item.result } : {}),
        ...(durationMs !== null ? { durationMs } : {}),
      });
    }
  }
  return result;
}

/**
 * Normalize recommendation from:
 *   meta.agentRun.recommendationPackage.recommendation
 *   meta.agentRun.recommendationPackage.risk.items
 *   meta.agentRun.recommendationPackage.confidence.score
 * or from:
 *   meta.recommendation (conservative fallback)
 */
function normalizeRecommendation(
  metaRecommendation: unknown,
  recommendationPackage: unknown,
): AgentRecommendation | null {
  // Try the detailed package path first
  if (isPlainObject(recommendationPackage)) {
    const rec = isPlainObject(recommendationPackage.recommendation)
      ? recommendationPackage.recommendation
      : null;
    if (rec) {
      const title = nonEmptyString(rec.title);
      if (title) {
        const summary = nonEmptyString(rec.summary ?? rec.reason) ?? "";
        const risks: string[] = [];
        const riskObj = isPlainObject(recommendationPackage.risk)
          ? recommendationPackage.risk
          : null;
        if (riskObj && Array.isArray(riskObj.items)) {
          for (const r of riskObj.items) {
            if (typeof r === "string" && r.trim().length > 0) {
              risks.push(r.trim());
            }
          }
        }
        const confObj = isPlainObject(recommendationPackage.confidence)
          ? recommendationPackage.confidence
          : null;
        // Confidence is already a percentage (e.g. 77), not a 0-1 fraction
        const confidence = confObj ? safeNumber(confObj.score) : null;
        return { title, summary, risks, confidence };
      }
    }
  }

  // Fallback to meta.recommendation
  if (!isPlainObject(metaRecommendation)) return null;
  const title = nonEmptyString(metaRecommendation.title);
  if (!title) return null;
  const summary = nonEmptyString(metaRecommendation.summary ?? metaRecommendation.reason) ?? "";
  const risks: string[] = [];
  if (Array.isArray(metaRecommendation.risks)) {
    for (const r of metaRecommendation.risks) {
      if (typeof r === "string" && r.trim().length > 0) {
        risks.push(r.trim());
      }
    }
  }
  const confidence = safeNumber(metaRecommendation.confidence);
  return { title, summary, risks, confidence };
}

/**
 * Normalize LLM status from meta.llm (real path) or meta.llmStatus (fallback).
 */
function normalizeLlmStatus(
  metaLlm: unknown,
  metaLlmStatus: unknown,
): LlmStatus | null {
  // Real path: meta.llm = { message: "已连接 MiniMax · MiniMax-M2.7" }
  if (isPlainObject(metaLlm)) {
    const label = nonEmptyString(metaLlm.label ?? metaLlm.status) ?? "";
    const message = nonEmptyString(metaLlm.message) ?? "";
    if (label || message) return { label, message };
  }
  // Fallback: meta.llmStatus
  if (isPlainObject(metaLlmStatus)) {
    const label = nonEmptyString(metaLlmStatus.label ?? metaLlmStatus.status) ?? "";
    const message = nonEmptyString(metaLlmStatus.message) ?? "";
    if (label || message) return { label, message };
  }
  return null;
}

function normalizeConfirmationItems(raw: unknown): TaskConfirmationItem[] {
  if (!Array.isArray(raw)) return [];
  const result: TaskConfirmationItem[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const key = nonEmptyString(item.key) ?? "";
    const label = nonEmptyString(item.label) ?? "";
    if (key || label) {
      result.push({
        key,
        label,
        severity: nonEmptyString(item.severity) ?? undefined,
        source: nonEmptyString(item.source) ?? undefined,
        prompt: nonEmptyString(item.prompt) ?? undefined,
        kind: ["text", "textarea", "select", "checkbox", "confirmation"].includes(String(item.kind))
          ? item.kind as TaskConfirmationItem["kind"]
          : undefined,
        options: Array.isArray(item.options)
          ? item.options.flatMap((option) => {
              if (!isPlainObject(option)) return [];
              const value = nonEmptyString(option.value);
              const optionLabel = nonEmptyString(option.label);
              return value && optionLabel ? [{ value, label: optionLabel }] : [];
            })
          : undefined,
      });
    }
  }
  return result;
}

function normalizeTaskConfirmation(raw: unknown): TaskConfirmation | null {
  if (!isPlainObject(raw)) return null;
  return {
    taskType: nonEmptyString(raw.taskType) ?? "",
    canProceed: raw.canProceed === true,
    confidence: safeNumber(raw.confidence),
    blockers: normalizeConfirmationItems(raw.blockers),
    missingParameters: normalizeConfirmationItems(raw.missingParameters),
    assumptions: normalizeConfirmationItems(raw.assumptions),
    warnings: normalizeConfirmationItems(raw.warnings),
    extractedParameters: isPlainObject(raw.extractedParameters) ? raw.extractedParameters : {},
    requiresConfirmation: raw.requiresConfirmation !== false,
  };
}

function normalizeAgentRun(raw: unknown): AgentRunMeta {
  if (!isPlainObject(raw)) return { runId: null, status: null };
  return {
    runId: nonEmptyString(raw.runId),
    status: nonEmptyString(raw.status),
  };
}

function normalizeCheckResult(raw: unknown): AgentCheckResult | null {
  if (!isPlainObject(raw)) return null;
  const messages = normalizeMessages(raw.messages);
  const results = Array.isArray(raw.results)
    ? raw.results.filter(isPlainObject)
    : [];
  const meta = isPlainObject(raw.meta) ? raw.meta : {};
  if (messages.length === 0 && results.length === 0) return null;
  return { messages, results, meta };
}

function normalizeRunRecord(raw: unknown): RunRecord | null {
  if (!isPlainObject(raw)) return null;
  const runId = nonEmptyString(raw.run_id);
  if (!runId) return null;
  return {
    run_id: runId,
    status: nonEmptyString(raw.status) ?? "unknown",
    plan_snapshot_hash: nonEmptyString(raw.plan_snapshot_hash) ?? "",
    execute_snapshot_hash: nonEmptyString(raw.execute_snapshot_hash) ?? "",
    event_count: safeNumber(raw.event_count) ?? 0,
  };
}

function normalizeTimeline(raw: unknown): TimelineEvent[] {
  if (!Array.isArray(raw)) return [];
  const result: TimelineEvent[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const eventId = nonEmptyString(item.event_id) ?? "";
    const type = nonEmptyString(item.type) ?? "";
    if (!type) continue;
    result.push({
      event_id: eventId,
      type,
      tool: nonEmptyString(item.tool) ?? "",
      status: nonEmptyString(item.status) ?? "",
      summary: nonEmptyString(item.summary) ?? "",
      timestamp: safeNumber(item.timestamp) ?? 0,
    });
  }
  return result;
}

function normalizeArtifactPackage(raw: unknown): AgentArtifactPackage | null {
  if (!isPlainObject(raw)) return null;
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.filter(isPlainObject).map((a: Record<string, unknown>) => ({
        artifact_id: nonEmptyString(a.artifact_id) ?? "",
        type: nonEmptyString(a.type) ?? "",
        title: nonEmptyString(a.title) ?? "",
        description: nonEmptyString(a.description) ?? "",
        data: isPlainObject(a.data) ? a.data : {},
        status: nonEmptyString(a.status) ?? "pending",
        filename: nonEmptyString(a.filename) ?? "",
        created_at: safeNumber(a.created_at) ?? 0,
      }))
    : [];
  if (artifacts.length === 0) return null;
  return {
    workspace: nonEmptyString(raw.workspace) ?? "",
    status: nonEmptyString(raw.status) ?? "pending",
    artifacts,
    summaryMarkdown: nonEmptyString(raw.summaryMarkdown) ?? "",
  };
}

/**
 * Normalize result count from:
 *   design.results (array length)
 *   meta.resultCount (fallback number)
 */
function normalizeResultCount(
  designResults: unknown,
  metaResultCount: unknown,
): number | null {
  if (Array.isArray(designResults)) return designResults.length;
  return safeNumber(metaResultCount);
}

/**
 * Format a number with optional suffix for display.
 */
function formatMetric(value: number | null, suffix: string): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value}${suffix}`;
}

/**
 * Build sequence rows from raw candidate fields based on workspace type.
 */
function buildSequenceRows(
  item: Record<string, unknown>,
  workspaceHint: string | null,
): SequenceRow[] {
  const rows: SequenceRow[] = [];
  const ws = (workspaceHint ?? "").toLowerCase();

  if (ws === "rtqpcr") {
    const fwd = nonEmptyString(item.f ?? item.forward ?? item.forwardPrimer);
    if (fwd) rows.push({ label: "Forward", value: fwd });
    const rev = nonEmptyString(item.r ?? item.reverse ?? item.reversePrimer);
    if (rev) rows.push({ label: "Reverse", value: rev });
    if (isPlainObject(item.probe)) {
      const probeSeq = nonEmptyString(item.probe.seq);
      if (probeSeq) rows.push({ label: "Probe", value: probeSeq });
    }
  } else if (ws === "sgrna") {
    const guide = nonEmptyString(item.seq ?? item.guide ?? item.guide_seq);
    if (guide) rows.push({ label: "Guide", value: guide });
    const pam = nonEmptyString(item.pam);
    if (pam) rows.push({ label: "PAM", value: pam });
  } else if (ws === "sirna") {
    const senseDuplex = nonEmptyString(item.sense_duplex);
    const antisenseDuplex = nonEmptyString(item.antisense_duplex);
    if (senseDuplex) rows.push({ label: "Sense duplex", value: senseDuplex });
    if (antisenseDuplex) rows.push({ label: "Antisense duplex", value: antisenseDuplex });
    if (!senseDuplex) {
      const sense = nonEmptyString(item.sense);
      if (sense) rows.push({ label: "Sense", value: sense });
    }
    if (!antisenseDuplex) {
      const antisense = nonEmptyString(item.antisense);
      if (antisense) rows.push({ label: "Antisense", value: antisense });
    }
  } else if (ws === "mutagenesis") {
    const fwd = nonEmptyString(item.f ?? item.forward ?? item.forwardPrimer);
    if (fwd) rows.push({ label: "Forward", value: fwd });
    const rev = nonEmptyString(item.r ?? item.reverse ?? item.reversePrimer);
    if (rev) rows.push({ label: "Reverse", value: rev });
  } else {
    // Cloning or unknown: forward/reverse primers
    const fwd = nonEmptyString(item.f ?? item.forward ?? item.forwardPrimer);
    if (fwd) rows.push({ label: "Forward", value: fwd });
    const rev = nonEmptyString(item.r ?? item.reverse ?? item.reversePrimer);
    if (rev) rows.push({ label: "Reverse", value: rev });
  }

  return rows;
}

/**
 * Build metric strings from raw candidate fields based on workspace type.
 */
function buildMetrics(
  item: Record<string, unknown>,
  workspaceHint: string | null,
): string[] {
  const metrics: string[] = [];
  const ws = (workspaceHint ?? "").toLowerCase();

  if (ws === "rtqpcr") {
    const size = safeNumber(item.size ?? item.amplicon_size);
    const sz = formatMetric(size, " bp");
    if (sz) metrics.push(`Amplicon ${sz}`);
    const tmDelta = safeNumber(
      isPlainObject(item.quality) ? item.quality.tm_delta : undefined,
    );
    const td = formatMetric(tmDelta, "°C");
    if (td) metrics.push(`Tm delta ${td}`);
    const ampGc = safeNumber(item.amplicon_gc);
    const ag = formatMetric(ampGc, "%");
    if (ag) metrics.push(`Amplicon GC ${ag}`);
    const gdna = nonEmptyString(item.gdna);
    if (gdna) metrics.push(`gDNA ${gdna}`);
    const anneal = safeNumber(
      isPlainObject(item.conditions) ? item.conditions.anneal_c : undefined,
    );
    const an = formatMetric(anneal, "°C");
    if (an) metrics.push(`Anneal ${an}`);
  } else if (ws === "sgrna") {
    const score = safeNumber(item.score);
    const sc = formatMetric(score, "");
    if (sc) metrics.push(`Score ${sc}`);
    const gc = safeNumber(item.gc);
    const gcStr = formatMetric(gc, "%");
    if (gcStr) metrics.push(`GC ${gcStr}`);
    const cut = safeNumber(item.cut ?? item.cut_site);
    const cutStr = formatMetric(cut, "");
    if (cutStr) metrics.push(`Cut ${cutStr}`);
    const dir = nonEmptyString(item.direction);
    if (dir) metrics.push(`Dir ${dir}`);
    const off = nonEmptyString(item.off ?? item.offtarget);
    if (off) metrics.push(`Off-target ${off}`);
    const repeatRisk = nonEmptyString(item.repeat_risk);
    if (repeatRisk) metrics.push(`Repeat ${repeatRisk}`);
  } else if (ws === "sirna") {
    const score = safeNumber(item.score);
    const sc = formatMetric(score, "");
    if (sc) metrics.push(`Score ${sc}`);
    const gc = safeNumber(item.gc);
    const gcStr = formatMetric(gc, "%");
    if (gcStr) metrics.push(`GC ${gcStr}`);
    const targetStart = safeNumber(item.target_start);
    const targetEnd = safeNumber(item.target_end);
    if (targetStart !== null && targetEnd !== null) {
      metrics.push(`Target ${targetStart}–${targetEnd}`);
    }
    const seedRisk = nonEmptyString(item.seed_risk);
    if (seedRisk) metrics.push(`Seed ${seedRisk}`);
    const repeatRisk = nonEmptyString(item.repeat_risk);
    if (repeatRisk) metrics.push(`Repeat ${repeatRisk}`);
    const funcRegion = nonEmptyString(item.functional_region);
    if (funcRegion) metrics.push(`Region ${funcRegion}`);
    const sharedLabel = nonEmptyString(item.shared_label);
    if (sharedLabel) metrics.push(`Shared ${sharedLabel}`);
    const recFormat = nonEmptyString(item.recommended_format);
    if (recFormat) metrics.push(`Format ${recFormat}`);
  } else if (ws === "mutagenesis") {
    const mutation = nonEmptyString(item.mutation);
    if (mutation) metrics.push(mutation);
    const length = safeNumber(item.length ?? item.full_length_f ?? item.fullLengthForward);
    const len = formatMetric(length, " nt");
    if (len) metrics.push(`Length ${len}`);
    const tmDelta = safeNumber(
      isPlainObject(item.quality) ? item.quality.tm_delta : undefined,
    );
    const td = formatMetric(tmDelta, "°C");
    if (td) metrics.push(`Tm delta ${td}`);
    const tmF = safeNumber(item.tm_f ?? item.tmForward);
    const tmR = safeNumber(item.tm_r ?? item.tmReverse);
    if (tmF !== null && tmR !== null) {
      metrics.push(`Tm ${tmF}/${tmR}°C`);
    }
    const gcF = safeNumber(item.gc_f ?? item.gcForward);
    const gcR = safeNumber(item.gc_r ?? item.gcReverse);
    if (gcF !== null && gcR !== null) {
      metrics.push(`GC ${gcF}/${gcR}%`);
    }
    const bindingStart = safeNumber(item.binding_start);
    const bindingEnd = safeNumber(item.binding_end);
    if (bindingStart !== null && bindingEnd !== null) {
      metrics.push(`Bind ${bindingStart}–${bindingEnd}`);
    }
    const centerOffset = safeNumber(
      isPlainObject(item.quality) ? item.quality.center_offset : undefined,
    );
    const co = formatMetric(centerOffset, "");
    if (co) metrics.push(`Center offset ${co}`);
    const selfDimerRaw = isPlainObject(item.quality)
      ? item.quality.self_dimer
      : undefined;
    if (typeof selfDimerRaw === "boolean") {
      metrics.push(`Self dimer ${selfDimerRaw ? "review" : "clear"}`);
    } else {
      const selfDimer = safeNumber(selfDimerRaw);
      const sd = formatMetric(selfDimer, "");
      if (sd) metrics.push(`Self dimer ${sd}`);
    }
    const hairpinStem = safeNumber(
      isPlainObject(item.quality) ? item.quality.hairpin_stem : undefined,
    );
    const hs = formatMetric(hairpinStem, "");
    if (hs) metrics.push(`Hairpin ${hs}`);
    const anneal = safeNumber(
      isPlainObject(item.conditions) ? item.conditions.anneal_c : undefined,
    );
    const an = formatMetric(anneal, "°C");
    if (an) metrics.push(`Anneal ${an}`);
  } else {
    // Cloning or unknown: standard cloning metrics
    const tmDelta = safeNumber(
      isPlainObject(item.quality) ? item.quality.tm_delta : undefined,
    );
    const td = formatMetric(tmDelta, "°C");
    if (td) metrics.push(`Tm delta ${td}`);
    const fwdLen = safeNumber(item.full_length_f ?? item.fullLengthForward);
    const fl = formatMetric(fwdLen, " nt");
    if (fl) metrics.push(`F length ${fl}`);
    const revLen = safeNumber(item.full_length_r ?? item.fullLengthReverse);
    const rl = formatMetric(revLen, " nt");
    if (rl) metrics.push(`R length ${rl}`);
    const crossDimer = isPlainObject(item.quality) && typeof item.quality.cross_dimer === "boolean"
      ? item.quality.cross_dimer
      : null;
    if (crossDimer !== null) {
      metrics.push(`Cross dimer ${crossDimer ? "review" : "clear"}`);
    }
    const anneal = safeNumber(
      isPlainObject(item.conditions) ? item.conditions.anneal_c : undefined,
    );
    const an = formatMetric(anneal, "°C");
    if (an) metrics.push(`Anneal ${an}`);
    const extSec = safeNumber(
      isPlainObject(item.conditions) ? item.conditions.extension_sec : undefined,
    );
    const es = formatMetric(extSec, "s");
    if (es) metrics.push(`Extend ${es}`);
  }

  return metrics;
}

/**
 * Build a workspace-specific title when the raw item lacks one.
 */
function buildDefaultTitle(
  item: Record<string, unknown>,
  workspaceHint: string | null,
): string | null {
  const ws = (workspaceHint ?? "").toLowerCase();
  if (ws === "rtqpcr") return "RT-qPCR candidate";
  if (ws === "sgrna") return "sgRNA candidate";
  if (ws === "sirna") return "siRNA candidate";
  if (ws === "mutagenesis") {
    const mutation = nonEmptyString(item.mutation);
    return mutation ? `Mutation: ${mutation}` : "Mutation candidate";
  }
  return null;
}

/**
 * Normalize up to 3 result candidates from `design.results`.
 *
 * Each candidate is treated as untrusted JSON. Unknown or malformed fields
 * are silently ignored; only display-safe scalar values are preserved.
 * Candidates that fail to extract any meaningful data are skipped.
 */
function normalizeResultCandidates(
  designResults: unknown,
  workspaceHint: string | null,
): ResultCandidate[] {
  if (!Array.isArray(designResults)) return [];

  const candidates: ResultCandidate[] = [];
  for (const item of designResults) {
    if (candidates.length >= 3) break;
    if (!isPlainObject(item)) continue;

    const sequenceRows = buildSequenceRows(item, workspaceHint);
    const metrics = buildMetrics(item, workspaceHint);

    const candidate: ResultCandidate = {
      title: nonEmptyString(item.title ?? item.name ?? item.label)
        ?? buildDefaultTitle(item, workspaceHint),
      summary: nonEmptyString(item.summary ?? item.description),
      forwardPrimer: nonEmptyString(item.f ?? item.forward ?? item.forwardPrimer),
      reversePrimer: nonEmptyString(item.r ?? item.reverse ?? item.reversePrimer),
      tmForward: safeNumber(item.tm_f ?? item.tmForward),
      tmReverse: safeNumber(item.tm_r ?? item.tmReverse),
      gcForward: safeNumber(item.gc_f ?? item.gcForward),
      gcReverse: safeNumber(item.gc_r ?? item.gcReverse),
      fullLengthForward: safeNumber(item.full_length_f ?? item.fullLengthForward),
      fullLengthReverse: safeNumber(item.full_length_r ?? item.fullLengthReverse),
      insertLength: safeNumber(item.insert_length ?? item.insertLength),
      tmDelta: safeNumber(
        isPlainObject(item.quality) ? item.quality.tm_delta : undefined,
      ),
      crossDimer: isPlainObject(item.quality) && typeof item.quality.cross_dimer === "boolean"
        ? item.quality.cross_dimer
        : null,
      annealTemp: safeNumber(
        isPlainObject(item.conditions) ? item.conditions.anneal_c : undefined,
      ),
      extensionSec: safeNumber(
        isPlainObject(item.conditions) ? item.conditions.extension_sec : undefined,
      ),
      bindingStartForward: safeNumber(item.binding_start_f ?? item.bindingStartForward),
      bindingEndForward: safeNumber(item.binding_end_f ?? item.bindingEndForward),
      bindingStartReverse: safeNumber(item.binding_start_r ?? item.bindingStartReverse),
      bindingEndReverse: safeNumber(item.binding_end_r ?? item.bindingEndReverse),
      bindingTarget: nonEmptyString(item.binding_target ?? item.bindingTarget),
      bindingTargetLength: safeNumber(item.binding_target_length ?? item.bindingTargetLength),
      coordinateSystem: nonEmptyString(item.coordinate_system ?? item.coordinateSystem),
      forwardCore: nonEmptyString(item.forward_core ?? item.forwardCore),
      reverseCore: nonEmptyString(item.reverse_core ?? item.reverseCore),
      workspace: nonEmptyString(workspaceHint),
      sequenceRows,
      metrics,
      raw: { ...item },
    };

    // Keep candidate only if it has at least one meaningful value
    const hasAnyValue =
      candidate.title !== null ||
      candidate.forwardPrimer !== null ||
      candidate.reversePrimer !== null ||
      candidate.tmForward !== null ||
      candidate.tmReverse !== null ||
      sequenceRows.length > 0 ||
      metrics.length > 0;
    if (hasAnyValue) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

// ── Public normalization ─────────────────────────────────────

/**
 * Normalize health response.
 *
 * Real shape: { ok: true, llm: { message: "..." } }
 * Fallback:   { status: "ok"|"online"|"healthy", label: "..." }
 */
export function normalizeAgentHealth(raw: unknown): AgentHealth {
  if (!isPlainObject(raw)) {
    return { status: "offline", label: "Unreachable" };
  }
  // Real service shape: { ok: true, nonce, apiVersion, llm: { message } }
  if (raw.ok === true) {
    const llm = isPlainObject(raw.llm) ? raw.llm : null;
    const label = nonEmptyString(llm?.message) ?? "Online";
    return {
      status: "online",
      label,
      ...(nonEmptyString(raw.nonce) ? { nonce: raw.nonce as string } : {}),
      ...(nonEmptyString(raw.apiVersion) ? { apiVersion: raw.apiVersion as string } : {}),
    };
  }
  // Fallback shape: { status: "ok"|"online"|"healthy" }
  const status = nonEmptyString(raw.status);
  if (status === "ok" || status === "online" || status === "healthy") {
    const label = nonEmptyString(raw.label ?? raw.message) ?? "Online";
    return { status: "online", label };
  }
  return { status: "offline", label: nonEmptyString(raw.label ?? raw.message) ?? "Offline" };
}

/**
 * Normalize an Agent response envelope.
 *
 * Rejects non-object payloads and envelopes that contain none of the expected
 * Agent response fields (messages, plan, meta, draft).
 */
export function normalizeAgentResponse(raw: unknown): AgentResponse {
  if (!isPlainObject(raw)) {
    throw new Error("Agent service returned a non-object response");
  }

  // Reject explicit failure envelopes before checking for expected fields
  if (raw.ok === false) {
    const errorMsg = nonEmptyString(raw.error);
    throw new Error(errorMsg ?? "Agent service returned an error response");
  }

  const meta = isPlainObject(raw.meta) ? raw.meta : {};
  const design = isPlainObject(raw.design) ? raw.design : {};

  // Reject envelopes that have none of the expected fields
  const hasMessages = Array.isArray(raw.messages);
  const hasPlan = Array.isArray(raw.plan);
  const hasMeta = isPlainObject(raw.meta);
  const hasDraft = isPlainObject(meta.draft);
  if (!hasMessages && !hasPlan && !hasMeta && !hasDraft) {
    const errorMsg = nonEmptyString(raw.error);
    throw new Error(errorMsg ?? "Agent service returned an empty response");
  }

  // Extract draft — retain only if it is a plain object
  const draft = isPlainObject(meta.draft) ? meta.draft : null;

  // Extract sequencePatch from top-level or meta
  const sequencePatch =
    raw.sequencePatch !== undefined
      ? raw.sequencePatch
      : meta.sequencePatch !== undefined
        ? meta.sequencePatch
        : undefined;

  // Extract agentRun from meta
  const agentRun = normalizeAgentRun(meta.agentRun);

  // Extract recommendation from the detailed package path
  const recommendationPackage = isPlainObject(meta.agentRun)
    ? (meta.agentRun as Record<string, unknown>).recommendationPackage
    : undefined;
  const recommendation = normalizeRecommendation(
    meta.recommendation,
    recommendationPackage,
  );

  // Result count from design.results or meta.resultCount
  const resultCount = normalizeResultCount(design.results, meta.resultCount);

  // Workspace hint for candidate normalization
  const workspaceHint = nonEmptyString(meta.workspace)
    ?? (draft ? nonEmptyString(draft.workspace) : null)
    ?? nonEmptyString(design.designType)
    ?? nonEmptyString(design.type);

  // Normalize up to 3 candidates from design.results
  const candidates = normalizeResultCandidates(design.results, workspaceHint);

  return {
    messages: normalizeMessages(raw.messages),
    plan: normalizePlan(raw.plan),
    runLog: normalizeRunLog(raw.runLog),
    workspace: nonEmptyString(meta.workspace),
    readyToExecute: meta.readyToExecute === true,
    draft,
    agentRun,
    llmStatus: normalizeLlmStatus(meta.llm, meta.llmStatus),
    recommendation,
    resultCount,
    candidates,
    sequencePatch,
    taskConfirmation: normalizeTaskConfirmation(meta.taskConfirmation),
    agentMode: nonEmptyString(meta.agentMode),
    autoExecuted: meta.autoExecuted === true,
    executeSnapshotHash: nonEmptyString(meta.executeSnapshotHash),
    runRecord: normalizeRunRecord(meta.runRecord),
    timeline: normalizeTimeline(meta.timeline),
    artifactPackage: normalizeArtifactPackage(meta.artifactPackage),
    conversationOnly: meta.conversationOnly === true,
    check: normalizeCheckResult(raw.check),
    planProvenance: normalizePlanProvenance(meta),
    meta,
  };
}
