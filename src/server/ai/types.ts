import "server-only";

/** Integer 1-7. 1 = guessing; 7 = certain. */
export type AIConfidence = number;

export interface CategoryMapping {
  index: number;
  categoryName: string;
  /** True when the AI proposed this as a brand-new category (not in the input list). */
  isNew?: boolean;
  /** How confident the AI is in this categorization (1-7). Missing/invalid → undefined. */
  confidence?: AIConfidence;
}

export interface TransactionForCategorization {
  description: string;
  amount: number;
  currency: string;
  memo?: string | null;
}

export interface CategoryForCategorization {
  name: string;
  description: string | null;
  /**
   * When set, this category is a leaf under a parent group. The prompt
   * renders categories grouped by parent name so the model has hierarchy
   * context. The AI is instructed to only return leaf names.
   */
  parentName?: string | null;
}

export interface PastCorrection {
  description: string;
  wrongCategory: string;
  correctCategory: string;
}

export interface MatchingDescriptionHistory {
  normalizedDescription: string;
  displayDescription: string;
  total: number;
  categories: Array<{ categoryName: string; count: number }>;
}

export interface CategorizationPromptObservation {
  systemPrompt: string;
  userPrompt: string;
}

export interface CategorizationOptions {
  allowProposals?: boolean;
  pastCorrections?: PastCorrection[];
  matchingHistory?: MatchingDescriptionHistory[];
  onPrompt?: (observation: CategorizationPromptObservation) => void;
}

export interface AIProvider {
  categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: CategorizationOptions
  ): Promise<CategoryMapping[]>;
}
