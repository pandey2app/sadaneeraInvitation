const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken } = require('../auth');
const driveService = require('../services/driveService');

// Multer memory storage config - NEVER writes photos to local container filesystem
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Helper function to calculate data checksum
function calculateChecksum(fields, photoHash) {
  const hash = crypto.createHash('sha256');
  hash.update(fields.title || '');
  hash.update(fields.gender || '');
  hash.update((fields.guest_name || '').trim().toLowerCase());
  hash.update((fields.guest_about || '').trim());
  hash.update(fields.event_date || '');
  hash.update(fields.event_venue || '');
  hash.update(photoHash || '');
  return hash.digest('hex');
}

// PUBLIC PHOTO PROXY ROUTE: Serves Google Drive photos reliably without CORS issues
// Must be registered BEFORE authenticateToken so invitation cards can be viewed anywhere
router.get('/photo/drive/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    if (!fileId) {
      return res.status(400).send('File ID required');
    }

    const photoData = await driveService.fetchPhotoBuffer(fileId);

    if (!photoData || !photoData.buffer) {
      // Fallback redirect to direct Google CDN if available
      return res.redirect(`https://lh3.googleusercontent.com/d/${fileId}`);
    }

    res.setHeader('Content-Type', photoData.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(photoData.buffer);
  } catch (err) {
    console.error('Photo proxy error:', err.message);
    res.redirect(`https://lh3.googleusercontent.com/d/${req.params.fileId}`);
  }
});

// Protect all remaining card management routes with authentication
router.use(authenticateToken);

// POST /api/cards - Create and record new invitation card
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const {
      title,
      gender,
      guest_name,
      guest_about,
      guest_badge = 'विशिष्ट अतिथि',
      theme = 'royal-gold',
      event_date,
      event_time,
      event_venue,
      photo_base64
    } = req.body;

    // Retrieve master event settings as authoritative source
    const masterSettings = (await db.prepare('SELECT * FROM event_settings WHERE id = 1').get()) || {};
    const finalEventDate = masterSettings.event_date || (event_date && event_date.trim()) || '';
    const finalEventTime = masterSettings.event_time || (event_time && event_time.trim()) || '';
    const finalEventVenue = masterSettings.event_venue || (event_venue && event_venue.trim()) || '';

    // Checksum validation: Ensure NO mandatory field is left blank
    const missing = [];
    if (!title || !title.trim()) missing.push('Salutation / Title (Shri/Smt/Sushri)');
    if (!gender || !gender.trim()) missing.push('Gender');
    if (!guest_name || !guest_name.trim()) missing.push('Guest Name');
    if (!guest_about || !guest_about.trim()) missing.push('Guest About / Profession');

    let photoBuffer = null;
    let photoBufferForHash = '';

    // Extract photo from uploaded multipart buffer or base64 data URL
    if (req.file && req.file.buffer && req.file.buffer.length > 0) {
      photoBuffer = req.file.buffer;
    } else if (photo_base64 && photo_base64.startsWith('data:image')) {
      const matches = photo_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        photoBuffer = Buffer.from(matches[2], 'base64');
      }
    }

    if (!photoBuffer || photoBuffer.length === 0) {
      missing.push('Guest Photo (Cropped image is required)');
    } else {
      photoBufferForHash = photoBuffer.slice(0, 1024).toString('hex');
    }

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Validation Checksum Failed: Missing required fields [${missing.join(', ')}]. No details can be left blank.`
      });
    }

    // Permanent card numbering: the first 4 digits represent the lifetime card sequence; the suffix is a compact 4-digit unique code.
    const seqRow = await db.prepare('SELECT last_number FROM card_sequence WHERE id = 1').get();
    const currentSeq = seqRow ? parseInt(seqRow.last_number, 10) : 0;
    if (currentSeq >= 9999) {
      throw new Error('Maximum 4-digit card serial limit (9999) reached.');
    }
    const nextNumber = currentSeq + 1;
    await db.prepare('UPDATE card_sequence SET last_number = ? WHERE id = 1').run(nextNumber);

    const firstFourDigits = String(nextNumber).padStart(4, '0');

    // The suffix is a cryptographically-random 4-digit value.
    let suffix = '';
    let cardSerial = '';
    let cardCode = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      suffix = String(crypto.randomInt(1000, 10000));
      cardSerial = `${firstFourDigits}-${suffix}`;
      cardCode = `SN-${cardSerial}`;
      const exists = await db.prepare('SELECT id FROM invitations WHERE card_code = ?').get(cardCode);
      if (!exists) break;
      suffix = '';
    }

    if (!suffix) {
      throw new Error('Unable to allocate a unique card ID. Please try again.');
    }

    // Compute cryptographic integrity checksum
    const checksum = calculateChecksum(
      { title, gender, guest_name, guest_about, event_date: finalEventDate, event_venue: finalEventVenue },
      photoBufferForHash
    );

    // CENTRALIZED PERSISTENT STORAGE: Google Drive
    // Uploads 500x500 JPEG directly to centralized Google Drive folder
    let photoUrl = '';
    let driveFileId = null;

    try {
      const uploadResult = await driveService.uploadPhoto({
        buffer: photoBuffer,
        filename: `card_${cardSerial}_${Date.now()}.jpg`
      });
      photoUrl = uploadResult.proxyUrl;
      driveFileId = uploadResult.fileId;
      console.log(`[CardRoutes] Uploaded guest photo to centralized Google Drive: ${driveFileId}`);
    } catch (uploadErr) {
      console.error('[CardRoutes] Centralized Google Drive upload error:', uploadErr.message);
      // Strictly do NOT silently store base64 in Firestore! Return a clear upload error.
      return res.status(500).json({
        success: false,
        message: `Google Drive photo upload failed: ${uploadErr.message}. Card creation aborted to maintain data integrity.`
      });
    }

    const insertResult = await db.prepare(`
      INSERT INTO invitations (
        card_code, card_serial, title, gender, guest_name, guest_about, guest_badge, photo_url,
        theme, event_date, event_time, event_venue, checksum,
        created_by_id, created_by_name, created_by_username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cardCode,
      cardSerial,
      title.trim(),
      gender.trim(),
      guest_name.trim(),
      guest_about.trim(),
      (guest_badge || 'विशिष्ट अतिथि').trim(),
      photoUrl,
      theme,
      finalEventDate,
      finalEventTime,
      finalEventVenue,
      checksum,
      req.user.id,
      req.user.full_name,
      req.user.username
    );

    const newCard = await db.prepare('SELECT * FROM invitations WHERE id = ?').get(insertResult.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: 'Invitation record registered successfully. Ready for instant regeneration & download.',
      card: newCard,
      storage: driveFileId ? 'google_drive' : 'firestore_direct'
    });
  } catch (err) {
    console.error('Card creation error:', err);
    res.status(500).json({ success: false, message: 'Failed to record invitation card: ' + err.message });
  }
});

// GET /api/cards - List invitation card records with search & filters
router.get('/', async (req, res) => {
  try {
    const { search, created_by, theme, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        i.*,
        u.role AS creator_role
      FROM invitations i
      LEFT JOIN users u ON i.created_by_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      query += ` AND (
        LOWER(i.guest_name) LIKE ? OR 
        LOWER(i.guest_about) LIKE ? OR 
        LOWER(i.card_code) LIKE ? OR 
        LOWER(i.created_by_name) LIKE ?
      )`;
      params.push(term, term, term, term);
    }

    if (created_by) {
      query += ` AND i.created_by_id = ?`;
      params.push(created_by);
    }

    if (theme) {
      query += ` AND i.theme = ?`;
      params.push(theme);
    }

    query += ` ORDER BY i.id DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const cards = await db.prepare(query).all(...params);

    // Total count for pagination
    let countQuery = `SELECT COUNT(*) AS total FROM invitations i WHERE 1=1`;
    const countParams = [];
    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      countQuery += ` AND (
        LOWER(i.guest_name) LIKE ? OR 
        LOWER(i.guest_about) LIKE ? OR 
        LOWER(i.card_code) LIKE ? OR 
        LOWER(i.created_by_name) LIKE ?
      )`;
      countParams.push(term, term, term, term);
    }
    if (created_by) {
      countQuery += ` AND i.created_by_id = ?`;
      countParams.push(created_by);
    }
    if (theme) {
      countQuery += ` AND i.theme = ?`;
      countParams.push(theme);
    }

    const totalCountRow = await db.prepare(countQuery).get(...countParams);
    const totalCount = totalCountRow ? parseInt(totalCountRow.total, 10) : 0;

    res.json({
      success: true,
      total: totalCount,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      cards
    });
  } catch (err) {
    console.error('Fetch cards error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve card records.' });
  }
});

// GET /api/cards/:id - Fetch single card details for on-the-fly regeneration
router.get('/:id', async (req, res) => {
  try {
    const card = await db.prepare(`
      SELECT i.*, u.role AS creator_role
      FROM invitations i
      LEFT JOIN users u ON i.created_by_id = u.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!card) {
      return res.status(404).json({ success: false, message: 'Invitation record not found.' });
    }

    const masterSettings = (await db.prepare('SELECT * FROM event_settings WHERE id = 1').get()) || {};
    res.json({ success: true, card, masterSettings });
  } catch (err) {
    console.error('Fetch single card error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve card record.' });
  }
});

// DELETE /api/cards/:id - Soft-delete or permanent delete an invitation record
router.delete('/:id', async (req, res) => {
  try {
    const cardId = req.params.id;
    const card = await db.prepare('SELECT * FROM invitations WHERE id = ?').get(cardId);

    if (!card) {
      return res.status(404).json({ success: false, message: 'Invitation record not found.' });
    }

    if (req.user.role !== 'superadmin' && card.created_by_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only delete invitation records created by yourself.'
      });
    }

    const isPermanent = req.query.permanent === 'true' || card.is_deleted === 1;
    if (isPermanent) {
      // 1. If card has an associated Google Drive file, delete it permanently from Google Drive
      let driveId = card.drive_file_id || null;
      if (!driveId && card.photo_url && card.photo_url.includes('/drive/')) {
        const parts = card.photo_url.split('/drive/');
        if (parts.length > 1) {
          driveId = parts[1].split('?')[0];
        }
      }
      if (driveId && typeof driveId === 'string' && driveId.trim() && !driveId.includes('crop_') && !driveId.startsWith('data:')) {
        try {
          await driveService.deletePhoto(driveId.trim());
        } catch (driveErr) {
          console.warn('[CardRoutes] Notice deleting Drive photo during permanent delete:', driveErr.message);
        }
      }

      // If it was an old local upload file, attempt safe removal
      if (card.photo_url && card.photo_url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', '..', card.photo_url);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }
      await db.prepare('DELETE FROM invitations WHERE id = ?').run(cardId);
    } else {
      // Soft Delete: NEVER deletes the photo from Google Drive!
      await db.prepare(`
        UPDATE invitations
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP,
            deleted_by_id = ?, deleted_by_name = ?, deleted_by_username = ?
        WHERE id = ?
      `).run(req.user.id, req.user.full_name, req.user.username, cardId);
    }

    res.json({
      success: true,
      message: isPermanent
        ? `Invitation ${card.card_code} को डेटाबेस से स्थायी रूप से हटा दिया गया है।`
        : `Invitation ${card.card_code} को डिलीट मार्क कर दिया गया है।`
    });
  } catch (err) {
    console.error('Delete card error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark invitation as deleted.' });
  }
});

// GET /api/cards/export/csv - Export records to CSV
router.get('/export/csv', async (req, res) => {
  try {
    const cards = await db.prepare(`
      SELECT 
        card_code, title, guest_name, gender, guest_about, theme, 
        checksum, created_by_name, created_by_username, created_at
      FROM invitations
      ORDER BY id DESC
    `).all();

    let csv = 'Card Code,Title,Guest Name,Gender,About/Profession,Theme,Checksum,Created By,Created At\n';
    cards.forEach(c => {
      const escape = (val) => `"${(val || '').toString().replace(/"/g, '""')}"`;
      csv += `${escape(c.card_code)},${escape(c.title)},${escape(c.guest_name)},${escape(c.gender)},${escape(c.guest_about)},${escape(c.theme)},${escape(c.checksum)},${escape(c.created_by_name)},${escape(c.created_at)}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sadaneera_invitations_records.csv"');
    res.send('\uFEFF' + csv); // Include BOM for Excel UTF-8 support
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ success: false, message: 'Failed to export CSV.' });
  }
});

module.exports = router;
