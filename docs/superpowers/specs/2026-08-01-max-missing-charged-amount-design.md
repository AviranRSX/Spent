# Max Missing Charged Amount Import Design

## Goal

Import Max workbook rows that contain a valid original transaction amount but omit the charged amount. These rows must behave like regular completed transactions, including normal categorization and category totals.

## Scope

The behavior applies only to the `max_bill` parser. Isracard, CAL, bank-account, and future workbook templates retain their existing validation rules.

## Parsing Behavior

For each Max row:

- Parse the original amount and original currency using the existing Max columns.
- When a charged amount is present, preserve the current behavior and use it.
- When the charged amount is blank and the original amount is valid, use the original amount as the charged amount.
- When the charged currency is blank and the original currency is present, use the original currency as the charged currency.
- Mark the imported transaction as `completed`, including rows from the Max pending-authorizations section.
- Continue reporting a row issue when neither amount provides a valid value or when another required field is missing or malformed.

The existing import, deduplication, and categorization paths remain unchanged. Because the resulting row is completed and has a charged amount, it participates in the same category assignment and category totals as other completed card transactions.

## Testing

Add parser regression coverage that verifies the exact workbook `transaction-details_export_1785570692278.xlsx` produces two valid transactions and no row issues. Assert that the rows:

- have charged amounts of `-404` and `-264`, copied from their original amounts;
- use `ILS` for both original and charged currency;
- have `completed` status;
- retain their Max account and merchant data.

Keep validation coverage proving that a Max row with no usable charged or original amount is rejected. Run the complete import test suite and lint after implementation.
