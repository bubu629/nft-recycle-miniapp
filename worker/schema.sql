CREATE TABLE IF NOT EXISTS nfts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  recycle_rate REAL NOT NULL DEFAULT 0.80,
  status TEXT NOT NULL DEFAULT 'listed',
  cycle INTEGER NOT NULL DEFAULT 1,
  owner_tg_id TEXT DEFAULT '',
  owner_wallet TEXT DEFAULT '',
  buy_tx_ref TEXT DEFAULT '',
  recycle_payout_wallet TEXT DEFAULT '',
  recycle_tx_ref TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nft_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nft_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_tg_id TEXT DEFAULT '',
  wallet_address TEXT DEFAULT '',
  tx_ref TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
