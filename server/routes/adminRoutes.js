const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticateToken, requireSuperAdmin } = require('../auth');
const driveService = require('../services/driveService');

// All routes in this file require Super Admin role!
router.use(authenticateToken);
router.use(requireSuperAdmin);

// GET /api/admins - List all admins with their card counts
router.get('/', async (req, res) => {
  try {
    const users = await db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email, 
        u.role, 
        u.is_active, 
        u.created_at,
        COUNT(i.id) AS cards_generated
      FROM users u
      LEFT JOIN invitations i ON i.created_by_id = u.id
      GROUP BY u.id
      ORDER BY 
        CASE WHEN u.role = 'superadmin' THEN 0 ELSE 1 END,
        u.created_at ASC
    `).all();

    res.json({ success: true, admins: users });
  } catch (err) {
    console.error('List admins error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve admin accounts.' });
  }
});

// POST /api/admins - Create a new admin account
router.post('/', async (req, res) => {
  try {
    const { username, password, full_name, email } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and full name are required.'
      });
    }

    const trimmedUser = username.trim().toLowerCase();
    if (trimmedUser.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(trimmedUser);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username is already taken.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    const result = await db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).run(trimmedUser, password_hash, full_name.trim(), (email || '').trim());

    const newAdmin = await db.prepare('SELECT id, username, full_name, email, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: `Admin account "${trimmedUser}" created successfully.`,
      admin: newAdmin
    });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to create admin.' });
  }
});

// PATCH /api/admins/:id/toggle-status - Activate or deactivate an admin account
router.patch('/:id/toggle-status', async (req, res) => {
  try {
    const targetId = req.params.id;

    if (parseInt(targetId, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own Super Admin account.' });
    }

    const target = await db.prepare('SELECT id, role, is_active, username FROM users WHERE id = ?').get(targetId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (target.role === 'superadmin') {
      return res.status(403).json({ success: false, message: 'Super Admin accounts cannot be deactivated.' });
    }

    const newStatus = target.is_active === 1 ? 0 : 1;
    await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, targetId);

    res.json({
      success: true,
      message: `Admin "${target.username}" ${newStatus === 1 ? 'activated' : 'deactivated'} successfully.`,
      is_active: newStatus
    });
  } catch (err) {
    console.error('Toggle admin status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update admin status.' });
  }
});

// DELETE /api/admins/:id - Permanently delete an admin account
router.delete('/:id', async (req, res) => {
  try {
    const targetId = req.params.id;

    if (parseInt(targetId, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own Super Admin account.' });
    }

    const user = await db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ success: false, message: 'Super Admin account cannot be deleted.' });
    }

    await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    res.json({ success: true, message: `Admin "${user.username}" deleted successfully.` });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete admin.' });
  }
});

// POST /api/admins/reset-cards - Super Admin only, password + confirmation phrase required.
// Clears invitation records and associated Google Drive photos, then resets card_sequence/1 to 0 ONLY on complete success.
router.post('/reset-cards', async (req, res) => {
  try {
    const { password, confirmation } = req.body || {};
    if (!password || confirmation !== 'DELETE ALL CARDS') {
      return res.status(400).json({ success: false, message: 'Super Admin password और exact confirmation phrase आवश्यक हैं.' });
    }

    const user = await db.prepare("SELECT password_hash FROM users WHERE id = ? AND role = 'superadmin' AND is_active = 1").get(req.user.id);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: 'Super Admin password गलत है.' });
    }

    // 1. Fetch all current invitations
    const allInvitations = await db.prepare('SELECT * FROM invitations').all();

    // 2. Identify any invitations that have valid, explicit Google Drive file IDs
    const driveIdsToDelete = [];
    for (const inv of allInvitations) {
      let dId = inv.drive_file_id || null;
      if (!dId && inv.photo_url && inv.photo_url.includes('/drive/')) {
        const parts = inv.photo_url.split('/drive/');
        if (parts.length > 1) {
          dId = parts[1].split('?')[0];
        }
      }
      // Safety: Only collect legitimate file IDs; ignore legacy filenames or data URIs
      if (dId && typeof dId === 'string' && dId.trim() && !dId.includes('crop_') && !dId.startsWith('data:')) {
        driveIdsToDelete.push(dId.trim());
      }
    }

    // 3. Delete associated Google Drive photo files (if any exist)
    let deletedDriveFiles = 0;

    for (const fileId of driveIdsToDelete) {
      try {
        await driveService.deletePhoto(fileId);
        deletedDriveFiles++;
      } catch (dErr) {
        console.error(`[AdminRoutes] Google Drive photo deletion failed for file ${fileId}:`, dErr.message);
        // SAFETY INVARIANT: If any required Google Drive deletion fails, ABORT cleanup!
        // DO NOT delete Firestore records and DO NOT reset card_sequence!
        return res.status(500).json({
          success: false,
          message: `Google Drive photo file (${fileId}) delete failed: ${dErr.message}. Permanent cleanup aborted safely. Sequence was NOT reset.`
        });
      }
    }

    // 4. Delete all invitations from Firestore database
    const deleteResult = await db.prepare('DELETE FROM invitations').run();

    // 5. Clean up any leftover local upload directory files
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    let deletedLocalFiles = 0;
    if (fs.existsSync(uploadDir)) {
      for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
        const target = path.join(uploadDir, entry.name);
        try {
          if (entry.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
          else fs.unlinkSync(target);
          deletedLocalFiles++;
        } catch (e) {
          console.warn('Could not delete upload during reset:', target, e.message);
        }
      }
    } else {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 6. SAFETY INVARIANT: Reset sequence ONLY after complete, successful deletion of all cards and Drive files
    await db.prepare('UPDATE card_sequence SET last_number = 0 WHERE id = 1').run();

    console.log(`[AdminRoutes] Complete permanent cleanup successful: ${allInvitations.length} cards, ${deletedDriveFiles} Drive files, sequence reset to 0.`);

    res.json({
      success: true,
      message: `सभी ${allInvitations.length} invitation records, ${deletedDriveFiles} Google Drive photo फ़ाइलें और स्थानीय फाइल्स सफलतापूर्वक साफ कर दी गई हैं। कार्ड क्रमांक रीसेट (0) कर दिया गया है। Users और master settings सुरक्षित हैं।`,
      deletedCards: allInvitations.length,
      deletedDriveFiles,
      deletedLocalFiles,
      sequenceReset: true
    });
  } catch (err) {
    console.error('Reset all cards error:', err);
    res.status(500).json({
      success: false,
      message: 'सभी कार्ड डेटा साफ नहीं किया जा सका। कोई अधूरा रीसेट नहीं किया गया।'
    });
  }
});

module.exports = router;
