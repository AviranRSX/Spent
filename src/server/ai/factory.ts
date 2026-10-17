import "server-only";

import type { AIProvider } from "./types";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { OpenAIProvider } from "./providers/openai";
import { getAISettings, getSetting } from "../db/queries/settings";
import { decrypt } from "../lib/encryption";

// Reads an API key stored as an encrypted triple: <prefix>_encrypted,
// <prefix>_iv and <prefix>_auth_tag.
function readEncryptedKey(prefix: string): string | null {
  const encryptedKey = getSetting(`${prefix}_encrypted`);
  const iv = getSetting(`${prefix}_iv`);
  const authTag = getSetting(`${prefix}_auth_tag`);

  if (!encryptedKey || !iv || !authTag) return null;

  return decrypt({
    encrypted: Buffer.from(encryptedKey, "hex"),
    iv: Buffer.from(iv, "hex"),
    authTag: Buffer.from(authTag, "hex"),
  });
}

export function createAIProvider(): AIProvider | null {
  const settings = getAISettings();

  if (settings.aiProvider === "claude") {
    const apiKey = readEncryptedKey("ai_api_key");
    return apiKey ? new ClaudeProvider(apiKey, settings.claudeModel) : null;
  }

  if (settings.aiProvider === "openai") {
    const apiKey = readEncryptedKey("ai_openai_key");
    return apiKey ? new OpenAIProvider(apiKey, settings.openaiModel) : null;
  }

  if (settings.aiProvider === "ollama") {
    return new OllamaProvider(settings.ollamaUrl, settings.ollamaModel);
  }

  return null;
}
