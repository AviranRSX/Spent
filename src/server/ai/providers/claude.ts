import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  CategorizationOptions,
  CategoryForCategorization,
  CategoryMapping,
  TransactionForCategorization,
} from "../types";
import { parseCategorizationResponse } from "../parse-response";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "../prompts";
import { DEFAULT_CLAUDE_MODEL } from "../../../lib/ai-models";

// Claude Haiku 4.5 only thinks when asked. Newer models think by default, so
// those requests turn thinking off explicitly: categorization is a short
// classification task and thinking tokens would only add cost and latency.
const THINKS_ONLY_WHEN_ASKED = new Set(["claude-haiku-4-5"]);

export class ClaudeProvider implements AIProvider {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string = DEFAULT_CLAUDE_MODEL
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: CategorizationOptions
  ): Promise<CategoryMapping[]> {
    const allowProposals = options?.allowProposals ?? false;
    const pastCorrections = options?.pastCorrections ?? [];
    const prompt = buildCategorizationPrompt(
      transactions,
      categories,
      allowProposals,
      pastCorrections,
      options?.matchingHistory ?? []
    );

    options?.onPrompt?.({ systemPrompt: SYSTEM_PROMPT, userPrompt: prompt });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      ...(THINKS_ONLY_WHEN_ASKED.has(this.model)
        ? {}
        : { thinking: { type: "disabled" as const } }),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined to categorize this batch.");
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return parseCategorizationResponse(
      text,
      categories.map((c) => c.name),
      allowProposals
    );
  }
}
