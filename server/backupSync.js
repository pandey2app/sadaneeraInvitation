// Runtime backup sync utility
// NOTE: Runtime JSON syncing for users and invitations has been completely removed
// in accordance with production data persistence requirements.
// The authoritative database is the sole source of truth.

const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function syncUsersBackup() {
  // Runtime users_backup.json dependency completely disabled.
  // The authoritative persistent database is the source of truth.
}

function syncInvitationsBackup() {
  // Runtime invitations_backup.json dependency completely disabled.
  // The authoritative persistent database is the source of truth.
}

function syncMasterSettingsBackup(db) {
  try {
    if (!db) return;
    if (typeof db.pragma === 'function') {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    }
    const settings = typeof db.prepare === 'function' 
      ? db.prepare('SELECT * FROM event_settings WHERE id = 1').get()
      : null;
    if (!settings) return;
    const jsonStr = JSON.stringify(settings, null, 2);
    fs.writeFileSync(path.join(dataDir, 'master_settings.json'), jsonStr, 'utf8');
  } catch (err) {
    console.error('[BackupSync Error] Failed to update master_settings.json:', err.message);
  }
}

module.exports = {
  syncUsersBackup,
  syncInvitationsBackup,
  syncMasterSettingsBackup
};
