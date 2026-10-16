"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ChevronLeft, ChevronRight, Folder, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MobileScreen, ScreenCard } from "@/mobile/boot/mobile-screen";
import type { DriveFolder } from "@/mobile/drive/drive-client";
import { PassphraseForm } from "@/mobile/sync/passphrase-form";
import { errorCode, type MobileSyncError } from "@/mobile/sync/mobile-sync-engine";
import { getEngine, setBootStatus, signInWithGoogle } from "@/mobile/sync/sync-store";

type Step = "signin" | "folder" | "passphrase" | "name";
const STEPS: Step[] = ["signin", "folder", "passphrase", "name"];
const STEP_LABELS: Record<Step, string> = {
  signin: "stepSignIn",
  folder: "stepFolder",
  passphrase: "stepPassphrase",
  name: "stepName",
};

type FolderList =
  | { status: "loading" }
  | { status: "ready"; folders: DriveFolder[] }
  | { status: "error"; error: MobileSyncError };

function Stepper({ step }: { step: Step }) {
  const t = useTranslations("phoneSync.onboarding");
  const current = STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-semibold text-muted-foreground">{t(STEP_LABELS[step])}</span>
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === current ? "w-6 bg-foreground" : i < current ? "w-1.5 bg-primary" : "w-1.5 bg-border"
            )}
          />
        ))}
      </ol>
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("common");
  return (
    <Button variant="ghost" onClick={onClick} className="-ms-2 mt-4 self-start text-muted-foreground">
      <ChevronLeft className="rtl:rotate-180" />
      {t("back")}
    </Button>
  );
}

/** First-run setup on the phone: Google sign-in, folder, passphrase, phone name. */
export function OnboardingFlow() {
  const t = useTranslations("phoneSync.onboarding");
  const tErrors = useTranslations("phoneSync.errors");
  const tMobile = useTranslations("phoneSync.mobile");
  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderList>({ status: "loading" });
  const [folder, setFolder] = useState<DriveFolder | null>(null);
  const [name, setName] = useState(() => t("defaultName"));
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<MobileSyncError | null>(null);

  async function loadFolders() {
    const engine = getEngine();
    if (!engine) return;
    setFolders({ status: "loading" });
    try {
      setFolders({ status: "ready", folders: await engine.listFolders() });
    } catch (error) {
      setFolders({ status: "error", error: errorCode(error) });
    }
  }

  async function handleSignIn() {
    setSigningIn(true);
    setSignInError(null);
    try {
      const account = await signInWithGoogle();
      setEmail(account.email || null);
      setStep("folder");
      void loadFolders();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSignInError(
        message.startsWith("google_not_configured")
          ? t("notConfigured")
          : message === "offline"
            ? tErrors("offline")
            : t("signInFailed")
      );
    } finally {
      setSigningIn(false);
    }
  }

  async function handlePassphrase(passphrase: string): Promise<"ok" | MobileSyncError> {
    const engine = getEngine();
    if (!engine || !folder) return "sync_failed";
    const result = await engine.prepareConnection(folder, passphrase);
    if (result === "ok") setStep("name");
    return result;
  }

  async function handleFinish(event: React.FormEvent) {
    event.preventDefault();
    const engine = getEngine();
    if (!engine || finishing) return;
    setFinishing(true);
    setFinishError(null);
    try {
      setBootStatus(await engine.completeConnection(name));
    } catch (error) {
      setFinishError(errorCode(error));
      setFinishing(false);
    }
  }

  const stepper = <Stepper step={step} />;

  if (step === "signin") {
    return (
      <MobileScreen
        top={stepper}
        eyebrow={t("eyebrow")}
        title={t("welcomeTitle")}
        description={t("welcomeDescription")}
        footer={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" />
            {t("encryptedNote")}
          </span>
        }
      >
        <Button
          onClick={handleSignIn}
          disabled={signingIn}
          variant="outline"
          className="h-12 w-full gap-3 rounded-xl bg-card text-base shadow-sm"
        >
          {signingIn ? <Loader2 className="animate-spin" /> : <GoogleMark />}
          {signingIn ? t("signingIn") : t("signIn")}
        </Button>
        {signInError ? <ErrorLine>{signInError}</ErrorLine> : null}
      </MobileScreen>
    );
  }

  if (step === "folder") {
    return (
      <MobileScreen
        top={stepper}
        eyebrow={email ? t("signedInAs", { email }) : t("eyebrow")}
        title={t("folderTitle")}
        description={t("folderDescription")}
      >
        {folders.status === "loading" ? (
          <ScreenCard className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("folderLoading")}
          </ScreenCard>
        ) : folders.status === "error" || folders.folders.length === 0 ? (
          <ScreenCard>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {folders.status === "error" ? tErrors(folders.error) : t("folderEmpty")}
            </p>
            <Button variant="outline" onClick={loadFolders} className="mt-4 w-full rounded-xl">
              <RefreshCw />
              {t("lookAgain")}
            </Button>
          </ScreenCard>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {folders.folders.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    setFolder(option);
                    setStep("passphrase");
                  }}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-start shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Folder className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {option.name || t("folderUntitled")}
                    </span>
                    {option.ownerEmail ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t("folderOwner", { email: option.ownerEmail })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </MobileScreen>
    );
  }

  if (step === "passphrase") {
    return (
      <MobileScreen
        top={stepper}
        eyebrow={folder ? t("passphraseFolder", { name: folder.name || t("folderUntitled") }) : null}
        title={t("passphraseTitle")}
        description={t("passphraseDescription")}
      >
        <PassphraseForm
          onSubmit={handlePassphrase}
          wrongMessage={t("wrongPassphrase")}
          submitLabel={tMobile("unlock")}
          busyLabel={tMobile("unlocking")}
        />
        <BackButton onClick={() => setStep("folder")} />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen
      top={stepper}
      eyebrow={t("eyebrow")}
      title={t("nameTitle")}
      description={t("nameDescription")}
    >
      <form onSubmit={handleFinish} className="flex flex-col gap-3">
        <label htmlFor="phone-name" className="sr-only">
          {t("nameLabel")}
        </label>
        <Input
          id="phone-name"
          value={name}
          maxLength={64}
          disabled={finishing}
          onChange={(event) => setName(event.target.value)}
          className="h-12 rounded-xl text-base"
        />
        {finishError ? <ErrorLine>{tErrors(finishError)}</ErrorLine> : null}
        <Button type="submit" disabled={finishing} className="h-12 rounded-xl text-base">
          {finishing ? <Loader2 className="animate-spin" /> : null}
          {finishing ? t("finishing") : t("finish")}
        </Button>
      </form>
    </MobileScreen>
  );
}

/** Google "G" mark for the sign-in button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-5">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
