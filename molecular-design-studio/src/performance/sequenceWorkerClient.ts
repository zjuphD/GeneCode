import {
  analyzeSequence,
  scanRestrictionSites,
  type RestrictionSiteSummary,
  type SequenceStatistics,
} from "../editor/sequenceAnalysis";

export interface SequenceAnalysisResult {
  stats: SequenceStatistics;
  restrictionSites: RestrictionSiteSummary[];
  usedWorker: boolean;
}

let requestId = 0;

function analyzeOnMainThread(sequence: string): SequenceAnalysisResult {
  return {
    stats: analyzeSequence(sequence),
    restrictionSites: scanRestrictionSites(sequence),
    usedWorker: false,
  };
}

/**
 * Run the O(n × enzyme-count) summary off the React main thread for long
 * sequences. The fallback is deterministic and keeps tests/older webviews
 * functional when Worker or Vite's module-worker support is unavailable.
 */
export function analyzeSequenceInWorker(sequence: string): Promise<SequenceAnalysisResult> {
  if (typeof Worker === "undefined") return Promise.resolve(analyzeOnMainThread(sequence));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./sequenceWorker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(analyzeOnMainThread(sequence));
      return;
    }
    const id = ++requestId;
    let settled = false;
    const finish = (result: SequenceAnalysisResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event: MessageEvent<{ id: number; stats: SequenceStatistics; restrictionSites: RestrictionSiteSummary[] }>) => {
      if (event.data?.id !== id) return;
      finish({ stats: event.data.stats, restrictionSites: event.data.restrictionSites, usedWorker: true });
    };
    worker.onerror = () => finish(analyzeOnMainThread(sequence));
    try {
      worker.postMessage({ id, sequence });
    } catch {
      finish(analyzeOnMainThread(sequence));
    }
  });
}
