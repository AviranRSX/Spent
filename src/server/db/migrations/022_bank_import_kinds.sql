UPDATE transactions
SET kind = 'transfer', updated_at = datetime('now')
WHERE provider IN (
  'hapoalim_bank_account',
  'leumi_bank_account',
  'hapoalim',
  'leumi',
  'mizrahi',
  'discount',
  'mercantile',
  'beinleumi',
  'otsarHahayal',
  'union',
  'pagi',
  'yahav',
  'massad',
  'oneZero'
)
  AND kind = 'expense'
  AND (
    description LIKE '%ויזה%'
    OR description LIKE '%ישראכרט%'
    OR description LIKE '%ישרא כארד%'
    OR description LIKE '%ישרא-כארד%'
    OR description LIKE '%ישרא־כארד%'
    OR description LIKE '%כאל%'
    OR description LIKE '%מקס%'
    OR description LIKE '%מקסימום%'
    OR description LIKE '%מאסטרקארד%'
    OR description LIKE '%מאסטרקרד%'
    OR description LIKE '%אמריקן אקספרס%'
    OR description LIKE '%דיינרס%'
    OR description LIKE '%תשלום אשראי%'
    OR description LIKE '%כרטיס אשראי%'
    OR UPPER(description) LIKE '%ISRACARD%'
    OR UPPER(description) LIKE '%VISA%'
    OR UPPER(description) LIKE '%MASTERCARD%'
    OR UPPER(description) LIKE '%CAL%'
    OR UPPER(description) LIKE '%MAX%'
    OR UPPER(description) LIKE '%DINERS%'
    OR UPPER(description) LIKE '%AMEX%'
    OR UPPER(description) LIKE '%AMERICAN EXPRESS%'
  );

UPDATE transactions
SET kind = 'income', updated_at = datetime('now')
WHERE provider IN (
  'hapoalim_bank_account',
  'leumi_bank_account',
  'hapoalim',
  'leumi',
  'mizrahi',
  'discount',
  'mercantile',
  'beinleumi',
  'otsarHahayal',
  'union',
  'pagi',
  'yahav',
  'massad',
  'oneZero'
)
  AND kind = 'expense'
  AND charged_amount > 0;
