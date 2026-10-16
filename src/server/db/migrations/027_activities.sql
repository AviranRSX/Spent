-- Activities: tours, attractions and excursions on a trip get their own leaf
-- under Trips & Travel, split out of Travel.

-- 1. The Activities leaf, unless the workspace already has an expense
--    category with that name. Workspaces without a top-level Trips & Travel
--    get an ungrouped leaf.
INSERT INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id,
       (SELECT p.id FROM categories p
         WHERE p.workspace_id = w.id AND p.kind = 'expense'
           AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')),
       'Activities', '#D98C5F', 'compass', 'expense', 'tracking',
       'Things to do on a trip: guided tours, day trips, excursions, attraction and museum tickets, theme parks, diving, ski passes and experiences booked through GetYourGuide, Viator, Klook or Tiqets. NOT lodging (Hotels), NOT flights (Flights), NOT car rental or travel agency packages (Travel), and NOT everyday outings at home (Entertainment, Sports & Hobbies).'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.workspace_id = w.id AND c.kind = 'expense'
    AND lower(c.name) = lower('Activities')
);

-- 2. Refresh seeded descriptions only where the user has not edited them.
UPDATE categories
SET description = 'Car rental and travel agencies (rental cars abroad, package deals, travel agency fees). NOT tours or attractions (Activities), NOT lodging (Hotels), NOT flights (Flights), NOT travel insurance (Travel Insurance), and NOT everyday spending abroad: categorize restaurants, groceries, transport and shopping abroad by what they are.'
WHERE kind = 'expense' AND name = 'Travel'
  AND description = 'Tours, car rental and travel agencies (guided tours, attraction passes, rental cars abroad, package deals). NOT lodging (Hotels), NOT flights (Flights), NOT travel insurance (Travel Insurance), and NOT everyday spending abroad: categorize restaurants, groceries, transport and shopping abroad by what they are.';

UPDATE categories
SET description = 'Lodging: hotels, hostels, resorts, guesthouses, zimmers (צימר), Airbnb, Booking.com, Agoda, Expedia hotel bookings and vacation rentals, in Israel or abroad. NOT flights (Flights), NOT tours or attractions (Activities), NOT car rental or travel agency packages (Travel), and NOT restaurants or bars inside a hotel when billed separately (Restaurants).'
WHERE kind = 'expense' AND name = 'Hotels'
  AND description = 'Lodging: hotels, hostels, resorts, guesthouses, zimmers (צימר), Airbnb, Booking.com, Agoda, Expedia hotel bookings and vacation rentals, in Israel or abroad. NOT flights (Flights), NOT tours, car rental or travel agency packages (Travel), and NOT restaurants or bars inside a hotel when billed separately (Restaurants).';

UPDATE categories
SET description = 'Airline tickets and flight booking sites (El Al, Israir, Arkia, Wizz Air, Ryanair, Kiwi.com). NOT hotels (Hotels), NOT tours (Activities) and NOT travel insurance (Travel Insurance).'
WHERE kind = 'expense' AND name = 'Flights'
  AND description = 'Airline tickets and flight booking sites (El Al, Israir, Arkia, Wizz Air, Ryanair, Kiwi.com). NOT hotels (Hotels), NOT tours (Travel) and NOT travel insurance (Travel Insurance).';

UPDATE categories
SET description = 'Rollup of trip costs: flights, hotels, activities, car rental, travel insurance.'
WHERE kind = 'expense' AND name = 'Trips & Travel' AND parent_id IS NULL
  AND description = 'Rollup of trip costs: flights, hotels, tours, travel insurance.';
