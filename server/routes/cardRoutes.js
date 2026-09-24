const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken } = require('../auth');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const unique = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Protect all card routes with authentication
router.use(authenticateToken);

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

// POST /api/cards - Create and record new invitation card
router.post('/', upload.single('photo'), (req, res) => {
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

    // Retrieve master event settings as defaults if not provided
    const masterSettings = db.prepare('SELECT * FROM event_settings WHERE id = 1').get() || {};
    const finalEventDate = (event_date && event_date.trim()) || masterSettings.event_date || '15-17 नवंबर 2026';
    const finalEventTime = (event_time && event_time.trim()) || masterSettings.event_time || 'सायं 5:00 बजे से';
    const finalEventVenue = (event_venue && event_venue.trim()) || masterSettings.event_venue || 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर';

    // Checksum validation: Ensure NO mandatory field is left blank
    const missing = [];
    if (!title || !title.trim()) missing.push('Salutation / Title (Shri/Smt/Sushri)');
    if (!gender || !gender.trim()) missing.push('Gender');
    if (!guest_name || !guest_name.trim()) missing.push('Guest Name');
    if (!guest_about || !guest_about.trim()) missing.push('Guest About / Profession');

    let photoFilename = '';
    let photoBufferForHash = '';

    // Handle uploaded file or base64 cropped data
    if (req.file) {
      photoFilename = req.file.filename;
      photoBufferForHash = fs.readFileSync(req.file.path).slice(0, 1024).toString('hex');
    } else if (photo_base64 && photo_base64.startsWith('data:image')) {
      const matches = photo_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const ext = matches[1].includes('png') ? '.png' : '.jpg';
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `crop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const savePath = path.join(uploadDir, filename);
        fs.writeFileSync(savePath, buffer);
        photoFilename = filename;
        photoBufferForHash = buffer.slice(0, 1024).toString('hex');
      }
    }

    if (!photoFilename) {
      missing.push('Guest Photo (Cropped image is required)');
    }

    if (missing.length > 0) {
      // Clean up uploaded file if validation failed
      if (photoFilename && fs.existsSync(path.join(uploadDir, photoFilename))) {
        try { fs.unlinkSync(path.join(uploadDir, photoFilename)); } catch (e) {}
      }
      return res.status(400).json({
        success: false,
        message: `Validation Checksum Failed: Missing required fields [${missing.join(', ')}]. No details can be left blank.`
      });
    }

    // Serial Number Format: First 5 digits = card number, Next 4 digits = random digits
    const countResult = db.prepare('SELECT COUNT(*) AS count FROM invitations').get();
    const countNumber = countResult.count + 1;
    const firstFiveDigits = countNumber.toString().padStart(5, '0'); // e.g. "00001"
    const randomFourDigits = Math.floor(1000 + Math.random() * 9000).toString(); // e.g. "8492"
    const cardSerial = `${firstFiveDigits}-${randomFourDigits}`; // e.g. "00001-8492"
    const cardCode = `SN-${cardSerial}`;

    // Compute cryptographic integrity checksum
    const checksum = calculateChecksum(
      { title, gender, guest_name, guest_about, event_date: finalEventDate, event_venue: finalEventVenue },
      photoBufferForHash
    );

    const photoUrl = `/uploads/${photoFilename}`;

    const insert = db.prepare(`
      INSERT INTO invitations (
        card_code, card_serial, title, gender, guest_name, guest_about, guest_badge, photo_url,
        theme, event_date, event_time, event_venue, checksum,
        created_by_id, created_by_name, created_by_username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
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

    const newCard = db.prepare('SELECT * FROM invitations WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: 'Invitation record registered successfully. Ready for instant regeneration & download.',
      card: newCard
    });
  } catch (err) {
    console.error('Card creation error:', err);
    res.status(500).json({ success: false, message: 'Failed to record invitation card.' });
  }
});

// GET /api/cards - List invitation card records with search & filters
router.get('/', (req, res) => {
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

    const cards = db.prepare(query).all(...params);

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

    const totalCount = db.prepare(countQuery).get(...countParams).total;

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
router.get('/:id', (req, res) => {
  try {
    const card = db.prepare(`
      SELECT i.*, u.role AS creator_role
      FROM invitations i
      LEFT JOIN users u ON i.created_by_id = u.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!card) {
      return res.status(404).json({ success: false, message: 'Invitation record not found.' });
    }

    const masterSettings = db.prepare('SELECT * FROM event_settings WHERE id = 1').get() || {};

    res.json({ success: true, card, masterSettings });
  } catch (err) {
    console.error('Fetch single card error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve card record.' });
  }
});

// DELETE /api/cards/:id - Delete an invitation record
router.delete('/:id', (req, res) => {
  try {
    const cardId = req.params.id;
    const card = db.prepare('SELECT * FROM invitations WHERE id = ?').get(cardId);

    if (!card) {
      return res.status(404).json({ success: false, message: 'Invitation record not found.' });
    }

    // Role check: Only Super Admin or the creator admin can delete
    if (req.user.role !== 'superadmin' && card.created_by_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only delete invitation records created by yourself.'
      });
    }

    // Delete photo file from disk if present
    if (card.photo_url) {
      const filename = path.basename(card.photo_url);
      const filePath = path.join(uploadDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }

    db.prepare('DELETE FROM invitations WHERE id = ?').run(cardId);

    res.json({ success: true, message: `Invitation ${card.card_code} deleted successfully.` });
  } catch (err) {
    console.error('Delete card error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete invitation record.' });
  }
});

// GET /api/cards/export/csv - Export records to CSV
router.get('/export/csv', (req, res) => {
  try {
    const cards = db.prepare(`
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
