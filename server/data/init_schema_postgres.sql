-- PostgreSQL Production Schema for Sadaneera Mahotsav 2026
-- Authoritative schema for Supabase / Neon / Cloud SQL / Vercel Postgres

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(50) NOT NULL CHECK(role IN ('superadmin', 'admin')),
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
  updated_by VARCHAR(100) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  card_code VARCHAR(100) UNIQUE NOT NULL,
  card_serial VARCHAR(100),
  title VARCHAR(50) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  guest_name VARCHAR(255) NOT NULL,
  guest_about TEXT NOT NULL,
  guest_badge VARCHAR(100) DEFAULT 'विशिष्ट अतिथि',
  photo_url TEXT NOT NULL,
  theme VARCHAR(50) DEFAULT 'royal-gold',
  event_date VARCHAR(100) DEFAULT '15-17 नवंबर 2026',
  event_time VARCHAR(100) DEFAULT 'सायं 5:00 बजे से',
  event_venue VARCHAR(255) DEFAULT 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
  checksum VARCHAR(255) NOT NULL,
  created_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_name VARCHAR(255) NOT NULL,
  created_by_username VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by_id INTEGER,
  deleted_by_name VARCHAR(255),
  deleted_by_username VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS card_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER NOT NULL DEFAULT 0
);
