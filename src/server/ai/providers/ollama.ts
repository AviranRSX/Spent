import "server-only";

import type {
  AIProvider,
  CategoryForCategorization,
  CategoryMapping,
  PastCorrection,
  TransactionForCategorization,
} from "../types";
import { parseCategorizationResponse } from "../parse-response";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "../prompts";

const CATEGORIZATION_FORMAT = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer" },
      categoryName: { type: "string" },
      isNew: { type: "boolean" },
      confidence: { type: "integer" },
    },
    required: ["index", "categoryName", "confidence"],
  },
} as const;

export class OllamaProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private model: string
  ) {}

  async categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: { allowProposals?: boolean; pastCorrections?: PastCorrection[] }
  ): Promise<CategoryMapping[]> {
    const allowProposals = options?.allowProposals ?? false;
    const pastCorrections = options?.pastCorrections ?? [];
    const prompt = buildCategorizationPrompt(
      transactions,
      categories,
      allowProposals,
      pastCorrections
    );

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        stream: false,
        format: CATEGORIZATION_FORMAT,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    const text = data.message?.content ?? "";

    return parseCategorizationResponse(
      text,
      categories.map((c) => c.name),
      allowProposals
    );
  }
}
