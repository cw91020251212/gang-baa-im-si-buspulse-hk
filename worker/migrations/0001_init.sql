CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  expiration_time INTEGER,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL REFERENCES subscriptions(endpoint) ON DELETE CASCADE,
  co TEXT NOT NULL,
  route TEXT NOT NULL,
  dir TEXT,
  bound TEXT,
  service_type TEXT,
  stop_id TEXT,
  seq INTEGER NOT NULL,
  route_id TEXT,
  route_seq TEXT,
  dest TEXT,
  stop_name TEXT,
  lead REAL NOT NULL DEFAULT 2,
  session TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(endpoint, co, route, dir, bound, service_type, stop_id, seq, route_id, route_seq)
);
CREATE INDEX IF NOT EXISTS watches_endpoint_active ON watches(endpoint, active);
CREATE TABLE IF NOT EXISTS deliveries (
  endpoint TEXT NOT NULL,
  trip_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY(endpoint, trip_key)
);
CREATE INDEX IF NOT EXISTS deliveries_sent_at ON deliveries(sent_at);
