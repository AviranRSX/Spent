// Cloud models offered for categorization. Each request turns reasoning off:
// categorizing a batch is a short classification task, and reasoning tokens
// would only add cost and latency. Only list models whose provider code knows
// how to turn reasoning off for them.

export interface CloudModelInfo {
  id: string;
  label: string;
  recommended?: boolean;
}

export const CLAUDE_MODELS: CloudModelInfo[] = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", recommended: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export const OPENAI_MODELS: CloudModelInfo[] = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", recommended: true },
];

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

/** Returns the stored model when it is still offered, otherwise the default. */
export function resolveCloudModel(
  models: CloudModelInfo[],
  stored: string | null | undefined,
  fallback: string
): string {
  return stored && models.some((m) => m.id === stored) ? stored : fallback;
}
