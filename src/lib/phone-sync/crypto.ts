import {
  FORMAT_MAGIC,
  FORMAT_VERSION,
  IV_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
} from "./format";

export type PhoneSyncCryptoErrorCode =
  | "bad_passphrase"
  | "bad_format"
  | "unsupported_version";

export class PhoneSyncCryptoError extends Error {
  readonly code: PhoneSyncCryptoErrorCode;

  constructor(code: PhoneSyncCryptoErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PhoneSyncCryptoError";
    this.code = code;
  }
}

const MAGIC_BYTES = new TextEncoder().encode(FORMAT_MAGIC);
const VERSION_OFFSET = MAGIC_BYTES.length;
const SALT_OFFSET = VERSION_OFFSET + 1;
const IV_OFFSET = SALT_OFFSET + SALT_BYTES;
const HEADER_BYTES = IV_OFFSET + IV_BYTES;
const GCM_TAG_BYTES = 16;

async function streamBytes(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Errors surface on the readable side; avoid an unhandled rejection here.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(transform.readable).arrayBuffer());
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPayload(
  plain: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  const compressed = await streamBytes(plain, new CompressionStream("gzip"));

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC_BYTES, 0);
  header[VERSION_OFFSET] = FORMAT_VERSION;
  const salt = header.subarray(SALT_OFFSET, IV_OFFSET);
  const iv = header.subarray(IV_OFFSET, HEADER_BYTES);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as Uint8Array<ArrayBuffer>,
        additionalData: header as Uint8Array<ArrayBuffer>,
      },
      key,
      compressed as Uint8Array<ArrayBuffer>,
    ),
  );

  const out = new Uint8Array(HEADER_BYTES + cipher.length);
  out.set(header, 0);
  out.set(cipher, HEADER_BYTES);
  return out;
}

export async function decryptPayload(
  blob: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  if (blob.length < HEADER_BYTES + GCM_TAG_BYTES) {
    throw new PhoneSyncCryptoError("bad_format", "File is too short");
  }
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (blob[i] !== MAGIC_BYTES[i]) {
      throw new PhoneSyncCryptoError("bad_format", "Unrecognized file");
    }
  }
  if (blob[VERSION_OFFSET] !== FORMAT_VERSION) {
    throw new PhoneSyncCryptoError(
      "unsupported_version",
      `Unsupported format version ${blob[VERSION_OFFSET]}`,
    );
  }

  const header = blob.subarray(0, HEADER_BYTES);
  const salt = blob.subarray(SALT_OFFSET, IV_OFFSET);
  const iv = blob.subarray(IV_OFFSET, HEADER_BYTES);
  const cipher = blob.subarray(HEADER_BYTES);

  const key = await deriveKey(passphrase, salt);
  let compressed: Uint8Array;
  try {
    compressed = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as Uint8Array<ArrayBuffer>,
          additionalData: header as Uint8Array<ArrayBuffer>,
        },
        key,
        cipher as Uint8Array<ArrayBuffer>,
      ),
    );
  } catch {
    throw new PhoneSyncCryptoError(
      "bad_passphrase",
      "Wrong passphrase or corrupted file",
    );
  }

  try {
    return await streamBytes(compressed, new DecompressionStream("gzip"));
  } catch {
    throw new PhoneSyncCryptoError("bad_format", "Payload is not valid gzip");
  }
}
