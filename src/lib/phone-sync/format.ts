export const FORMAT_MAGIC = "SPNT";
export const FORMAT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export const SNAPSHOT_FILE = "snapshot.spent.enc";
export const SNAPSHOT_TMP_FILE = "snapshot.spent.enc.tmp";

const CHANGE_FILE_PATTERN = /^changes-([a-z0-9-]{8,64})\.spent\.enc$/;

export function changeFileName(deviceId: string): string {
  return `changes-${deviceId}.spent.enc`;
}

export function parseChangeFileName(name: string): string | null {
  const match = CHANGE_FILE_PATTERN.exec(name);
  return match ? match[1] : null;
}
