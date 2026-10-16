// The phone snapshot never contains encrypted settings or bank credentials,
// so anything that reaches for the desktop key file is a bug.
export interface EncryptedData {
  encrypted: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

function unavailable(): never {
  throw new Error("Encryption is not available on the phone");
}

export function encrypt(plaintext: string): EncryptedData {
  void plaintext;
  return unavailable();
}

export function decrypt(data: EncryptedData): string {
  void data;
  return unavailable();
}
