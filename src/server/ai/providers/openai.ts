import "server-only";

import type {
  AIProvider,
  CategorizationOptions,
  CategoryForCategorization,
  CategoryMapping,
  TransactionForCategorization,
} from "../types";
import { parseCategorizationResponse } from "../parse-response";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "../prompts";
import { DEFAULT_OPENAI_MODEL } from "../../../lib/ai-models";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// Strict structured outputs need an object at the root, every property in
// `required`, and additionalProperties: false. parseCategorizationResponse
// already unwraps a `results` array.
const CATEGORIZATION_FORMAT = {
  type: "json_schema",
  name: "categorization",
  strict: true,
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            categoryName: { type: "string" },
            isNew: { type: "boolean" },
            confidence: { type: "integer" },
          },
          required: ["index", "categoryName", "isNew", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
} as const;

interface ResponsesApiResult {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string = DEFAULT_OPENAI_MODEL
  ) {}

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

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions: SYSTEM_PROMPT,
        input: prompt,
        // Categorization is a short classification task; reasoning tokens
        // would only add cost and latency.
        reasoning: { effort: "none" },
        max_output_tokens: 4096,
        store: false,
        text: { format: CATEGORIZATION_FORMAT },
      }),
    });

    const data = (await response.json().catch(() => ({}))) as ResponsesApiResult;

    if (!response.ok) {
      const detail = data.error?.message ?? response.statusText;
      throw new Error(`OpenAI API request failed (${response.status}): ${detail}`);
    }

    if (data.status === "incomplete") {
      const reason = data.incomplete_details?.reason ?? "unknown reason";
      throw new Error(`OpenAI response was incomplete: ${reason}`);
    }

    const parts = (data.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? []);

    if (parts.some((part) => part.type === "refusal")) {
      throw new Error("OpenAI declined to categorize this batch.");
    }

    const text = parts
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("");

    return parseCategorizationResponse(
      text,
      categories.map((c) => c.name),
      allowProposals
    );
  }
}
