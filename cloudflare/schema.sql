-- ============================================================================
-- Cloudflare D1 Database Schema for Sadaneera Mahotsav 2026
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================================

-- 1. Users Table (Super Admin and Admins)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Invitations Table (Cards generated with soft-delete & tracking)
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_code TEXT UNIQUE NOT NULL,
  card_serial TEXT,
  title TEXT NOT NULL,
  gender TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_about TEXT NOT NULL,
  guest_badge TEXT DEFAULT 'विशिष्ट अतिथि',
  photo_url TEXT NOT NULL,
  theme TEXT DEFAULT 'royal-gold',
  event_date TEXT DEFAULT '18 नवंबर 2026',
  event_time TEXT DEFAULT 'सुबह 10 बजे से',
  event_venue TEXT DEFAULT 'करवतही बाजार, गोपालगंज (बिहार)',
  checksum TEXT NOT NULL,
  created_by_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL,
  created_by_username TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at DATETIME,
  deleted_by_id INTEGER,
  deleted_by_name TEXT,
  deleted_by_username TEXT,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Master Event Settings (Singleton Row id = 1)
CREATE TABLE IF NOT EXISTS event_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  program_name TEXT NOT NULL,
  program_subtitle TEXT NOT NULL,
  invocation TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_venue TEXT NOT NULL,
  invitation_message TEXT NOT NULL,
  organizer_name TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Card Sequence Tracker (Singleton Row id = 1)
-- Fresh D1 database starts empty at last_number = 0
CREATE TABLE IF NOT EXISTS card_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER NOT NULL DEFAULT 0
);

-- Initialize Singleton Defaults
INSERT OR IGNORE INTO card_sequence (id, last_number) VALUES (1, 0);

INSERT OR IGNORE INTO event_settings (
  id, program_name, program_subtitle, invocation,
  event_date, event_time, event_venue,
  invitation_message, organizer_name, updated_by
) VALUES (
  1,
  'सदानीरा महोत्सव 2026',
  'साहित्य | संगीत | सिनेमा',
  'चरणाश्रयी फाउण्डेशन की प्रस्तुति',
  '18 नवंबर 2026',
  'सुबह 10 बजे से',
  'करवतही बाजार, गोपालगंज (बिहार)',
  'आइए, साहित्य को शहरों के वातानुकूलित कमरों से निकाल कर देहात की चौपाल तक ले चलते हैं...',
  'टीम सदानीरा',
  'System Init'
);

-- Indexes for optimal query performance on D1
CREATE INDEX IF NOT EXISTS idx_invitations_card_code ON invitations(card_code);
CREATE INDEX IF NOT EXISTS idx_invitations_created_by ON invitations(created_by_id);
CREATE INDEX IF NOT EXISTS idx_invitations_is_deleted ON invitations(is_deleted);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
