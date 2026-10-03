/**
 * Merchants whose foreign-currency charges happen every month and must never
 * look like a trip. Matching is a case-insensitive substring test on the
 * transaction description. Edit this list to fit your household.
 */
export const ONLINE_MERCHANT_PATTERNS: readonly string[] = [
  "aliexpress",
  "amazon",
  "amzn",
  "temu",
  "alibaba",
  "shein",
  "ebay",
  "paypal",
  "openai",
  "chatgpt",
  "anthropic",
  "claude.ai",
  "google",
  "apple.com",
  "itunes",
  "netflix",
  "spotify",
  "microsoft",
  "adobe",
  "dropbox",
  "github",
  "patreon",
  "audible",
  "אמזון",
  "עלי אקספרס",
  "עליאקספרס",
  "אליאקספרס",
  "פייפאל",
  "גוגל",
  "נטפליקס",
  "ספוטיפיי",
];

export const ONLINE_CATEGORY_NAMES: readonly string[] = ["Subscriptions"];

export function isOnlineTransaction(
  description: string,
  categoryName: string | null
): boolean {
  if (categoryName && ONLINE_CATEGORY_NAMES.includes(categoryName)) return true;
  const haystack = description.toLowerCase().replace(/\s+/g, " ");
  return ONLINE_MERCHANT_PATTERNS.some((pattern) => haystack.includes(pattern));
}
