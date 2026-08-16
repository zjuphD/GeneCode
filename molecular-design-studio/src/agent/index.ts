export { fingerprintDocument } from "./fingerprint";
export { validatePatch, applyPatch } from "./patchEngine";
export { buildPreview } from "./preview";
export { buildSafeExample } from "./safeExample";
export {
  checkAgentHealth,
  planAgentTask,
  testAgentLlmConnection,
  switchAgentModel,
  executeAgentTask,
  buildDocumentSnapshot,
  getAgentBaseUrl,
} from "./service";
export {
  ensureLocalAgentService,
  getDefaultAgentLlmSettings,
  isTauriRuntime,
  loadAgentLlmSettings,
  restartLocalAgentService,
  saveAgentLlmSettings,
} from "./launcher";
export type {
  AgentLlmSettings,
  AgentLlmSettingsInput,
  AgentLaunchResult,
  AgentLaunchStatus,
} from "./launcher";
export type {
  AgentChatRequest,
  AgentExecuteRequest,
  AgentLlmConnectionResult,
  AgentModelSwitchInput,
  AgentModelSwitchResult,
  AgentSnapshot,
  AgentMode,
} from "./service";
export { normalizeAgentResponse, normalizeAgentHealth } from "./responseTypes";
export type {
  AgentResponse,
  AgentHealth,
  PlanRow,
  RunLogRow,
  AgentRecommendation,
  AgentRunMeta,
  LlmStatus,
  TaskConfirmation,
  TaskConfirmationItem,
  RunRecord,
  TimelineEvent,
} from "./responseTypes";
export { useAgentSession } from "./useAgentSession";
export type {
  ServiceStatus,
  RequestPhase,
  ConversationMessage,
  AgentSessionState,
  AgentSessionActions,
} from "./useAgentSession";
export type {
  SequencePatch,
  SequencePatchOperation,
  InsertOperation,
  DeleteOperation,
  ReplaceOperation,
  AddFeatureOperation,
  RemoveFeatureOperation,
  PatchPreview,
  PreviewOperationRow,
  PreviewFeatureRow,
  PatchValidationResult,
} from "./patchTypes";
