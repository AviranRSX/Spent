import type { BankProvider } from "./types";
import {
  getImportTemplateLabel,
  isImportTemplateType,
} from "./imports/templates.js";

export type TransactionSourceType = "all" | "bank" | "card";

export const CARD_TRANSACTION_PROVIDERS = [
  "max_bill",
  "isracard_bill",
  "cal_bill",
  "isracard",
  "cal",
  "max",
  "amex",
  "beyahadBishvilha",
  "behatsdaa",
] as const;

export const BANK_TRANSACTION_PROVIDERS = [
  "hapoalim_bank_account",
  "leumi_bank_account",
  "hapoalim",
  "leumi",
  "mizrahi",
  "discount",
  "mercantile",
  "beinleumi",
  "otsarHahayal",
  "union",
  "pagi",
  "yahav",
  "massad",
  "oneZero",
] as const satisfies readonly (
  | BankProvider
  | "hapoalim_bank_account"
  | "leumi_bank_account"
)[];

const CARD_PROVIDER_SET = new Set<string>(CARD_TRANSACTION_PROVIDERS);
const BANK_PROVIDER_SET = new Set<string>(BANK_TRANSACTION_PROVIDERS);

export function getTransactionSourceType(
  provider: string
): Exclude<TransactionSourceType, "all"> | "unknown" {
  if (CARD_PROVIDER_SET.has(provider)) return "card";
  if (BANK_PROVIDER_SET.has(provider)) return "bank";
  return "unknown";
}

export function getTransactionProviderLabel(provider: string): string | null {
  if (isImportTemplateType(provider)) {
    return getImportTemplateLabel(provider);
  }
  return null;
}
