import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { DriveClient } = await import(
  pathToFileURL(path.join(process.cwd(), "src", "mobile", "drive", "drive-client.ts")).href
);

const FOLDER_ID = "folder-abc";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound() {
  return json({ error: { code: 404, message: "File not found" } }, 404);
}

/**
 * A fake Drive backend. `routes` is a list of [predicate, handler] pairs; the
 * first predicate that matches a request answers it. Every call is recorded.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: new URL(url),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body,
    };
    calls.push(call);
    for (const [matches, handler] of routes) {
      if (matches(call)) return handler(call);
    }
    throw new Error(`Unexpected request ${call.method} ${url}`);
  };
  return { fetchImpl, calls };
}

function tokenSource(tokens = ["token-1", "token-2", "token-3"]) {
  const requests = [];
  const getAccessToken = async (options = {}) => {
    requests.push(options);
    return tokens[Math.min(requests.length - 1, tokens.length - 1)];
  };
  return { getAccessToken, requests };
}

const isFolderMeta = (call) =>
  call.method === "GET" && call.url.pathname === `/drive/v3/files/${FOLDER_ID}`;
const isList = (call) => call.method === "GET" && call.url.pathname === "/drive/v3/files";
const folderMeta = () => json({ id: FOLDER_ID, name: "Spent", trashed: false });

test("getFileMeta escapes quotes and backslashes in the query", async () => {
  const { fetchImpl, calls } = fakeFetch([
    [isFolderMeta, folderMeta],
    [isList, () => json({ files: [] })],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  await client.getFileMeta(FOLDER_ID, "it's a\\b");

  const list = calls.find(isList);
  const q = list.url.searchParams.get("q");
  assert.equal(
    q,
    `name = 'it\\'s a\\\\b' and 'folder-abc' in parents and trashed = false`
  );
  assert.equal(list.url.searchParams.get("supportsAllDrives"), "true");
  assert.equal(list.url.searchParams.get("includeItemsFromAllDrives"), "true");
  assert.equal(list.url.searchParams.get("spaces"), "drive");
  assert.match(list.headers.get("authorization"), /^Bearer token-\d$/);
});

test("getFileMeta matches the exact name and ignores the .tmp file", async () => {
  const { fetchImpl } = fakeFetch([
    [isFolderMeta, folderMeta],
    [
      isList,
      () =>
        json({
          files: [
            {
              id: "tmp-id",
              name: "snapshot.spent.enc.tmp",
              modifiedTime: "2026-10-16T10:05:00.000Z",
              md5Checksum: "tmp-md5",
              size: "99",
            },
            {
              id: "snap-id",
              name: "snapshot.spent.enc",
              modifiedTime: "2026-10-16T10:00:00.000Z",
              md5Checksum: "snap-md5",
              size: "1234",
            },
          ],
        }),
    ],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  const meta = await client.getFileMeta(FOLDER_ID, "snapshot.spent.enc");

  assert.deepEqual(meta, {
    id: "snap-id",
    modifiedTime: "2026-10-16T10:00:00.000Z",
    md5Checksum: "snap-md5",
    size: 1234,
  });
});

test("getFileMeta returns null when only the .tmp file exists", async () => {
  const { fetchImpl } = fakeFetch([
    [isFolderMeta, folderMeta],
    [
      isList,
      () =>
        json({
          files: [
            {
              id: "tmp-id",
              name: "snapshot.spent.enc.tmp",
              modifiedTime: "2026-10-16T10:05:00.000Z",
              md5Checksum: "tmp-md5",
              size: "99",
            },
          ],
        }),
    ],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  assert.equal(await client.getFileMeta(FOLDER_ID, "snapshot.spent.enc"), null);
});

test("getFileMeta throws folder_unavailable when the folder is gone", async () => {
  const { fetchImpl } = fakeFetch([[isFolderMeta, notFound]]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  await assert.rejects(client.getFileMeta(FOLDER_ID, "snapshot.spent.enc"), {
    message: "folder_unavailable",
  });
});

test("getFileMeta throws folder_unavailable when the folder is trashed", async () => {
  const { fetchImpl } = fakeFetch([
    [isFolderMeta, () => json({ id: FOLDER_ID, name: "Spent", trashed: true })],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  await assert.rejects(client.getFileMeta(FOLDER_ID, "snapshot.spent.enc"), {
    message: "folder_unavailable",
  });
});

test("upsertFile creates the file when missing, then updates it in place", async () => {
  const stored = new Map();
  const { fetchImpl, calls } = fakeFetch([
    [isFolderMeta, folderMeta],
    [
      isList,
      (call) => {
        const q = call.url.searchParams.get("q");
        const files = [...stored.entries()]
          .filter(([, file]) => q.includes(`name = '${file.name}'`))
          .map(([id, file]) => ({
            id,
            name: file.name,
            modifiedTime: "2026-10-16T10:00:00.000Z",
            md5Checksum: "md5",
            size: String(file.bytes.length),
          }));
        return json({ files });
      },
    ],
    [
      (call) => call.method === "POST" && call.url.pathname === "/upload/drive/v3/files",
      async (call) => {
        const body = Buffer.from(call.body).toString("latin1");
        const metadata = JSON.parse(body.match(/\{[^]*?\}/)[0]);
        stored.set("new-id", { name: metadata.name, parents: metadata.parents, bytes: call.body });
        return json({ id: "new-id" });
      },
    ],
    [
      (call) => call.method === "PATCH" && call.url.pathname === "/upload/drive/v3/files/new-id",
      (call) => {
        stored.get("new-id").bytes = call.body;
        return json({ id: "new-id" });
      },
    ],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  await client.upsertFile(FOLDER_ID, "changes-dev1.spent.enc", new Uint8Array([1, 2, 3]));

  const create = calls.find((call) => call.method === "POST");
  assert.equal(create.url.searchParams.get("uploadType"), "multipart");
  assert.match(create.headers.get("content-type"), /^multipart\/related; boundary=/);
  const createBody = Buffer.from(create.body);
  assert.ok(createBody.includes(Buffer.from([1, 2, 3])), "multipart body carries the bytes");
  assert.deepEqual(stored.get("new-id").parents, [FOLDER_ID]);
  assert.equal(stored.get("new-id").name, "changes-dev1.spent.enc");

  await client.upsertFile(FOLDER_ID, "changes-dev1.spent.enc", new Uint8Array([4, 5]));

  const update = calls.find((call) => call.method === "PATCH");
  assert.equal(update.url.searchParams.get("uploadType"), "media");
  assert.deepEqual([...update.body], [4, 5]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "no second create");
});

test("a 401 triggers exactly one retry with a fresh token", async () => {
  let listCalls = 0;
  const { fetchImpl, calls } = fakeFetch([
    [isFolderMeta, folderMeta],
    [
      isList,
      () => {
        listCalls += 1;
        return listCalls === 1 ? json({ error: { code: 401 } }, 401) : json({ files: [] });
      },
    ],
  ]);
  const tokens = tokenSource();
  const client = new DriveClient({ getAccessToken: tokens.getAccessToken, fetchImpl });

  assert.equal(await client.getFileMeta(FOLDER_ID, "snapshot.spent.enc"), null);

  const lists = calls.filter(isList);
  assert.equal(lists.length, 2);
  assert.equal(lists[0].headers.get("authorization"), "Bearer token-2");
  assert.equal(lists[1].headers.get("authorization"), "Bearer token-3");
  assert.deepEqual(tokens.requests.at(-1), { forceRefresh: true });
  assert.equal(tokens.requests.filter((r) => r.forceRefresh).length, 1);
});

test("a second 401 throws signed_out without further retries", async () => {
  const { fetchImpl, calls } = fakeFetch([
    [() => true, () => json({ error: { code: 401 } }, 401)],
  ]);
  const tokens = tokenSource();
  const client = new DriveClient({ getAccessToken: tokens.getAccessToken, fetchImpl });

  await assert.rejects(client.download("file-1"), { message: "signed_out" });
  assert.equal(calls.length, 2);
  assert.equal(tokens.requests.filter((r) => r.forceRefresh).length, 1);
});

test("a network failure throws offline", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  await assert.rejects(client.download("file-1"), { message: "offline" });
  await assert.rejects(client.findSpentFolders(), { message: "offline" });
});

test("download returns the media bytes", async () => {
  const { fetchImpl, calls } = fakeFetch([
    [
      (call) => call.url.pathname === "/drive/v3/files/file-1",
      () => new Response(new Uint8Array([9, 8, 7])),
    ],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  const bytes = await client.download("file-1");

  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes], [9, 8, 7]);
  assert.equal(calls[0].url.searchParams.get("alt"), "media");
});

test("findSpentFolders returns each parent folder, including shared ones", async () => {
  const { fetchImpl, calls } = fakeFetch([
    [
      (call) => isList(call) && !call.url.searchParams.get("pageToken"),
      () =>
        json({
          nextPageToken: "page-2",
          files: [
            { id: "s1", parents: ["own-folder"] },
            { id: "s2", parents: ["shared-folder"] },
          ],
        }),
    ],
    [
      (call) => isList(call) && call.url.searchParams.get("pageToken") === "page-2",
      () => json({ files: [{ id: "s3", parents: ["own-folder"] }, { id: "s4", parents: ["gone"] }] }),
    ],
    [
      (call) => call.url.pathname === "/drive/v3/files/own-folder",
      () =>
        json({
          id: "own-folder",
          name: "Spent",
          trashed: false,
          owners: [{ emailAddress: "me@example.com" }],
        }),
    ],
    [
      (call) => call.url.pathname === "/drive/v3/files/shared-folder",
      () =>
        json({
          id: "shared-folder",
          name: "Home money",
          trashed: false,
          owners: [{ emailAddress: "partner@example.com" }],
        }),
    ],
    [(call) => call.url.pathname === "/drive/v3/files/gone", notFound],
  ]);
  const client = new DriveClient({ getAccessToken: tokenSource().getAccessToken, fetchImpl });

  const folders = await client.findSpentFolders();

  assert.deepEqual(folders, [
    { id: "own-folder", name: "Spent", ownerEmail: "me@example.com" },
    { id: "shared-folder", name: "Home money", ownerEmail: "partner@example.com" },
  ]);
  const firstList = calls.find(isList);
  assert.equal(
    firstList.url.searchParams.get("q"),
    "name = 'snapshot.spent.enc' and trashed = false"
  );
  assert.equal(firstList.url.searchParams.get("includeItemsFromAllDrives"), "true");
  assert.equal(
    calls.filter((call) => call.url.pathname === "/drive/v3/files/own-folder").length,
    1,
    "each parent is fetched once"
  );
});
