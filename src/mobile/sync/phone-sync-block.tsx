"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SyncStatusBlock, type SyncMenuItem } from "@/components/phone-sync/sync-status-block";
import { PassphraseForm } from "./passphrase-form";
import { useMobileSync } from "./sync-store";

/** The phone sidebar footer: sync status, Sync, and the sync menu with Disconnect. */
export function PhoneSyncBlock() {
  const t = useTranslations("phoneSync.mobile");
  const tCommon = useTranslations("common");
  const sync = useMobileSync();
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [askPassphrase, setAskPassphrase] = useState(false);

  const menuItems: SyncMenuItem[] = [{ label: t("syncNow"), onSelect: sync.syncNow }];
  if (sync.error === "signed_out") {
    menuItems.push({ label: t("signInAgain"), onSelect: () => void sync.signInAgain() });
  }
  if (sync.error === "bad_passphrase") {
    menuItems.push({ label: t("enterPassphrase"), onSelect: () => setAskPassphrase(true) });
  }
  menuItems.push({ label: t("disconnect"), onSelect: () => setConfirming(true) });

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await sync.disconnect();
    } finally {
      setDisconnecting(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <SyncStatusBlock
        state={sync.state}
        lastSyncedAt={sync.lastSyncedAt}
        pendingCount={sync.pendingCount}
        error={sync.error}
        onSync={sync.syncNow}
        menuItems={menuItems}
      />

      <Dialog open={confirming} onOpenChange={(open) => !disconnecting && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("disconnectTitle")}</DialogTitle>
            <DialogDescription>{t("disconnectDescription")}</DialogDescription>
          </DialogHeader>
          {sync.pendingCount > 0 ? (
            <p className="text-sm font-medium text-destructive">
              {t("disconnectPending", { count: sync.pendingCount })}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={disconnecting}>
              {tCommon("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="animate-spin" /> : null}
              {disconnecting ? t("disconnecting") : t("disconnectConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={askPassphrase} onOpenChange={setAskPassphrase}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("passphraseTitle")}</DialogTitle>
            <DialogDescription>{t("passphraseDescription")}</DialogDescription>
          </DialogHeader>
          <PassphraseForm
            onSubmit={async (passphrase) => {
              const result = await sync.submitPassphrase(passphrase);
              if (result === "ok") setAskPassphrase(false);
              return result;
            }}
            wrongMessage={t("wrongPassphrase")}
            submitLabel={t("unlock")}
            busyLabel={t("unlocking")}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
