import { NextResponse } from "next/server";
import { setSetting } from "@/server/db/queries/settings";
import { encrypt } from "@/server/lib/encryption";
import { isAIProviderId, type AIProviderId } from "@/lib/types";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
  resolveCloudModel,
} from "@/lib/ai-models";

function storeEncryptedKey(prefix: string, apiKey: string) {
  const { encrypted, iv, authTag } = encrypt(apiKey);
  setSetting(`${prefix}_encrypted`, encrypted.toString("hex"));
  setSetting(`${prefix}_iv`, iv.toString("hex"));
  setSetting(`${prefix}_auth_tag`, authTag.toString("hex"));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider: AIProviderId;
    apiKey?: string;
    claudeModel?: string;
    openaiModel?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
  };

  if (!isAIProviderId(body.provider)) {
    return NextResponse.json({ error: "Unknown AI provider" }, { status: 400 });
  }

  setSetting("ai_provider", body.provider);

  if (body.provider === "claude") {
    if (body.apiKey) storeEncryptedKey("ai_api_key", body.apiKey);
    setSetting(
      "ai_claude_model",
      resolveCloudModel(CLAUDE_MODELS, body.claudeModel, DEFAULT_CLAUDE_MODEL)
    );
  }

  if (body.provider === "openai") {
    if (body.apiKey) storeEncryptedKey("ai_openai_key", body.apiKey);
    setSetting(
      "ai_openai_model",
      resolveCloudModel(OPENAI_MODELS, body.openaiModel, DEFAULT_OPENAI_MODEL)
    );
  }

  if (body.provider === "ollama") {
    if (body.ollamaUrl) setSetting("ai_ollama_url", body.ollamaUrl);
    if (body.ollamaModel) setSetting("ai_ollama_model", body.ollamaModel);
  }

  return NextResponse.json({ success: true });
}
