const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticateToken, requireSuperAdmin } = require('../auth');

// All routes in this file require Super Admin role!
router.use(authenticateToken);
router.use(requireSuperAdmin);

// GET /api/admins - List all admins with their card counts
router.get('/', (req, res) => {
  try {
    const users = db.prepare(`
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
      ORDER BY u.role DESC, u.created_at ASC
    `).all();

    res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch admins error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch admin users.' });
  }
});

// POST /api/admins - Create a new Admin
router.post('/', (req, res) => {
  try {
    const { username, full_name, email, password, role } = req.body;

    if (!username || !full_name || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, Full Name, and Password are all required.'
      });
    }

    const trimmedUser = username.trim().toLowerCase();
    if (trimmedUser.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters long.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const assignedRole = role === 'superadmin' ? 'superadmin' : 'admin';

    // Check if username already exists
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(trimmedUser);
    if (existing) {
      return res.status(409).json({ success: false, message: `Username "${trimmedUser}" is already taken.` });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(trimmedUser, hash, full_name.trim(), email ? email.trim() : null, assignedRole);

    res.status(201).json({
      success: true,
      message: `Admin user "${trimmedUser}" created successfully.`,
      user: {
        id: result.lastInsertRowid,
        username: trimmedUser,
        full_name: full_name.trim(),
        email: email ? email.trim() : null,
        role: assignedRole,
        is_active: 1
      }
    });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to create admin.' });
  }
});

// PATCH /api/admins/:id/toggle-status - Toggle active/inactive
router.patch('/:id/toggle-status', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Prevent deactivating own account
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    const newStatus = user.is_active === 1 ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, targetId);

    res.json({
      success: true,
      message: `User status changed to ${newStatus === 1 ? 'Active' : 'Deactivated'}.`,
      is_active: newStatus
    });
  } catch (err) {
    console.error('Toggle admin status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update admin status.' });
  }
});

// DELETE /api/admins/:id - Delete an Admin
router.delete('/:id', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Safety checks
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const user = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    if (user.username === 'superadmin') {
      return res.status(403).json({ success: false, message: 'Primary system superadmin cannot be deleted.' });
    }

    // Never cascade-delete invitation history when an admin account is removed.
    // Accounts with invitation records must be deactivated instead so accountability remains intact.
    const cardCount = db.prepare('SELECT COUNT(*) AS count FROM invitations WHERE created_by_id = ?').get(targetId).count;
    if (cardCount > 0) {
      return res.status(409).json({
        success: false,
        message: `इस Admin के ${cardCount} invitation records मौजूद हैं। Audit history सुरक्षित रखने के लिए इस account को delete नहीं किया जा सकता; इसे Deactivate करें।`
      });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    res.json({ success: true, message: `Admin "${user.username}" deleted successfully.` });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete admin.' });
  }
});


// POST /api/admins/reset-cards - Super Admin only, password + phrase required.
// Clears invitation data and every file in uploads/, while preserving users and master settings.
router.post('/reset-cards', (req, res) => {
  try {
    const { password, confirmation } = req.body || {};
    if (!password || confirmation !== 'DELETE ALL CARDS') {
      return res.status(400).json({ success: false, message: 'Super Admin password और exact confirmation phrase आवश्यक हैं.' });
    }

    const user = db.prepare("SELECT password_hash FROM users WHERE id = ? AND role = 'superadmin' AND is_active = 1").get(req.user.id);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: 'Super Admin password गलत है.' });
    }

    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    const clearAll = db.transaction(() => {
      db.prepare('DELETE FROM invitations').run();
      db.prepare("UPDATE sqlite_sequence SET seq = 0 WHERE name = 'invitations'").run();
      db.prepare('UPDATE card_sequence SET last_number = 0 WHERE id = 1').run();
    });
    clearAll();

    let deletedFiles = 0;
    if (fs.existsSync(uploadDir)) {
      for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
        const target = path.join(uploadDir, entry.name);
        try {
          if (entry.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
          else fs.unlinkSync(target);
          deletedFiles++;
        } catch (e) {
          console.warn('Could not delete upload during reset:', target, e.message);
        }
      }
    } else {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    res.json({ success: true, message: `सभी invitation records और ${deletedFiles} upload files साफ कर दी गई हैं। Users और master settings सुरक्षित हैं।` });
  } catch (err) {
    console.error('Reset all cards error:', err);
    res.status(500).json({ success: false, message: 'सभी कार्ड डेटा साफ नहीं किया जा सका।' });
  }
});

module.exports = router;
