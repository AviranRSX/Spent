-- Hotels: lodging gets its own leaf under Trips & Travel, split out of Travel.

-- 1. The Hotels leaf, unless the workspace already has an expense category
--    with that name. Workspaces without a top-level Trips & Travel get an
--    ungrouped leaf.
INSERT INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id,
       (SELECT p.id FROM categories p
         WHERE p.workspace_id = w.id AND p.kind = 'expense'
           AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')),
       'Hotels', '#C08FB0', 'hotel', 'expense', 'tracking',
       'Lodging: hotels, hostels, resorts, guesthouses, zimmers (צימר), Airbnb, Booking.com, Agoda, Expedia hotel bookings and vacation rentals, in Israel or abroad. NOT flights (Flights), NOT tours, car rental or travel agency packages (Travel), and NOT restaurants or bars inside a hotel when billed separately (Restaurants).'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.workspace_id = w.id AND c.kind = 'expense'
    AND lower(c.name) = lower('Hotels')
);

-- 2. Refresh seeded descriptions only where the user has not edited them.
UPDATE categories
SET description = 'Tours, car rental and travel agencies (guided tours, attraction passes, rental cars abroad, package deals). NOT lodging (Hotels), NOT flights (Flights), NOT travel insurance (Travel Insurance), and NOT everyday spending abroad: categorize restaurants, groceries, transport and shopping abroad by what they are.'
WHERE kind = 'expense' AND name = 'Travel'
  AND description = 'Lodging, tours, car rental and travel agencies (hotels, Airbnb, vacation rentals, guided tours, rental cars abroad). NOT flights (Flights), NOT travel insurance (Travel Insurance), and NOT everyday spending abroad: categorize restaurants, groceries, transport and shopping abroad by what they are.';

UPDATE categories
SET description = 'Airline tickets and flight booking sites (El Al, Israir, Arkia, Wizz Air, Ryanair, Kiwi.com). NOT hotels (Hotels), NOT tours (Travel) and NOT travel insurance (Travel Insurance).'
WHERE kind = 'expense' AND name = 'Flights'
  AND description = 'Airline tickets and flight booking sites (El Al, Israir, Arkia, Wizz Air, Ryanair, Kiwi.com). NOT hotels or tours (Travel) and NOT travel insurance (Travel Insurance).';

UPDATE categories
SET description = 'Rollup of trip costs: flights, hotels, tours, travel insurance.'
WHERE kind = 'expense' AND name = 'Trips & Travel' AND parent_id IS NULL
  AND description = 'Rollup of trip costs: flights, lodging and tours, travel insurance.';
