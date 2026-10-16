"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MobileSyncError } from "./mobile-sync-engine";

interface PassphraseFormProps {
  /** Resolves "ok" when the passphrase opened the snapshot, else an error code. */
  onSubmit(passphrase: string): Promise<"ok" | MobileSyncError>;
  /** Shown for bad_passphrase. */
  wrongMessage: string;
  submitLabel: string;
  busyLabel: string;
  autoFocus?: boolean;
}

/** One passphrase field with show/hide, used by onboarding and the new-passphrase prompts. */
export function PassphraseForm({
  onSubmit,
  wrongMessage,
  submitLabel,
  busyLabel,
  autoFocus = true,
}: PassphraseFormProps) {
  const t = useTranslations("phoneSync");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MobileSyncError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(value);
      if (result !== "ok") setError(result);
    } catch {
      setError("sync_failed");
    } finally {
      setBusy(false);
    }
  }

  const message = error
    ? error === "bad_passphrase"
      ? wrongMessage
      : t(`errors.${error}`)
    : null;

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <label htmlFor="phone-passphrase" className="sr-only">
        {t("mobile.passphraseLabel")}
      </label>
      <div className="relative">
        <Input
          id="phone-passphrase"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          disabled={busy}
          aria-invalid={error ? true : undefined}
          placeholder={t("mobile.passphraseLabel")}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          className="h-12 rounded-xl pe-12 text-base"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("mobile.hidePassphrase") : t("mobile.showPassphrase")}
          className="absolute end-0.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
      <Button type="submit" disabled={!value || busy} className="h-12 rounded-xl text-base">
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy ? busyLabel : submitLabel}
      </Button>
    </form>
  );
}
