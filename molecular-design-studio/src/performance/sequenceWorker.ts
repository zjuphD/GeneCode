import { analyzeSequence, scanRestrictionSites } from "../editor/sequenceAnalysis";

interface SequenceWorkerRequest {
  id: number;
  sequence: string;
}

interface SequenceWorkerResponse {
  id: number;
  stats: ReturnType<typeof analyzeSequence>;
  restrictionSites: ReturnType<typeof scanRestrictionSites>;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SequenceWorkerRequest>) => void) | null;
  postMessage: (message: SequenceWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<SequenceWorkerRequest>) => {
  const request = event.data;
  if (!request || typeof request.id !== "number" || typeof request.sequence !== "string") return;
  const response: SequenceWorkerResponse = {
    id: request.id,
    stats: analyzeSequence(request.sequence),
    restrictionSites: scanRestrictionSites(request.sequence),
  };
  workerScope.postMessage(response);
};

export {};
