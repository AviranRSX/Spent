// Drive REST API v3 client for the phone. It has no Capacitor imports: the
// token source and fetch are injected so it runs under `node --test`.

/** Error codes the sync engine maps to UI states. */
export type DriveErrorCode = "offline" | "signed_out" | "folder_unavailable" | "drive_error";

/** Thrown by every DriveClient method. `message` is exactly the code. */
export class DriveError extends Error {
  readonly code: DriveErrorCode;
  readonly status: number | null;

  constructor(code: DriveErrorCode, status: number | null = null) {
    super(code);
    this.name = "DriveError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Returns a Drive access token. With `forceRefresh` the source must drop any
 * cached token and fetch a new one. It throws `signed_out` when it can't.
 */
export type GetAccessToken = (options?: { forceRefresh?: boolean }) => Promise<string>;

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface DriveFolder {
  id: string;
  name: string;
  ownerEmail: string;
}

export interface DriveFileMeta {
  id: string;
  modifiedTime: string;
  md5Checksum: string;
  size: number;
}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const SNAPSHOT_NAME = "snapshot.spent.enc";

/** Escapes a value for a single-quoted string in a Drive `q` expression. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// Folders shared with the account (the spouse case) and shared drives are
// only visible with these flags.
const SHARED = { supportsAllDrives: "true" };
const LIST_SHARED = {
  ...SHARED,
  includeItemsFromAllDrives: "true",
  spaces: "drive",
};

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
  /** Error code for a 404 answer. Without it a 404 is a plain `drive_error`. */
  notFound?: DriveErrorCode;
}

export class DriveClient {
  private readonly getAccessToken: GetAccessToken;
  private readonly fetchImpl: FetchImpl;

  constructor(options: { getAccessToken: GetAccessToken; fetchImpl?: FetchImpl }) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** Folders visible to the account that hold a snapshot, own or shared. */
  async findSpentFolders(): Promise<DriveFolder[]> {
    const parentIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const params: Record<string, string> = {
        ...LIST_SHARED,
        q: `name = ${quote(SNAPSHOT_NAME)} and trashed = false`,
        fields: "nextPageToken,files(id,parents)",
        pageSize: "100",
      };
      if (pageToken) params.pageToken = pageToken;
      const page = (await this.json(withParams(API, params))) as {
        nextPageToken?: string;
        files?: Array<{ parents?: string[] }>;
      };
      for (const file of page.files ?? []) {
        for (const parent of file.parents ?? []) {
          if (!parentIds.includes(parent)) parentIds.push(parent);
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    const folders: DriveFolder[] = [];
    for (const id of parentIds) {
      const folder = await this.folder(id);
      if (!folder) continue;
      folders.push({
        id,
        name: folder.name ?? "",
        ownerEmail: folder.owners?.[0]?.emailAddress ?? "",
      });
    }
    return folders;
  }

  /** Metadata of the file with exactly `name` in the folder, or null. */
  async getFileMeta(folderId: string, name: string): Promise<DriveFileMeta | null> {
    const folder = await this.folder(folderId);
    if (!folder) throw new DriveError("folder_unavailable", 404);

    const page = (await this.json(
      withParams(API, {
        ...LIST_SHARED,
        q: `name = ${quote(name)} and ${quote(folderId)} in parents and trashed = false`,
        fields: "files(id,name,modifiedTime,md5Checksum,size)",
        orderBy: "modifiedTime desc",
      }),
      { notFound: "folder_unavailable" }
    )) as {
      files?: Array<{
        id: string;
        name: string;
        modifiedTime: string;
        md5Checksum?: string;
        size?: string;
      }>;
    };

    const match = (page.files ?? [])
      .filter((file) => file.name === name)
      .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))[0];
    if (!match) return null;
    return {
      id: match.id,
      modifiedTime: match.modifiedTime,
      md5Checksum: match.md5Checksum ?? "",
      size: Number(match.size ?? 0),
    };
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await this.request(
      withParams(`${API}/${encodeURIComponent(fileId)}`, { ...SHARED, alt: "media" })
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Creates `name` in the folder, or replaces its content if it exists. */
  async upsertFile(folderId: string, name: string, bytes: Uint8Array): Promise<void> {
    const existing = await this.getFileMeta(folderId, name);
    if (existing) {
      await this.request(
        withParams(`${UPLOAD_API}/${encodeURIComponent(existing.id)}`, {
          ...SHARED,
          uploadType: "media",
          fields: "id",
        }),
        {
          method: "PATCH",
          headers: { "content-type": "application/octet-stream" },
          body: bytes,
        }
      );
      return;
    }

    const boundary = `spent-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);

    await this.request(
      withParams(UPLOAD_API, { ...SHARED, uploadType: "multipart", fields: "id" }),
      {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body,
        notFound: "folder_unavailable",
      }
    );
  }

  /** A folder's metadata, or null when it is gone, trashed or not a folder we can see. */
  private async folder(
    id: string
  ): Promise<{ name?: string; owners?: Array<{ emailAddress?: string }> } | null> {
    try {
      const folder = (await this.json(
        withParams(`${API}/${encodeURIComponent(id)}`, {
          ...SHARED,
          fields: "id,name,trashed,owners(emailAddress)",
        }),
        { notFound: "folder_unavailable" }
      )) as { name?: string; trashed?: boolean; owners?: Array<{ emailAddress?: string }> };
      return folder.trashed ? null : folder;
    } catch (error) {
      if (error instanceof DriveError && error.code === "folder_unavailable") return null;
      throw error;
    }
  }

  private async json(url: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.request(url, options);
    return response.json();
  }

  /** One authorized request: a 401 gets one forced token refresh and one retry. */
  private async request(url: string, options: RequestOptions = {}): Promise<Response> {
    let response = await this.send(url, options, await this.getAccessToken());
    if (response.status === 401) {
      response = await this.send(url, options, await this.getAccessToken({ forceRefresh: true }));
      if (response.status === 401) throw new DriveError("signed_out", 401);
    }
    if (response.status === 404 && options.notFound) {
      throw new DriveError(options.notFound, 404);
    }
    if (!response.ok) throw new DriveError("drive_error", response.status);
    return response;
  }

  private async send(url: string, options: RequestOptions, token: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: { ...options.headers, authorization: `Bearer ${token}` },
        body: options.body as BodyInit | undefined,
      });
    } catch {
      throw new DriveError("offline");
    }
  }
}
