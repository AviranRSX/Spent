export const PHONE_SYNC_MIN_PASSPHRASE_LENGTH = 12;

export type PassphraseStrength = "weak" | "okay" | "strong";

/** Simple heuristic: length plus how many character classes are used. */
export function passphraseStrength(value: string): PassphraseStrength {
  const length = Array.from(value).length;
  if (length < PHONE_SYNC_MIN_PASSPHRASE_LENGTH) return "weak";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(value)
  ).length;
  if (length >= 20 || (length >= 16 && classes >= 3)) return "strong";
  return classes >= 2 ? "okay" : "weak";
}
