import { redirect } from "next/navigation";
import { canOpenAnyWorkspace } from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function SettingsRoot() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }
  redirect("/settings/general");
}
