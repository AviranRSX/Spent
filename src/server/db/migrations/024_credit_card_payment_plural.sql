-- Some banks describe the card bill debit as "כרטיסי אשראי" (plural). The
-- singular pattern missed it, so those rows counted as expenses on top of
-- the card purchases imported from the card files.
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
  AND kind <> 'transfer'
  AND description LIKE '%כרטיסי אשראי%';
