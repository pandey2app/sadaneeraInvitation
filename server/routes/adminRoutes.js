const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    res.json({ success: true, message: `Admin "${user.username}" deleted successfully.` });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete admin.' });
  }
});

module.exports = router;
