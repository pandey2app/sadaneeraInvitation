const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'sadaneera.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');

function initDb() {
  // Ensure tables exist
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
  `);

  // Migrate any missing columns if table already existed
  try { db.exec("ALTER TABLE invitations ADD COLUMN guest_badge TEXT DEFAULT 'विशिष्ट अतिथि'"); } catch(e) {}
  try { db.exec("ALTER TABLE invitations ADD COLUMN card_serial TEXT"); } catch(e) {}

  // Seed default master card content settings
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
    console.log('✓ Master Card Content Settings initialized.');
  }

  // Seed default superadmin if not exists
  const superAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('superadmin');
  if (!superAdmin) {
    const defaultSuperPass = 'Admin@Sadaneera2026';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultSuperPass, salt);

    const insert = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    insert.run('superadmin', hash, 'मुख्य प्रशासक (Super Admin)', 'superadmin@sadaneera.org', 'superadmin');
    console.log('✓ Default Super Admin created: [username: superadmin / password: Admin@Sadaneera2026]');

    // Also seed a default sample admin for easy demonstration
    const adminPass = 'Admin@123';
    const adminHash = bcrypt.hashSync(adminPass, salt);
    insert.run('admin_user', adminHash, 'आलोक कुमार (Sub Admin)', 'admin@sadaneera.org', 'admin');
    console.log('✓ Default Admin created: [username: admin_user / password: Admin@123]');
  }
}

initDb();

module.exports = db;
