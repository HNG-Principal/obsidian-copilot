import { ResponseMetadata } from "@/types/message";

export type ToolApprovalCategory = "auto" | "confirm";

export type ToolInvocationStatus =
  | "pending"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "timeout";

export interface ToolExecutionError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolInvocation {
  id: string;
  toolId: string;
  parameters: Record<string, unknown>;
  status: ToolInvocationStatus;
  result?: string;
  error?: ToolExecutionError;
  startedAt: number;
  completedAt?: number;
  approvedBy?: "auto" | "user";
}

export interface AgentTurn {
  turnNumber: number;
  llmResponse: string;
  toolInvocations: ToolInvocation[];
  isFinalTurn: boolean;
  timestamp: number;
}

export type AgentSessionStatus = "active" | "completed" | "turn_limit" | "cancelled" | "error";

export interface AgentSession {
  sessionId: string;
  turns: AgentTurn[];
  status: AgentSessionStatus;
  maxTurns: number;
  startedAt: number;
  completedAt?: number;
  finalResponse?: string;
  sources?: { title: string; path: string; score: number; explanation?: any }[];
  responseMetadata?: ResponseMetadata;
}
