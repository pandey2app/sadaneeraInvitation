const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireSuperAdmin } = require('../auth');

// All settings routes require login
router.use(authenticateToken);

// GET /api/settings/card-content - Read current master event card template
router.get('/card-content', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM event_settings WHERE id = 1').get();
    if (!settings) {
      return res.status(404).json({ success: false, message: 'Settings not found.' });
    }
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve card settings.' });
  }
});

// PUT /api/settings/card-content - Update master event card template (Super Admin ONLY!)
router.put('/card-content', requireSuperAdmin, (req, res) => {
  try {
    const {
      program_name,
      program_subtitle,
      invocation,
      event_date,
      event_time,
      event_venue,
      invitation_message,
      organizer_name
    } = req.body;

    if (!program_name || !program_name.trim()) {
      return res.status(400).json({ success: false, message: 'कार्यक्रम का नाम (Program Name) आवश्यक है।' });
    }

    db.prepare(`
      UPDATE event_settings
      SET 
        program_name = ?,
        program_subtitle = ?,
        invocation = ?,
        event_date = ?,
        event_time = ?,
        event_venue = ?,
        invitation_message = ?,
        organizer_name = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      program_name.trim(),
      (program_subtitle || '').trim(),
      (invocation || '').trim(),
      (event_date || '').trim(),
      (event_time || '').trim(),
      (event_venue || '').trim(),
      (invitation_message || '').trim(),
      (organizer_name || '').trim(),
      req.user.username
    );

    const updated = db.prepare('SELECT * FROM event_settings WHERE id = 1').get();

    res.json({
      success: true,
      message: 'कार्ड सामग्री और कार्यक्रम विवरण सफलतापूर्वक अपडेट किया गया। यह सभी नए कार्ड्स पर लागू होगा।',
      settings: updated
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to update card content settings.' });
  }
});

module.exports = router;
