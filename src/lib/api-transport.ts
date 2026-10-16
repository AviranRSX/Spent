export type ApiTransport = (url: string, init?: RequestInit) => Promise<Response>;

// Desktop talks to the Next server over HTTP. The phone build swaps in an
// in-process router so the same client code reads the local snapshot.
let transport: ApiTransport = (url, init) => fetch(url, init);

export function setApiTransport(t: ApiTransport): void {
  transport = t;
}

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return transport(url, init);
}
