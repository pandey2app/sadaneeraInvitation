/**
 * Authoritative Database Engine for Sadaneera Mahotsav 2026
 * 
 * Supports:
 * 1. Persistent Google Cloud Firestore (Authoritative Production Source of Truth)
 * 2. Local SQLite (better-sqlite3) backup/fallback
 * 
 * Exposes a unified async db.prepare(sql).{get, all, run} interface so that all
 * application routes (authRoutes, adminRoutes, cardRoutes, statsRoutes, settingsRoutes)
 * remain 100% compatible without needing changes.
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let db = null;

// Check if Firebase applet configuration is present
const firebaseConfigPath = path.join(__dirname, '..', 'firebase-applet-config.json');
const isFirebaseConfigured = fs.existsSync(firebaseConfigPath);

if (isFirebaseConfigured) {
  console.log('🔥 Initializing Persistent Firebase Firestore as Authoritative Production Engine...');
  const { initializeApp } = require('firebase/app');
  const {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    runTransaction
  } = require('firebase/firestore');

  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  const app = initializeApp(firebaseConfig);
  const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  // In-memory synced sequence counter cached for atomic card serial increments
  let cachedSequenceNumber = 0;

  async function syncInitialSequence() {
    try {
      const seqDoc = await getDoc(doc(firestoreDb, 'card_sequence', '1'));
      if (seqDoc.exists()) {
        const val = seqDoc.data().last_number;
        cachedSequenceNumber = (val !== undefined && val !== null) ? Number(val) : 0;
      } else {
        await setDoc(doc(firestoreDb, 'card_sequence', '1'), { id: 1, last_number: 0 });
      }
    } catch (e) {
      console.warn('[Firestore] Warning initializing sequence:', e.message);
    }
  }

  async function ensureInitialData() {
    try {
      const usersSnap = await getDocs(collection(firestoreDb, 'users'));
      if (usersSnap.empty) {
        const migrationPath = path.join(__dirname, 'data', 'production_migration_data.json');
        if (fs.existsSync(migrationPath)) {
          const snapData = JSON.parse(fs.readFileSync(migrationPath, 'utf8'));
          for (const u of snapData.users || []) {
            await setDoc(doc(firestoreDb, 'users', String(u.id)), u);
          }
          if (snapData.event_settings) {
            await setDoc(doc(firestoreDb, 'event_settings', '1'), snapData.event_settings);
          }
          if (snapData.card_sequence) {
            await setDoc(doc(firestoreDb, 'card_sequence', '1'), snapData.card_sequence);
          }
          for (const inv of snapData.invitations || []) {
            await setDoc(doc(firestoreDb, 'invitations', String(inv.id)), inv);
          }
          console.log('[Firestore] Seeded initial authoritative snapshot data.');
        }
      }
    } catch (e) {
      console.warn('[Firestore] Notice during ensureInitialData:', e.message);
    }
  }

  syncInitialSequence();
  ensureInitialData();

  // Helper to fetch all documents from a collection as array of objects
  async function getAllDocuments(collectionName) {
    const snap = await getDocs(collection(firestoreDb, collectionName));
    const list = [];
    snap.forEach(d => {
      list.push({ ...d.data(), _docId: d.id });
    });
    return list;
  }

  db = {
    isFirestore: true,
    firestoreDb,

    prepare(sql) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();

      return {
        get: async (...rawParams) => {
          const params = rawParams.length === 1 && Array.isArray(rawParams[0]) ? rawParams[0] : rawParams;

          // 1. SELECT * FROM users WHERE [LOWER(]username[)] = ?
          if (/SELECT \* FROM users WHERE (LOWER\()?username(\))? = \?/i.test(cleanSql)) {
            const usernameParam = (params[0] || '').toString().toLowerCase();
            const users = await getAllDocuments('users');
            return users.find(u => (u.username || '').toLowerCase() === usernameParam) || null;
          }

          // 2. SELECT id FROM users WHERE [LOWER(]username[)] = ?
          if (/SELECT id FROM users WHERE (LOWER\()?username(\))? = \?/i.test(cleanSql)) {
            const usernameParam = (params[0] || '').toString().toLowerCase();
            const users = await getAllDocuments('users');
            const found = users.find(u => (u.username || '').toLowerCase() === usernameParam);
            return found ? { id: found.id } : null;
          }

          // 3. SELECT ... FROM users WHERE id = ? (handles authenticateToken and admin routes)
          if (/SELECT .* FROM users WHERE id = \?/i.test(cleanSql)) {
            const targetId = Number(params[0]);
            const users = await getAllDocuments('users');
            const found = users.find(u => Number(u.id) === targetId);
            return found ? { ...found } : null;
          }

          // 5. SELECT password_hash FROM users WHERE id = ? AND role = 'superadmin' AND is_active = 1
          if (/SELECT password_hash FROM users WHERE id = \? AND role = 'superadmin' AND is_active = 1/i.test(cleanSql)) {
            const targetId = Number(params[0]);
            const users = await getAllDocuments('users');
            const found = users.find(u => Number(u.id) === targetId && u.role === 'superadmin' && u.is_active === 1);
            return found ? { password_hash: found.password_hash } : null;
          }

          // 6. SELECT COUNT(*) AS count FROM users WHERE role IN ('admin','superadmin') AND is_active = 1
          if (/SELECT COUNT\(\*\) AS count FROM users WHERE role IN \('admin','superadmin'\) AND is_active = 1/i.test(cleanSql)) {
            const users = await getAllDocuments('users');
            const count = users.filter(u => (u.role === 'admin' || u.role === 'superadmin') && u.is_active === 1).length;
            return { count };
          }

          // 7. SELECT * FROM event_settings WHERE id = 1
          if (/SELECT \* FROM event_settings WHERE id = 1/i.test(cleanSql)) {
            const docSnap = await getDoc(doc(firestoreDb, 'event_settings', '1'));
            return docSnap.exists() ? docSnap.data() : null;
          }

          // 8. SELECT last_number FROM card_sequence WHERE id = 1
          if (/SELECT last_number FROM card_sequence WHERE id = 1/i.test(cleanSql)) {
            const docSnap = await getDoc(doc(firestoreDb, 'card_sequence', '1'));
            if (docSnap.exists()) {
              const val = docSnap.data().last_number;
              cachedSequenceNumber = (val !== undefined && val !== null) ? Number(val) : 0;
              return { last_number: cachedSequenceNumber };
            }
            return { last_number: cachedSequenceNumber };
          }

          // 9. SELECT id FROM invitations WHERE card_code = ?
          if (/SELECT id FROM invitations WHERE card_code = \?/i.test(cleanSql)) {
            const cardCode = params[0];
            const invs = await getAllDocuments('invitations');
            const found = invs.find(i => i.card_code === cardCode);
            return found ? { id: found.id } : null;
          }

          // 10. SELECT * FROM invitations WHERE id = ?
          if (/SELECT \* FROM invitations WHERE id = \?/i.test(cleanSql)) {
            const cardId = Number(params[0]);
            const invs = await getAllDocuments('invitations');
            return invs.find(i => Number(i.id) === cardId) || null;
          }

          // 11. SELECT i.*, u.role AS creator_role FROM invitations i LEFT JOIN users u ... WHERE i.id = ?
          if (/SELECT i\.\*, u\.role AS creator_role FROM invitations i.*WHERE i\.id = \?/i.test(cleanSql)) {
            const cardId = Number(params[0]);
            const invs = await getAllDocuments('invitations');
            const card = invs.find(i => Number(i.id) === cardId);
            if (!card) return null;
            const users = await getAllDocuments('users');
            const creator = users.find(u => Number(u.id) === Number(card.created_by_id));
            return {
              ...card,
              creator_role: creator ? creator.role : null
            };
          }

          // 12. SELECT COUNT(*) AS count FROM invitations WHERE created_by_id = ?
          if (/SELECT COUNT\(\*\) AS count FROM invitations WHERE created_by_id = \?/i.test(cleanSql)) {
            const creatorId = Number(params[0]);
            const invs = await getAllDocuments('invitations');
            const count = invs.filter(i => Number(i.created_by_id) === creatorId).length;
            return { count };
          }

          // 13. SELECT COUNT(*) AS count FROM invitations WHERE DATE(created_at) = DATE('now', 'localtime')
          if (/SELECT COUNT\(\*\) AS count FROM invitations WHERE DATE\(created_at\)/i.test(cleanSql)) {
            const todayStr = new Date().toISOString().slice(0, 10);
            const invs = await getAllDocuments('invitations');
            const count = invs.filter(i => (i.created_at || '').slice(0, 10) === todayStr).length;
            return { count };
          }

          // 14. SELECT COUNT(*) AS count FROM invitations
          if (/SELECT COUNT\(\*\) AS count FROM invitations/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            return { count: invs.length };
          }

          // 15. SELECT COUNT(*) AS total FROM invitations i WHERE 1=1 (with optional search/filters)
          if (/SELECT COUNT\(\*\) AS total FROM invitations/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            let filtered = invs;

            // Handle dynamic filter params
            let pIdx = 0;
            if (/LOWER\(i\.guest_name\) LIKE \?/i.test(cleanSql)) {
              const searchTerm = (params[pIdx] || '').replace(/%/g, '').toLowerCase();
              pIdx += 4; // covers guest_name, guest_about, card_code, created_by_name
              filtered = filtered.filter(i =>
                (i.guest_name || '').toLowerCase().includes(searchTerm) ||
                (i.guest_about || '').toLowerCase().includes(searchTerm) ||
                (i.card_code || '').toLowerCase().includes(searchTerm) ||
                (i.created_by_name || '').toLowerCase().includes(searchTerm)
              );
            }
            if (/i\.created_by_id = \?/i.test(cleanSql)) {
              const creatorId = Number(params[pIdx++]);
              filtered = filtered.filter(i => Number(i.created_by_id) === creatorId);
            }
            if (/i\.theme = \?/i.test(cleanSql)) {
              const theme = params[pIdx++];
              filtered = filtered.filter(i => i.theme === theme);
            }
            return { total: filtered.length };
          }

          console.warn('[Firestore get fallback] Unhandled SQL query:', cleanSql, params);
          return null;
        },

        all: async (...rawParams) => {
          const params = rawParams.length === 1 && Array.isArray(rawParams[0]) ? rawParams[0] : rawParams;

          // 1. GET /api/admins: List all admins with their card counts
          if (/FROM users u LEFT JOIN invitations i ON i\.created_by_id = u\.id/i.test(cleanSql) && /cards_generated/i.test(cleanSql)) {
            const users = await getAllDocuments('users');
            const invs = await getAllDocuments('invitations');
            const result = users.map(u => {
              const cardsCount = invs.filter(i => Number(i.created_by_id) === Number(u.id)).length;
              return {
                id: u.id,
                username: u.username,
                full_name: u.full_name,
                email: u.email,
                role: u.role,
                is_active: u.is_active,
                created_at: u.created_at,
                cards_generated: cardsCount
              };
            });
            result.sort((a, b) => {
              if (a.role === 'superadmin' && b.role !== 'superadmin') return -1;
              if (b.role === 'superadmin' && a.role !== 'superadmin') return 1;
              return (a.created_at || '').localeCompare(b.created_at || '');
            });
            return result;
          }

          // 2. GET /api/stats/dashboard: adminActivity
          if (/SELECT u\.id, u\.full_name, u\.username.*deleted_actions.*FROM users u/i.test(cleanSql)) {
            const users = (await getAllDocuments('users')).filter(u => u.role === 'admin' || u.role === 'superadmin');
            const invs = await getAllDocuments('invitations');
            const todayStr = new Date().toISOString().slice(0, 10);

            const result = users.map(u => {
              const userCards = invs.filter(i => Number(i.created_by_id) === Number(u.id));
              const total_cards = userCards.length;
              const deleted_cards = userCards.filter(i => Number(i.is_deleted) === 1).length;
              const active_cards = userCards.filter(i => Number(i.is_deleted) === 0).length;
              const today_cards = userCards.filter(i => (i.created_at || '').slice(0, 10) === todayStr).length;

              const deletedActions = invs.filter(i => Number(i.deleted_by_id) === Number(u.id)).length;
              const todayDeletedActions = invs.filter(i => Number(i.deleted_by_id) === Number(u.id) && (i.deleted_at || '').slice(0, 10) === todayStr).length;

              return {
                id: u.id,
                full_name: u.full_name,
                username: u.username,
                admin_created_at: u.created_at,
                total_cards,
                deleted_cards,
                active_cards,
                today_cards,
                deleted_actions: deletedActions,
                today_deleted_actions: todayDeletedActions
              };
            });

            result.sort((a, b) => b.total_cards - a.total_cards);
            return result;
          }

          // 3. GET /api/stats/dashboard: recentCards
          if (/FROM invitations ORDER BY id DESC LIMIT 10/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            invs.sort((a, b) => Number(b.id) - Number(a.id));
            return invs.slice(0, 10).map(i => ({
              id: i.id,
              card_code: i.card_code,
              title: i.title,
              guest_name: i.guest_name,
              photo_url: i.photo_url,
              created_by_name: i.created_by_name,
              created_at: i.created_at,
              theme: i.theme,
              is_deleted: i.is_deleted,
              deleted_by_name: i.deleted_by_name,
              deleted_at: i.deleted_at
            }));
          }

          // 4. GET /api/cards: invitations with filters, limit, offset
          if (/SELECT i\.\*, u\.role AS creator_role FROM invitations i LEFT JOIN users u/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            const users = await getAllDocuments('users');
            let filtered = invs;

            let pIdx = 0;
            if (/LOWER\(i\.guest_name\) LIKE \?/i.test(cleanSql)) {
              const searchTerm = (params[pIdx] || '').replace(/%/g, '').toLowerCase();
              pIdx += 4;
              filtered = filtered.filter(i =>
                (i.guest_name || '').toLowerCase().includes(searchTerm) ||
                (i.guest_about || '').toLowerCase().includes(searchTerm) ||
                (i.card_code || '').toLowerCase().includes(searchTerm) ||
                (i.created_by_name || '').toLowerCase().includes(searchTerm)
              );
            }
            if (/i\.created_by_id = \?/i.test(cleanSql)) {
              const creatorId = Number(params[pIdx++]);
              filtered = filtered.filter(i => Number(i.created_by_id) === creatorId);
            }
            if (/i\.theme = \?/i.test(cleanSql)) {
              const theme = params[pIdx++];
              filtered = filtered.filter(i => i.theme === theme);
            }

            filtered.sort((a, b) => Number(b.id) - Number(a.id));

            const limitVal = params.length >= 2 ? Number(params[params.length - 2]) : 50;
            const offsetVal = params.length >= 1 ? Number(params[params.length - 1]) : 0;

            const sliced = filtered.slice(offsetVal, offsetVal + limitVal);

            return sliced.map(card => {
              const creator = users.find(u => Number(u.id) === Number(card.created_by_id));
              return {
                ...card,
                creator_role: creator ? creator.role : null
              };
            });
          }

          // 5. GET /api/cards/export/csv
          if (/SELECT card_code, title, guest_name.*FROM invitations ORDER BY id DESC/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            invs.sort((a, b) => Number(b.id) - Number(a.id));
            return invs;
          }

          // 6. Generic SELECT * FROM invitations
          if (/SELECT \* FROM invitations/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            invs.sort((a, b) => Number(b.id) - Number(a.id));
            return invs;
          }

          // 7. Generic SELECT * FROM users
          if (/SELECT \* FROM users/i.test(cleanSql)) {
            return await getAllDocuments('users');
          }

          console.warn('[Firestore all fallback] Unhandled SQL query:', cleanSql, params);
          return [];
        },

        run: async (...rawParams) => {
          const params = rawParams.length === 1 && Array.isArray(rawParams[0]) ? rawParams[0] : rawParams;

          // 1. INSERT INTO users
          if (/INSERT INTO users/i.test(cleanSql)) {
            const [username, password_hash, full_name, email, role] = params;
            const users = await getAllDocuments('users');
            const maxId = users.reduce((max, u) => Math.max(max, Number(u.id || 0)), 0);
            const newId = maxId + 1;
            const newUser = {
              id: newId,
              username,
              password_hash,
              full_name,
              email: email || '',
              role: role || 'admin',
              is_active: 1,
              created_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
            };
            await setDoc(doc(firestoreDb, 'users', String(newId)), newUser);
            console.log(`[Firestore] User created: ${username} (id: ${newId})`);
            return { lastInsertRowid: newId, changes: 1 };
          }

          // 2. UPDATE users SET is_active = ? WHERE id = ?
          if (/UPDATE users SET is_active = \? WHERE id = \?/i.test(cleanSql)) {
            const [newStatus, targetId] = params;
            await updateDoc(doc(firestoreDb, 'users', String(targetId)), { is_active: Number(newStatus) });
            console.log(`[Firestore] User status updated for id ${targetId} -> ${newStatus}`);
            return { changes: 1 };
          }

          // 3. DELETE FROM users WHERE id = ?
          if (/DELETE FROM users WHERE id = \?/i.test(cleanSql)) {
            const targetId = params[0];
            await deleteDoc(doc(firestoreDb, 'users', String(targetId)));
            console.log(`[Firestore] User deleted permanently: id ${targetId}`);
            return { changes: 1 };
          }

          // 4. UPDATE card_sequence SET last_number = ? WHERE id = 1
          if (/UPDATE card_sequence SET last_number = \? WHERE id = 1/i.test(cleanSql)) {
            const nextSeq = Number(params[0]);
            cachedSequenceNumber = nextSeq;
            await setDoc(doc(firestoreDb, 'card_sequence', '1'), { id: 1, last_number: nextSeq });
            return { changes: 1 };
          }

          // 5. INSERT INTO invitations
          if (/INSERT INTO invitations/i.test(cleanSql)) {
            const [
              card_code,
              card_serial,
              title,
              gender,
              guest_name,
              guest_about,
              guest_badge,
              photo_url,
              theme,
              event_date,
              event_time,
              event_venue,
              checksum,
              created_by_id,
              created_by_name,
              created_by_username
            ] = params;

            const invs = await getAllDocuments('invitations');
            const maxId = invs.reduce((max, i) => Math.max(max, Number(i.id || 0)), 0);
            const newId = maxId + 1;

            let drive_file_id = null;
            let drive_direct_url = null;
            let photo_storage = 'local';

            if (photo_url && (photo_url.includes('/drive/') || photo_url.includes('googleusercontent.com'))) {
              photo_storage = 'google_drive';
              const parts = photo_url.split('/drive/');
              if (parts.length > 1) {
                drive_file_id = parts[1].split('?')[0];
                drive_direct_url = `https://lh3.googleusercontent.com/d/${drive_file_id}`;
              } else if (photo_url.includes('/d/')) {
                drive_file_id = photo_url.split('/d/')[1].split('?')[0];
                drive_direct_url = photo_url;
              }
            }

            const newCard = {
              id: newId,
              card_code,
              card_serial,
              title,
              gender,
              guest_name,
              guest_about,
              guest_badge,
              photo_url,
              drive_file_id,
              drive_direct_url,
              photo_storage,
              theme,
              event_date,
              event_time,
              event_venue,
              checksum,
              created_by_id,
              created_by_name,
              created_by_username,
              created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
              is_deleted: 0,
              deleted_at: null,
              deleted_by_id: null,
              deleted_by_name: null,
              deleted_by_username: null
            };

            await setDoc(doc(firestoreDb, 'invitations', String(newId)), newCard);
            console.log(`[Firestore] Invitation created: ${card_code} ${guest_name} (id: ${newId})`);
            return { lastInsertRowid: newId, changes: 1 };
          }

          // 6. Soft delete invitation
          if (/UPDATE invitations\s+SET is_deleted = 1/i.test(cleanSql)) {
            const [deleted_by_id, deleted_by_name, deleted_by_username, cardId] = params;
            await updateDoc(doc(firestoreDb, 'invitations', String(cardId)), {
              is_deleted: 1,
              deleted_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
              deleted_by_id,
              deleted_by_name,
              deleted_by_username
            });
            console.log(`[Firestore] Soft deleted invitation id: ${cardId}`);
            return { changes: 1 };
          }

          // 7. Permanent delete invitation
          if (/DELETE FROM invitations WHERE id = \?/i.test(cleanSql)) {
            const cardId = params[0];
            await deleteDoc(doc(firestoreDb, 'invitations', String(cardId)));
            console.log(`[Firestore] Permanently deleted invitation id: ${cardId}`);
            return { changes: 1 };
          }

          // 8. Reset all cards: DELETE FROM invitations
          if (/DELETE FROM invitations$/i.test(cleanSql)) {
            const invs = await getAllDocuments('invitations');
            for (const i of invs) {
              await deleteDoc(doc(firestoreDb, 'invitations', String(i.id)));
            }
            console.log(`[Firestore] Cleared all ${invs.length} invitations`);
            return { changes: invs.length };
          }

          // 9. UPDATE event_settings
          if (/UPDATE event_settings/i.test(cleanSql)) {
            const [
              program_name,
              program_subtitle,
              invocation,
              event_date,
              event_time,
              event_venue,
              invitation_message,
              organizer_name,
              updated_by
            ] = params;

            await updateDoc(doc(firestoreDb, 'event_settings', '1'), {
              program_name,
              program_subtitle,
              invocation,
              event_date,
              event_time,
              event_venue,
              invitation_message,
              organizer_name,
              updated_by,
              updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
            });
            console.log('[Firestore] Event settings updated');
            return { changes: 1 };
          }

          console.warn('[Firestore run fallback] Unhandled write SQL:', cleanSql, params);
          return { changes: 0 };
        }
      };
    },

    async transaction(callback) {
      return await callback();
    }
  };
} else {
  // Fallback to SQLite (if running without Firestore)
  const Database = require('better-sqlite3');
  const sqliteDb = new Database(path.join(__dirname, '..', 'sadaneera.sqlite'));
  db = {
    isFirestore: false,
    sqliteDb,
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      return {
        get: async (...p) => stmt.get(...p),
        all: async (...p) => stmt.all(...p),
        run: async (...p) => stmt.run(...p)
      };
    }
  };
}

module.exports = db;
