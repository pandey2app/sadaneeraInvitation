const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken, authenticateToken } = require('../auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const trimmedUser = username.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(trimmedUser);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    if (user.is_active !== 1) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Please contact Super Admin.' });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    const token = generateToken(user);
    res.json({
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
  }
});

// GET /api/auth/me - Get current authenticated user
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      full_name: req.user.full_name,
      email: req.user.email,
      role: req.user.role
    }
  });
});


module.exports = router;
