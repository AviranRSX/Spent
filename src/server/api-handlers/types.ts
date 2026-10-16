import "server-only";

export type HandlerResult<T> = { status: number; body: T | { error: string } };

export type HandlerContext = {
  workspaceId: number;
  query: URLSearchParams;
  params: Record<string, string>;
  now: Date;
  nextScheduledSync: string | null;
};

export function ok<T>(body: T): HandlerResult<T> {
  return { status: 200, body };
}

export function fail(status: number, error: string): HandlerResult<never> {
  return { status, body: { error } };
}
