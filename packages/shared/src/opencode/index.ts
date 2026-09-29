import type { components } from './schema.js';

type Schemas = components['schemas'];

export type { paths, components, operations } from './schema.js';

export type Session = Schemas['Session'];
export type UserMessage = Schemas['UserMessage'];
export type AssistantMessage = Schemas['AssistantMessage'];
export type Message = Schemas['Message'];

export type Part = Schemas['Part'];
export type TextPart = Schemas['TextPart'];
export type ReasoningPart = Schemas['ReasoningPart'];
export type ToolPart = Schemas['ToolPart'];
export type FilePart = Schemas['FilePart'];
export type PatchPart = Schemas['PatchPart'];
export type SnapshotPart = Schemas['SnapshotPart'];
export type AgentPart = Schemas['AgentPart'];
export type SubtaskPart = Schemas['SubtaskPart'];
export type RetryPart = Schemas['RetryPart'];
export type CompactionPart = Schemas['CompactionPart'];
export type StepStartPart = Schemas['StepStartPart'];
export type StepFinishPart = Schemas['StepFinishPart'];

export type ToolState = Schemas['ToolState'];
export type ToolStatePending = Schemas['ToolStatePending'];
export type ToolStateRunning = Schemas['ToolStateRunning'];
export type ToolStateCompleted = Schemas['ToolStateCompleted'];
export type ToolStateError = Schemas['ToolStateError'];

export type OpenCodeEvent = Schemas['Event'];
export type EventSessionCreated = Schemas['EventSessionCreated'];
export type EventSessionUpdated = Schemas['EventSessionUpdated'];
export type EventSessionDeleted = Schemas['EventSessionDeleted'];
export type EventSessionStatus = Schemas['EventSessionStatus'];
export type EventSessionIdle = Schemas['EventSessionIdle'];
export type EventSessionError = Schemas['EventSessionError'];
export type EventSessionDiff = Schemas['EventSessionDiff'];
export type EventSessionCompacted = Schemas['EventSessionCompacted'];
export type EventMessageUpdated = Schemas['EventMessageUpdated'];
export type EventMessageRemoved = Schemas['EventMessageRemoved'];
export type EventMessagePartUpdated = Schemas['EventMessagePartUpdated'];
export type EventMessagePartRemoved = Schemas['EventMessagePartRemoved'];
export type EventMessagePartDelta = Schemas['EventMessagePartDelta'];
export type EventPermissionAsked = Schemas['EventPermissionAsked'];
export type EventPermissionReplied = Schemas['EventPermissionReplied'];
export type EventPermissionV2Asked = Schemas['EventPermissionV2Asked'];
export type EventPermissionV2Replied = Schemas['EventPermissionV2Replied'];
export type EventQuestionAsked = Schemas['EventQuestionAsked'];
export type EventQuestionReplied = Schemas['EventQuestionReplied'];
export type EventQuestionRejected = Schemas['EventQuestionRejected'];
export type EventQuestionV2Asked = Schemas['EventQuestionV2Asked'];
export type EventQuestionV2Replied = Schemas['EventQuestionV2Replied'];
export type EventQuestionV2Rejected = Schemas['EventQuestionV2Rejected'];
export type EventTodoUpdated = Schemas['EventTodoUpdated'];
export type EventFileEdited = Schemas['EventFileEdited'];
export type EventVcsBranchUpdated = Schemas['EventVcsBranchUpdated'];
export type EventLspUpdated = Schemas['EventLspUpdated'];
export type EventMcpToolsChanged = Schemas['EventMcpToolsChanged'];
export type EventServerConnected = Schemas['EventServerConnected'];

export type Agent = Schemas['Agent'];
export type Provider = Schemas['Provider'];
export type Command = Schemas['Command'];
export type FileNode = Schemas['FileNode'];
export type Todo = Schemas['Todo'];

export type PermissionAsked = Schemas['PermissionAsked'];
export type PermissionReplied = Schemas['PermissionReplied'];
export type QuestionRequest = Schemas['QuestionRequest'];
export type QuestionV2Asked = Schemas['QuestionV2Asked'];

/** Raw SSE frame shape emitted on `opencode://event`. */
export type OpenCodeWireEvent = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
};
