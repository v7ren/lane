import type { PermissionAsked, QuestionRequest } from '@loomria/shared/opencode';

import type { ApprovalDecision } from '../agent-events.js';
import type { OpenCodeRequestArgs } from './client.js';

export type PendingQuestion = QuestionRequest & { receivedAt: number; submitting?: boolean };
export type PendingPermission = PermissionAsked & { receivedAt: number; submitting?: boolean };

export type PendingMaps = {
  questions: Record<string, PendingQuestion>;
  permissions: Record<string, PendingPermission>;
};

export type PendingWireEventName =
  | 'question.asked'
  | 'question.v2.asked'
  | 'question.replied'
  | 'question.rejected'
  | 'question.v2.replied'
  | 'question.v2.rejected'
  | 'permission.asked'
  | 'permission.v2.asked'
  | 'permission.replied'
  | 'permission.v2.replied';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasStringId(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && value.id.length > 0;
}

/** Accept flat live/spec properties or nested `properties.question`. */
export function parseQuestionFromProperties(
  props: Record<string, unknown>,
): QuestionRequest | null {
  const nested = props.question;
  if (isRecord(nested) && hasStringId(nested)) {
    return nested as QuestionRequest;
  }
  if (hasStringId(props) && Array.isArray(props.questions)) {
    return props as QuestionRequest;
  }
  return null;
}

/** Accept flat live/spec properties or nested `properties.permission`. */
export function parsePermissionFromProperties(
  props: Record<string, unknown>,
): PermissionAsked | null {
  const nested = props.permission;
  if (isRecord(nested) && hasStringId(nested)) {
    return nested as PermissionAsked;
  }
  if (hasStringId(props)) {
    if (typeof props.permission === 'string' || Array.isArray(props.patterns)) {
      return props as PermissionAsked;
    }
    if (typeof props.action === 'string' || Array.isArray(props.resources)) {
      return props as PermissionAsked;
    }
  }
  return null;
}

function upsertQuestion(
  questions: Record<string, PendingQuestion>,
  request: QuestionRequest,
  receivedAt: number,
): Record<string, PendingQuestion> {
  const existing = questions[request.id];
  const receivedAtNext = existing?.receivedAt ?? receivedAt;
  return {
    ...questions,
    [request.id]: { ...request, receivedAt: receivedAtNext },
  };
}

function upsertPermission(
  permissions: Record<string, PendingPermission>,
  request: PermissionAsked,
  receivedAt: number,
): Record<string, PendingPermission> {
  const id = request.id;
  if (!id) return permissions;
  const existing = permissions[id];
  const receivedAtNext = existing?.receivedAt ?? receivedAt;
  return {
    ...permissions,
    [id]: { ...request, receivedAt: receivedAtNext },
  };
}

export function pendingPermissionSessionId(entry: PendingPermission): string | undefined {
  const raw = entry as Record<string, unknown>;
  if (typeof raw.sessionID === 'string') return raw.sessionID;
  const data = raw.data;
  if (isRecord(data) && typeof data.sessionID === 'string') {
    return data.sessionID;
  }
  return undefined;
}

function removeByRequestId<T extends { receivedAt: number }>(
  map: Record<string, T>,
  requestID: string,
): Record<string, T> {
  if (!map[requestID]) return map;
  const { [requestID]: _removed, ...rest } = map;
  return rest;
}

export function clearPendingForSession(
  maps: PendingMaps,
  sessionID: string,
): PendingMaps {
  const questions: Record<string, PendingQuestion> = {};
  for (const [id, entry] of Object.entries(maps.questions)) {
    if (entry.sessionID !== sessionID) {
      questions[id] = entry;
    }
  }
  const permissions: Record<string, PendingPermission> = {};
  for (const [id, entry] of Object.entries(maps.permissions)) {
    if (pendingPermissionSessionId(entry) !== sessionID) {
      permissions[id] = entry;
    }
  }
  return { questions, permissions };
}

export function hydratePending(
  _maps: PendingMaps,
  input: { questions: QuestionRequest[]; permissions: PermissionAsked[] },
  receivedAt = Date.now(),
): PendingMaps {
  const questions: Record<string, PendingQuestion> = {};
  for (const question of input.questions) {
    if (question?.id) {
      questions[question.id] = { ...question, receivedAt };
    }
  }
  const permissions: Record<string, PendingPermission> = {};
  for (const permission of input.permissions) {
    const id = permission?.id;
    if (id) {
      permissions[id] = { ...permission, receivedAt };
    }
  }
  return { questions, permissions };
}

export function applyPendingWireEvent(
  maps: PendingMaps,
  eventType: PendingWireEventName,
  props: Record<string, unknown>,
  receivedAt = Date.now(),
): PendingMaps {
  switch (eventType) {
    case 'question.asked':
    case 'question.v2.asked': {
      const question = parseQuestionFromProperties(props);
      if (!question?.id) return maps;
      return {
        ...maps,
        questions: upsertQuestion(maps.questions, question, receivedAt),
      };
    }
    case 'question.replied':
    case 'question.rejected':
    case 'question.v2.replied':
    case 'question.v2.rejected': {
      const requestID = props.requestID;
      if (typeof requestID !== 'string' || !requestID) return maps;
      return {
        ...maps,
        questions: removeByRequestId(maps.questions, requestID),
      };
    }
    case 'permission.asked':
    case 'permission.v2.asked': {
      const permission = parsePermissionFromProperties(props);
      if (!permission?.id) return maps;
      return {
        ...maps,
        permissions: upsertPermission(maps.permissions, permission, receivedAt),
      };
    }
    case 'permission.replied':
    case 'permission.v2.replied': {
      const requestID = props.requestID;
      if (typeof requestID !== 'string' || !requestID) return maps;
      return {
        ...maps,
        permissions: removeByRequestId(maps.permissions, requestID),
      };
    }
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
}

export function pendingQuestionPayload(entry: PendingQuestion): QuestionRequest {
  const { receivedAt: _receivedAt, submitting: _submitting, ...payload } = entry;
  return payload;
}

export function pendingPermissionPayload(entry: PendingPermission): PermissionAsked {
  const { receivedAt: _receivedAt, submitting: _submitting, ...payload } = entry;
  return payload;
}

export function isPendingWireEventType(type: string): type is PendingWireEventName {
  return (
    type === 'question.asked' ||
    type === 'question.v2.asked' ||
    type === 'question.replied' ||
    type === 'question.rejected' ||
    type === 'question.v2.replied' ||
    type === 'question.v2.rejected' ||
    type === 'permission.asked' ||
    type === 'permission.v2.asked' ||
    type === 'permission.replied' ||
    type === 'permission.v2.replied'
  );
}

export type OpenCodePermissionReply = 'once' | 'always' | 'reject';

export function buildQuestionReplyBody(answers: string[][]): { answers: string[][] } {
  return { answers };
}

export function buildPermissionReplyBody(
  reply: OpenCodePermissionReply,
  message?: string,
): { reply: OpenCodePermissionReply; message?: string } {
  if (message !== undefined && message.length > 0) {
    return { reply, message };
  }
  return { reply };
}

export function mapApprovalDecisionToPermissionReply(
  decision: ApprovalDecision,
): OpenCodePermissionReply {
  switch (decision) {
    case 'allow_once':
      return 'once';
    case 'allow_always':
      return 'always';
    case 'deny':
      return 'reject';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

export function openCodeQuestionReplyArgs(
  paneId: string,
  requestId: string,
  answers: string[][],
): OpenCodeRequestArgs {
  return {
    pane_id: paneId,
    method: 'POST',
    path: `/question/${requestId}/reply`,
    body: buildQuestionReplyBody(answers),
  };
}

export function openCodeQuestionRejectArgs(paneId: string, requestId: string): OpenCodeRequestArgs {
  return {
    pane_id: paneId,
    method: 'POST',
    path: `/question/${requestId}/reject`,
  };
}

export function openCodePermissionReplyArgs(
  paneId: string,
  requestId: string,
  reply: OpenCodePermissionReply,
  message?: string,
): OpenCodeRequestArgs {
  return {
    pane_id: paneId,
    method: 'POST',
    path: `/permission/${requestId}/reply`,
    body: buildPermissionReplyBody(reply, message),
  };
}

export function setQuestionSubmitting(
  questions: Record<string, PendingQuestion>,
  requestId: string,
  submitting: boolean,
): Record<string, PendingQuestion> {
  const entry = questions[requestId];
  if (!entry) return questions;
  return { ...questions, [requestId]: { ...entry, submitting } };
}

export function setPermissionSubmitting(
  permissions: Record<string, PendingPermission>,
  requestId: string,
  submitting: boolean,
): Record<string, PendingPermission> {
  const entry = permissions[requestId];
  if (!entry) return permissions;
  return { ...permissions, [requestId]: { ...entry, submitting } };
}

export function formatOpenCodeRequestError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
