/**
 * Cloudflare Worker for Sadaneera Mahotsav 2026
 * Handles all REST API routes (/api/*) backed by Cloudflare D1
 * and delegates static assets to Cloudflare Assets.
 */

import {
  generateToken,
  authenticateRequest,
  comparePassword,
  hashPassword,
  ensureSuperAdmin
} from './auth.js';
import { uploadPhoto, fetchPhotoResponse, deletePhoto } from './drive.js';

// JSON helper response
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // Only route /api/* requests; delegate everything else to static assets
    if (!url.pathname.startsWith('/api')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Not found', { status: 404 });
    }

    try {
      // Auto-initialize default Super Admin if not present
      await ensureSuperAdmin(env);

      // ----------------------------------------------------------------------
      // Health Check
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/health') {
        return json({
          status: 'ok',
          event: 'Sadaneera Mahotsav Invitation Card System (Cloudflare Worker + D1)',
          timestamp: new Date().toISOString()
        });
      }

      // ----------------------------------------------------------------------
      // Public Drive Photo Proxy
      // ----------------------------------------------------------------------
      if (url.pathname.startsWith('/api/photos/drive/')) {
        const fileId = url.pathname.replace('/api/photos/drive/', '');
        return Response.redirect(`${url.origin}/api/cards/photo/drive/${fileId}`, 302);
      }

      if (url.pathname.startsWith('/api/cards/photo/drive/')) {
        const fileId = url.pathname.replace('/api/cards/photo/drive/', '');
        if (!fileId) return json({ success: false, message: 'File ID missing' }, 400);
        return fetchPhotoResponse(fileId, env);
      }

      // ----------------------------------------------------------------------
      // Auth Routes
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { username, password } = body;
        if (!username || !password) {
          return json({ success: false, message: 'Username and password are required.' }, 400);
        }

        const trimmedUser = username.trim().toLowerCase();
        const user = await env.DB.prepare(
          'SELECT * FROM users WHERE LOWER(username) = ?'
        ).bind(trimmedUser).first();

        if (!user) {
          return json({ success: false, message: 'Invalid credentials. User not found.' }, 401);
        }

        if (user.is_active !== 1) {
          return json({ success: false, message: 'Account is deactivated. Please contact Super Admin.' }, 403);
        }

        const match = comparePassword(password, user.password_hash);
        if (!match) {
          return json({ success: false, message: 'Incorrect password.' }, 401);
        }

        const token = await generateToken(user, env);
        return json({
          success: true,
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            email: user.email,
            role: user.role
          }
        });
      }

      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        return json({ success: true, message: 'Logged out successfully.' });
      }

      if (url.pathname === '/api/auth/me' && method === 'GET') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        return json({
          success: true,
          user: {
            id: auth.user.id,
            username: auth.user.username,
            full_name: auth.user.full_name,
            email: auth.user.email,
            role: auth.user.role
          }
        });
      }

      // ----------------------------------------------------------------------
      // Master Event Settings Routes
      // ----------------------------------------------------------------------
      if ((url.pathname === '/api/settings/card-content' || url.pathname === '/api/settings/master') && method === 'GET') {
        const settings = await env.DB.prepare('SELECT * FROM event_settings WHERE id = 1').first();
        return json({
          success: true,
          settings: settings || {
            program_name: 'सदानीरा महोत्सव 2026',
            program_subtitle: 'साहित्य | संगीत | सिनेमा',
            invocation: 'चरणाश्रयी फाउण्डेशन की प्रस्तुति',
            event_date: '18 नवंबर 2026',
            event_time: 'सुबह 10 बजे से',
            event_venue: 'करवतही बाजार, गोपालगंज (बिहार)',
            invitation_message: 'आइए, साहित्य को शहरों के वातानुकूलित कमरों से निकाल कर देहात की चौपाल तक ले चलते हैं...',
            organizer_name: 'टीम सदानीरा'
          }
        });
      }

      if ((url.pathname === '/api/settings/card-content' || url.pathname === '/api/settings/master') && method === 'PUT') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') {
          return json({ success: false, message: 'Access denied. Super Admin privileges required.' }, 403);
        }

        const body = await request.json().catch(() => ({}));
        const {
          program_name,
          program_subtitle,
          invocation,
          event_date,
          event_time,
          event_venue,
          invitation_message,
          organizer_name
        } = body;

        await env.DB.prepare(`
          INSERT INTO event_settings (
            id, program_name, program_subtitle, invocation, event_date, event_time,
            event_venue, invitation_message, organizer_name, updated_by, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            program_name = excluded.program_name,
            program_subtitle = excluded.program_subtitle,
            invocation = excluded.invocation,
            event_date = excluded.event_date,
            event_time = excluded.event_time,
            event_venue = excluded.event_venue,
            invitation_message = excluded.invitation_message,
            organizer_name = excluded.organizer_name,
            updated_by = excluded.updated_by,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          program_name || 'सदानीरा महोत्सव 2026',
          program_subtitle || 'साहित्य | संगीत | सिनेमा',
          invocation || 'चरणाश्रयी फाउण्डेशन की प्रस्तुति',
          event_date || '18 नवंबर 2026',
          event_time || 'सुबह 10 बजे से',
          event_venue || 'करवतही बाजार, गोपालगंज (बिहार)',
          invitation_message || '',
          organizer_name || 'टीम सदानीरा',
          auth.user.full_name
        ).run();

        const updated = await env.DB.prepare('SELECT * FROM event_settings WHERE id = 1').first();
        return json({ success: true, message: 'Master card settings updated successfully', settings: updated });
      }

      // ----------------------------------------------------------------------
      // Admin Management Routes (Super Admin Only)
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/admins' && method === 'GET') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') {
          return json({ success: false, message: 'Access denied. Super Admin role required.' }, 403);
        }

        const { results } = await env.DB.prepare(`
          SELECT 
            u.id, u.username, u.full_name, u.email, u.role, u.is_active, u.created_at,
            COUNT(i.id) AS cards_generated
          FROM users u
          LEFT JOIN invitations i ON i.created_by_id = u.id
          GROUP BY u.id
          ORDER BY CASE WHEN u.role = 'superadmin' THEN 0 ELSE 1 END, u.created_at ASC
        `).all();

        return json({ success: true, admins: results || [] });
      }

      if (url.pathname === '/api/admins' && method === 'POST') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') {
          return json({ success: false, message: 'Access denied. Super Admin role required.' }, 403);
        }

        const body = await request.json().catch(() => ({}));
        const { username, password, full_name, email } = body;
        if (!username || !password || !full_name) {
          return json({ success: false, message: 'Username, password, and full name are required.' }, 400);
        }

        const trimmedUser = username.trim().toLowerCase();
        if (trimmedUser.length < 3) {
          return json({ success: false, message: 'Username must be at least 3 characters.' }, 400);
        }
        if (password.length < 6) {
          return json({ success: false, message: 'Password must be at least 6 characters.' }, 400);
        }

        const existing = await env.DB.prepare(
          'SELECT id FROM users WHERE LOWER(username) = ?'
        ).bind(trimmedUser).first();
        if (existing) {
          return json({ success: false, message: 'Username is already taken.' }, 409);
        }

        const hash = hashPassword(password);
        const insertResult = await env.DB.prepare(
          'INSERT INTO users (username, password_hash, full_name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(trimmedUser, hash, full_name.trim(), email ? email.trim() : null, 'admin', 1).run();

        return json({
          success: true,
          message: 'Admin account created successfully.',
          admin: {
            id: insertResult.meta.last_row_id,
            username: trimmedUser,
            full_name: full_name.trim(),
            email: email ? email.trim() : null,
            role: 'admin',
            is_active: 1
          }
        }, 201);
      }

      const matchToggleAdmin = url.pathname.match(/^\/api\/admins\/(\d+)\/toggle-status$/);
      if (matchToggleAdmin && method === 'PATCH') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') return json({ success: false, message: 'Access denied.' }, 403);

        const targetId = parseInt(matchToggleAdmin[1], 10);
        const target = await env.DB.prepare('SELECT id, role, is_active FROM users WHERE id = ?').bind(targetId).first();
        if (!target) return json({ success: false, message: 'Admin account not found.' }, 404);
        if (target.role === 'superadmin') {
          return json({ success: false, message: 'Cannot deactivate the primary Super Admin.' }, 400);
        }

        const newStatus = target.is_active === 1 ? 0 : 1;
        await env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(newStatus, targetId).run();
        return json({
          success: true,
          message: `Admin ${newStatus === 1 ? 'activated' : 'deactivated'} successfully.`,
          is_active: newStatus
        });
      }

      const matchDeleteAdmin = url.pathname.match(/^\/api\/admins\/(\d+)$/);
      if (matchDeleteAdmin && method === 'DELETE') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') return json({ success: false, message: 'Access denied.' }, 403);

        const targetId = parseInt(matchDeleteAdmin[1], 10);
        if (targetId === auth.user.id) {
          return json({ success: false, message: 'You cannot delete your own account.' }, 400);
        }
        const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(targetId).first();
        if (!target) return json({ success: false, message: 'Admin account not found.' }, 404);
        if (target.role === 'superadmin') {
          return json({ success: false, message: 'Cannot delete a Super Admin account.' }, 400);
        }

        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
        return json({ success: true, message: 'Admin account deleted successfully.' });
      }

      if (url.pathname === '/api/admins/reset-cards' && method === 'POST') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') return json({ success: false, message: 'Access denied.' }, 403);

        const body = await request.json().catch(() => ({}));
        const { password, confirmation } = body;
        if (!password || confirmation !== 'DELETE ALL CARDS') {
          return json({ success: false, message: 'Confirmation phrase "DELETE ALL CARDS" and password are required.' }, 400);
        }

        const superUser = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(auth.user.id).first();
        if (!superUser || !comparePassword(password, superUser.password_hash)) {
          return json({ success: false, message: 'Authentication failed. Incorrect password.' }, 401);
        }

        // Delete all photos from Google Drive
        const { results: allCards } = await env.DB.prepare('SELECT photo_url FROM invitations').all();
        if (allCards && allCards.length > 0) {
          for (const card of allCards) {
            if (card.photo_url && card.photo_url.includes('/drive/')) {
              const fileId = card.photo_url.split('/drive/')[1];
              if (fileId) ctx.waitUntil(deletePhoto(fileId, env));
            }
          }
        }

        // Wipe invitations and reset sequence to 0
        await env.DB.prepare('DELETE FROM invitations').run();
        await env.DB.prepare('UPDATE card_sequence SET last_number = 0 WHERE id = 1').run();

        return json({
          success: true,
          message: 'All invitation records safely deleted and card numbering sequence reset to 0.'
        });
      }

      // ----------------------------------------------------------------------
      // Stats / Dashboard Route
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/stats/dashboard' && method === 'GET') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);

        const totalRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM invitations WHERE is_deleted = 0').first();
        const activeAdminsRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE is_active = 1').first();
        const todayRow = await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM invitations WHERE is_deleted = 0 AND DATE(created_at) = DATE('now')"
        ).first();

        const { results: themeRows } = await env.DB.prepare(
          'SELECT theme, COUNT(*) AS count FROM invitations WHERE is_deleted = 0 GROUP BY theme'
        ).all();

        const { results: recentRows } = await env.DB.prepare(`
          SELECT id, card_code, title, guest_name, photo_url, theme, created_by_name, created_at
          FROM invitations
          WHERE is_deleted = 0
          ORDER BY created_at DESC
          LIMIT 8
        `).all();

        const { results: adminPerfRows } = await env.DB.prepare(`
          SELECT 
            u.id, u.full_name, u.username, u.role,
            COUNT(CASE WHEN i.is_deleted = 0 THEN i.id END) AS cards_generated,
            MAX(i.created_at) AS last_active
          FROM users u
          LEFT JOIN invitations i ON i.created_by_id = u.id
          WHERE u.is_active = 1
          GROUP BY u.id
          ORDER BY cards_generated DESC, u.full_name ASC
        `).all();

        return json({
          success: true,
          total_cards: totalRow?.total || 0,
          total_admins: activeAdminsRow?.total || 0,
          today_cards: todayRow?.total || 0,
          themes: themeRows || [],
          recent_cards: recentRows || [],
          admin_performance: adminPerfRows || []
        });
      }

      // ----------------------------------------------------------------------
      // Invitation Card Routes
      // ----------------------------------------------------------------------
      if (url.pathname === '/api/cards' && method === 'GET') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);

        const search = url.searchParams.get('search') || '';
        const theme = url.searchParams.get('theme') || '';
        const status = url.searchParams.get('status') || 'active';
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

        let whereClause = 'WHERE 1=1';
        const binds = [];

        if (status === 'active') {
          whereClause += ' AND i.is_deleted = 0';
        } else if (status === 'deleted') {
          whereClause += ' AND i.is_deleted = 1';
        }

        if (search.trim()) {
          whereClause += ' AND (LOWER(i.guest_name) LIKE ? OR LOWER(i.guest_about) LIKE ? OR LOWER(i.card_code) LIKE ?)';
          const term = `%${search.trim().toLowerCase()}%`;
          binds.push(term, term, term);
        }

        if (theme.trim()) {
          whereClause += ' AND i.theme = ?';
          binds.push(theme.trim());
        }

        const countQuery = `SELECT COUNT(*) AS total FROM invitations i ${whereClause}`;
        const totalRow = await env.DB.prepare(countQuery).bind(...binds).first();

        const selectQuery = `
          SELECT i.* FROM invitations i
          ${whereClause}
          ORDER BY i.created_at DESC
          LIMIT ? OFFSET ?
        `;
        const { results: cards } = await env.DB.prepare(selectQuery).bind(...binds, limit, offset).all();

        return json({
          success: true,
          total: totalRow?.total || 0,
          limit,
          offset,
          cards: cards || []
        });
      }

      const matchSingleCard = url.pathname.match(/^\/api\/cards\/(\d+)$/);
      if (matchSingleCard && method === 'GET') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);

        const cardId = parseInt(matchSingleCard[1], 10);
        const card = await env.DB.prepare('SELECT * FROM invitations WHERE id = ?').bind(cardId).first();
        if (!card) return json({ success: false, message: 'Card record not found.' }, 404);
        return json({ success: true, card });
      }

      if (url.pathname === '/api/cards' && method === 'POST') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);

        const contentType = request.headers.get('content-type') || '';
        let title, gender, guest_name, guest_about, guest_badge, theme, photoBytes, mimeType, checksum;

        if (contentType.includes('multipart/form-data')) {
          const formData = await request.formData();
          title = formData.get('title');
          gender = formData.get('gender');
          guest_name = formData.get('guest_name');
          guest_about = formData.get('guest_about');
          guest_badge = formData.get('guest_badge') || 'विशिष्ट अतिथि';
          theme = formData.get('theme') || 'royal-gold';
          checksum = formData.get('checksum');

          const photoFile = formData.get('photo');
          if (photoFile && typeof photoFile === 'object') {
            photoBytes = new Uint8Array(await photoFile.arrayBuffer());
            mimeType = photoFile.type || 'image/jpeg';
          }
        } else {
          const body = await request.json().catch(() => ({}));
          title = body.title;
          gender = body.gender;
          guest_name = body.guest_name;
          guest_about = body.guest_about;
          guest_badge = body.guest_badge || 'विशिष्ट अतिथि';
          theme = body.theme || 'royal-gold';
          checksum = body.checksum;

          if (body.photo_base64) {
            const matches = body.photo_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const base64Str = matches ? matches[2] : body.photo_base64;
            mimeType = matches ? matches[1] : 'image/jpeg';
            const binStr = atob(base64Str);
            photoBytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              photoBytes[i] = binStr.charCodeAt(i);
            }
          }
        }

        const missing = [];
        if (!title || !title.trim()) missing.push('Salutation (title)');
        if (!gender || !gender.trim()) missing.push('Gender');
        if (!guest_name || !guest_name.trim()) missing.push('Guest Name');
        if (!guest_about || !guest_about.trim()) missing.push('Guest About/Designation');
        if (!photoBytes || photoBytes.length === 0) missing.push('Guest Photo');

        if (missing.length > 0) {
          return json({
            success: false,
            message: `Validation Checksum Failed: Missing required fields [${missing.join(', ')}].`
          }, 400);
        }

        // Fetch master event settings
        const eventSettings = await env.DB.prepare('SELECT * FROM event_settings WHERE id = 1').first() || {};
        const event_date = eventSettings.event_date || '18 नवंबर 2026';
        const event_time = eventSettings.event_time || 'सुबह 10 बजे से';
        const event_venue = eventSettings.event_venue || 'करवतही बाजार, गोपालगंज (बिहार)';

        // Atomic card sequence increment in D1 (single atomic statement avoids race conditions under concurrency)
        const updatedSeq = await env.DB.prepare(
          'UPDATE card_sequence SET last_number = last_number + 1 WHERE id = 1 AND last_number < 9999 RETURNING last_number'
        ).first();

        if (!updatedSeq || updatedSeq.last_number === undefined) {
          return json({ success: false, message: 'Maximum 4-digit card serial limit (9999) reached or card sequence missing.' }, 400);
        }

        const nextNumber = updatedSeq.last_number;
        const firstFourDigits = String(nextNumber).padStart(4, '0');

        // Cryptographically-random 4-digit suffix
        let suffix = '';
        let cardSerial = '';
        let cardCode = '';
        const randomBuffer = new Uint16Array(1);
        for (let attempt = 0; attempt < 20; attempt++) {
          crypto.getRandomValues(randomBuffer);
          const randVal = 1000 + (randomBuffer[0] % 9000);
          suffix = String(randVal);
          cardSerial = `${firstFourDigits}-${suffix}`;
          cardCode = `SN-${cardSerial}`;
          const exists = await env.DB.prepare('SELECT id FROM invitations WHERE card_code = ?').bind(cardCode).first();
          if (!exists) break;
          suffix = '';
        }

        // Upload photo to Google Drive
        const photoFilename = `photo_${cardCode}.jpg`;
        const driveResult = await uploadPhoto(photoBytes, photoFilename, mimeType, env);
        const photo_url = `/api/cards/photo/drive/${driveResult.fileId}`;

        const finalChecksum = checksum || `SN-${cardCode}-${Date.now()}`;

        // Insert invitation record into D1
        const insertRes = await env.DB.prepare(`
          INSERT INTO invitations (
            card_code, card_serial, title, gender, guest_name, guest_about, guest_badge,
            photo_url, theme, event_date, event_time, event_venue, checksum,
            created_by_id, created_by_name, created_by_username
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          cardCode, cardSerial, title.trim(), gender.trim(), guest_name.trim(),
          guest_about.trim(), guest_badge.trim(), photo_url, theme.trim(),
          event_date, event_time, event_venue, finalChecksum,
          auth.user.id, auth.user.full_name, auth.user.username
        ).run();

        const createdCard = await env.DB.prepare('SELECT * FROM invitations WHERE id = ?').bind(insertRes.meta.last_row_id).first();

        return json({
          success: true,
          message: 'Invitation card generated and saved successfully.',
          card: createdCard
        }, 201);
      }

      // Soft delete card
      if (matchSingleCard && method === 'DELETE') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);

        const cardId = parseInt(matchSingleCard[1], 10);
        const card = await env.DB.prepare('SELECT * FROM invitations WHERE id = ?').bind(cardId).first();
        if (!card) return json({ success: false, message: 'Card not found.' }, 404);

        if (card.is_deleted === 1) {
          return json({ success: false, message: 'This card is already marked as deleted.' }, 400);
        }

        await env.DB.prepare(`
          UPDATE invitations
          SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP,
              deleted_by_id = ?, deleted_by_name = ?, deleted_by_username = ?
          WHERE id = ?
        `).bind(auth.user.id, auth.user.full_name, auth.user.username, cardId).run();

        return json({
          success: true,
          message: `Card ${card.card_code} marked as deleted. Record and photo preserved in audit log.`
        });
      }

      // Permanent delete card (Super Admin Only)
      const matchPermDelete = url.pathname.match(/^\/api\/cards\/(\d+)\/permanent$/);
      if (matchPermDelete && method === 'DELETE') {
        const auth = await authenticateRequest(request, env);
        if (auth.error) return json({ success: false, message: auth.error }, auth.status);
        if (auth.user.role !== 'superadmin') {
          return json({ success: false, message: 'Access denied. Super Admin role required for permanent deletion.' }, 403);
        }

        const cardId = parseInt(matchPermDelete[1], 10);
        const card = await env.DB.prepare('SELECT * FROM invitations WHERE id = ?').bind(cardId).first();
        if (!card) return json({ success: false, message: 'Card not found.' }, 404);

        // Delete photo from Drive
        if (card.photo_url && card.photo_url.includes('/drive/')) {
          const fileId = card.photo_url.split('/drive/')[1];
          if (fileId) ctx.waitUntil(deletePhoto(fileId, env));
        }

        await env.DB.prepare('DELETE FROM invitations WHERE id = ?').bind(cardId).run();

        return json({
          success: true,
          message: `Card ${card.card_code} and its Drive photo permanently deleted.`
        });
      }

      return json({ success: false, message: 'API endpoint not found.' }, 404);
    } catch (err) {
      console.error('Unhandled Worker Error:', err);
      return json({ success: false, message: err.message || 'Internal server error.' }, 500);
    }
  }
};
