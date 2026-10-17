import "server-only";

import { getDb } from "../index";
import { isAIProviderId, type AppSettings, type DataSourceMode } from "@/lib/types";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
  resolveCloudModel,
} from "@/lib/ai-models";
import { DEFAULT_OLLAMA_MODEL } from "@/lib/ollama-model-options";

// Global settings live in the `settings` table and apply to every workspace.
// Currently: ai_provider, ai_ollama_url, ai_ollama_model, ai_claude_model,
// ai_openai_model, plus the encrypted Claude API key triple
// (ai_api_key_encrypted/iv/auth_tag) and OpenAI API key triple
// (ai_openai_key_encrypted/iv/auth_tag).
export function getGlobalSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setGlobalSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}

export function deleteGlobalSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// Per-workspace settings live in `workspace_settings`.
// Currently: months_to_sync, payday_day, scraper_show_browser.
export function getWorkspaceSetting(
  workspaceId: number,
  key: string
): string | null {
  const row = getDb()
    .prepare(
      "SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?"
    )
    .get(workspaceId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setWorkspaceSetting(
  workspaceId: number,
  key: string,
  value: string
): void {
  getDb()
    .prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    )
    .run(workspaceId, key, value);
}

// Back-compat aliases so existing call sites that store the Claude API key
// (settings.ts in src/server/ai/providers/claude.ts) keep working unchanged.
export const getSetting = getGlobalSetting;
export const setSetting = setGlobalSetting;

const AUTO_SYNC_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDataSourceMode(value: unknown): value is DataSourceMode {
  return value === "xlsx" || value === "scraper";
}

export function getDataSourceMode(workspaceId: number): DataSourceMode | null {
  const raw = getWorkspaceSetting(workspaceId, "data_source_mode");
  return isDataSourceMode(raw) ? raw : null;
}

export function setDataSourceMode(
  workspaceId: number,
  mode: DataSourceMode
): void {
  setWorkspaceSetting(workspaceId, "data_source_mode", mode);
}

export type AISettings = Pick<
  AppSettings,
  "aiProvider" | "ollamaUrl" | "ollamaModel" | "claudeModel" | "openaiModel"
>;

export function getAISettings(): AISettings {
  const aiProvider = getGlobalSetting("ai_provider");
  return {
    aiProvider: isAIProviderId(aiProvider) ? aiProvider : "none",
    ollamaUrl: getGlobalSetting("ai_ollama_url") ?? "http://localhost:11434",
    ollamaModel: getGlobalSetting("ai_ollama_model") ?? DEFAULT_OLLAMA_MODEL,
    claudeModel: resolveCloudModel(
      CLAUDE_MODELS,
      getGlobalSetting("ai_claude_model"),
      DEFAULT_CLAUDE_MODEL
    ),
    openaiModel: resolveCloudModel(
      OPENAI_MODELS,
      getGlobalSetting("ai_openai_model"),
      DEFAULT_OPENAI_MODEL
    ),
  };
}

export function getAppSettings(workspaceId: number): AppSettings {
  const targetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
  const target = targetRaw != null ? Number(targetRaw) : NaN;
  const storedTime = getGlobalSetting("auto_sync_time");
  const storedLang = getGlobalSetting("language");
  return {
    monthsToSync: Number(getWorkspaceSetting(workspaceId, "months_to_sync") ?? "3"),
    dataSourceMode: getDataSourceMode(workspaceId),
    ...getAISettings(),
    showBrowser: getWorkspaceSetting(workspaceId, "scraper_show_browser") === "true",
    paydayDay: Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1"),
    monthlyTarget: Number.isFinite(target) && target > 0 ? target : null,
    autoSyncEnabled: getGlobalSetting("auto_sync_enabled") === "true",
    autoSyncTime:
      storedTime && AUTO_SYNC_TIME_RE.test(storedTime) ? storedTime : "06:00",
    language: storedLang === "he" ? "he" : "en",
  };
}

export function updateAppSettings(
  workspaceId: number,
  settings: Partial<AppSettings>
): AppSettings {
  const db = getDb();
  const update = db.transaction(() => {
    if (settings.monthsToSync !== undefined) {
      setWorkspaceSetting(workspaceId, "months_to_sync", String(settings.monthsToSync));
    }
    if (settings.dataSourceMode !== undefined) {
      if (settings.dataSourceMode === null) {
        getDb()
          .prepare(
            "DELETE FROM workspace_settings WHERE workspace_id = ? AND key = ?"
          )
          .run(workspaceId, "data_source_mode");
      } else if (isDataSourceMode(settings.dataSourceMode)) {
        setDataSourceMode(workspaceId, settings.dataSourceMode);
      } else {
        throw new Error("dataSourceMode must be 'xlsx' or 'scraper'");
      }
    }
    if (settings.aiProvider !== undefined) {
      if (!isAIProviderId(settings.aiProvider)) {
        throw new Error("aiProvider must be 'claude', 'openai', 'ollama' or 'none'");
      }
      setGlobalSetting("ai_provider", settings.aiProvider);
    }
    if (settings.ollamaUrl !== undefined) {
      setGlobalSetting("ai_ollama_url", settings.ollamaUrl);
    }
    if (settings.ollamaModel !== undefined) {
      setGlobalSetting("ai_ollama_model", settings.ollamaModel);
    }
    if (settings.claudeModel !== undefined) {
      setGlobalSetting(
        "ai_claude_model",
        resolveCloudModel(CLAUDE_MODELS, settings.claudeModel, DEFAULT_CLAUDE_MODEL)
      );
    }
    if (settings.openaiModel !== undefined) {
      setGlobalSetting(
        "ai_openai_model",
        resolveCloudModel(OPENAI_MODELS, settings.openaiModel, DEFAULT_OPENAI_MODEL)
      );
    }
    if (settings.showBrowser !== undefined) {
      setWorkspaceSetting(
        workspaceId,
        "scraper_show_browser",
        settings.showBrowser ? "true" : "false"
      );
    }
    if (settings.paydayDay !== undefined) {
      const clamped = Math.max(1, Math.min(28, Math.round(settings.paydayDay)));
      setWorkspaceSetting(workspaceId, "payday_day", String(clamped));
    }
    if (settings.monthlyTarget !== undefined) {
      const t = settings.monthlyTarget;
      if (t == null || !Number.isFinite(t) || t <= 0) {
        getDb()
          .prepare(
            "DELETE FROM workspace_settings WHERE workspace_id = ? AND key = ?"
          )
          .run(workspaceId, "monthly_target");
      } else {
        setWorkspaceSetting(workspaceId, "monthly_target", String(Math.round(t)));
      }
    }
    if (settings.autoSyncEnabled !== undefined) {
      setGlobalSetting(
        "auto_sync_enabled",
        settings.autoSyncEnabled ? "true" : "false"
      );
    }
    if (settings.autoSyncTime !== undefined) {
      if (!AUTO_SYNC_TIME_RE.test(settings.autoSyncTime)) {
        throw new Error("autoSyncTime must be HH:MM 24-hour");
      }
      setGlobalSetting("auto_sync_time", settings.autoSyncTime);
    }
    if (settings.language !== undefined) {
      if (settings.language !== "en" && settings.language !== "he") {
        throw new Error("language must be 'en' or 'he'");
      }
      setGlobalSetting("language", settings.language);
    }
  });
  update();
  return getAppSettings(workspaceId);
}
