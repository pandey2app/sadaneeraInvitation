const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'sadaneera.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function addColumnIfMissing(table, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`); } catch (e) {}
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      updated_by TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      event_date TEXT DEFAULT '15-17 नवंबर 2026',
      event_time TEXT DEFAULT 'सायं 5:00 बजे से',
      event_venue TEXT DEFAULT 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
      checksum TEXT NOT NULL,
      created_by_id INTEGER NOT NULL,
      created_by_name TEXT NOT NULL,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS card_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_number INTEGER NOT NULL DEFAULT 0
    );
  `);

  addColumnIfMissing('invitations', "guest_badge TEXT DEFAULT 'विशिष्ट अतिथि'");
  addColumnIfMissing('invitations', 'card_serial TEXT');
  addColumnIfMissing('invitations', 'is_deleted INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('invitations', 'deleted_at DATETIME');
  addColumnIfMissing('invitations', 'deleted_by_id INTEGER');
  addColumnIfMissing('invitations', 'deleted_by_name TEXT');
  addColumnIfMissing('invitations', 'deleted_by_username TEXT');

  // Ensure the permanent card counter starts after the highest serial ever created.
  // It is deliberately independent of COUNT(*), so deleting cards never reuses numbers.
  const existingSequence = db.prepare('SELECT id FROM card_sequence WHERE id = 1').get();
  if (!existingSequence) {
    let maxNumber = 0;
    const rows = db.prepare('SELECT card_serial FROM invitations WHERE card_serial IS NOT NULL').all();
    for (const row of rows) {
      const match = String(row.card_serial || '').match(/^(\d{1,})-/);
      if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10) || 0);
    }
    db.prepare('INSERT INTO card_sequence (id, last_number) VALUES (1, ?)').run(maxNumber);
  }

  const settings = db.prepare('SELECT * FROM event_settings WHERE id = 1').get();
  if (!settings) {
    db.prepare(`
      INSERT INTO event_settings (
        id, program_name, program_subtitle, invocation,
        event_date, event_time, event_venue, invitation_message, organizer_name, updated_by
      ) VALUES (
        1,
        'सदानीरा महोत्सव 2026',
        'सांस्कृतिक, साहित्यिक एवं कला महासमागम',
        '॥ सदानीरा जीवनदायिनी संस्कृतिधारा ॥',
        '15-17 नवंबर 2026',
        'सायं 5:00 बजे से',
        'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
        'आपको सादर आमंत्रित करते हुए हमें अपार हर्ष हो रहा है। आपकी गरिमामयी उपस्थिति इस सांस्कृतिक अनुष्ठान को नव ऊर्जा एवं भव्यता प्रदान करेगी।',
        'समस्त आयोजन समिति, सदानीरा महोत्सव न्यास',
        'superadmin'
      )
    `).run();
  }

  const superAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('superadmin');
  if (!superAdmin) {
    const username = (process.env.SUPERADMIN_USERNAME || '').trim().toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD || '';
    const fullName = (process.env.SUPERADMIN_NAME || 'मुख्य प्रशासक (Super Admin)').trim();
    const email = (process.env.SUPERADMIN_EMAIL || '').trim() || null;

    if (username && password.length >= 8) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(password, salt);
      db.prepare(`
        INSERT INTO users (username, password_hash, full_name, email, role, is_active)
        VALUES (?, ?, ?, ?, 'superadmin', 1)
      `).run(username, hash, fullName, email);
      console.log(`✓ Production Super Admin created: ${username}`);
    } else {
      console.warn('⚠ No Super Admin exists. Set SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD (8+ chars) before first production start.');
    }
  }
}

initDb();

module.exports = db;
