-- Trips: a label on top of each transaction's normal category. Automatic
-- membership is computed on read (src/lib/trips/membership.ts), so only
-- trips and the user's manual decisions are stored.

CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country TEXT,
  currency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_trips_workspace_status ON trips(workspace_id, status);

-- Manual decisions. trip_id NULL means "not part of any trip".
CREATE TABLE trip_assignments (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_trip_assignments_workspace ON trip_assignments(workspace_id);
CREATE INDEX idx_trip_assignments_trip ON trip_assignments(trip_id);

-- 1. The Trips & Travel parent group, unless the workspace already has an
--    expense category with that name (UNIQUE(workspace_id, kind, name)).
INSERT INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id, NULL, 'Trips & Travel', '#4FA3A5', 'plane', 'expense', 'tracking',
       'Rollup of trip costs: flights, lodging and tours, travel insurance.'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.workspace_id = w.id AND c.kind = 'expense'
    AND lower(c.name) = lower('Trips & Travel')
);

-- 2. New leaves. The parent lookup only accepts a top-level Trips & Travel,
--    so a same-named leaf inside another group yields an ungrouped leaf.
INSERT INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id,
       (SELECT p.id FROM categories p
         WHERE p.workspace_id = w.id AND p.kind = 'expense'
           AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')),
       'Flights', '#8AA7E0', 'plane', 'expense', 'tracking',
       'Airline tickets and flight booking sites (El Al, Israir, Arkia, Wizz Air, Ryanair, Kiwi.com). NOT hotels or tours (Travel) and NOT travel insurance (Travel Insurance).'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.workspace_id = w.id AND c.kind = 'expense'
    AND lower(c.name) = lower('Flights')
);

INSERT INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id,
       (SELECT p.id FROM categories p
         WHERE p.workspace_id = w.id AND p.kind = 'expense'
           AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')),
       'Travel Insurance', '#C79A8B', 'shield', 'expense', 'tracking',
       'Insurance bought for a trip (travel insurance policies, travel health cover, trip cancellation cover). NOT car, home, health or life premiums (Insurance).'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.workspace_id = w.id AND c.kind = 'expense'
    AND lower(c.name) = lower('Travel Insurance')
);

-- 3. Move existing Flights / Travel / Travel Insurance leaves under the group.
--    Skips rows that are themselves parents and workspaces without a
--    top-level Trips & Travel. Budget modes and colors stay as the user set them.
UPDATE categories
SET parent_id = (
  SELECT p.id FROM categories p
  WHERE p.workspace_id = categories.workspace_id AND p.kind = 'expense'
    AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')
)
WHERE kind = 'expense'
  AND lower(name) IN ('flights', 'travel', 'travel insurance')
  AND NOT EXISTS (
    SELECT 1 FROM categories child WHERE child.parent_id = categories.id
  )
  AND EXISTS (
    SELECT 1 FROM categories p
    WHERE p.workspace_id = categories.workspace_id AND p.kind = 'expense'
      AND p.parent_id IS NULL AND lower(p.name) = lower('Trips & Travel')
      AND p.id <> categories.id
  );

-- 4. Refresh seeded descriptions only where the user has not edited them.
UPDATE categories
SET description = 'Lodging, tours, car rental and travel agencies (hotels, Airbnb, vacation rentals, guided tours, rental cars abroad). NOT flights (Flights), NOT travel insurance (Travel Insurance), and NOT everyday spending abroad: categorize restaurants, groceries, transport and shopping abroad by what they are.'
WHERE kind = 'expense' AND name = 'Travel'
  AND description = 'Flights, hotels, Airbnb, vacation rentals, travel agencies, foreign-currency lodging, car rentals abroad. NOT daily transport (Transport).';

UPDATE categories
SET description = 'Public transport (Rav-Kav, Israel Railways), taxis (Gett, Yango), ride-share, fuel stations, parking, car washes, tolls. NOT car insurance (Insurance) and NOT airfare (Flights).'
WHERE kind = 'expense' AND name = 'Transport'
  AND description = 'Public transport (Rav-Kav, Israel Railways), taxis (Gett, Yango), ride-share, fuel stations, parking, car washes, tolls. NOT car insurance (Insurance) and NOT travel airfare (Travel).';

UPDATE categories
SET description = 'Rollup of getting-around spending: daily commutes, fuel and parking.'
WHERE kind = 'expense' AND name = 'Transportation' AND parent_id IS NULL
  AND description = 'Rollup of getting-around spending: daily commutes plus travel.';
