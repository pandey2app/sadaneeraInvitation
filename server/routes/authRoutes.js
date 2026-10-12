const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { generateToken, authenticateToken } = require('../auth');
const driveService = require('../services/driveService');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const trimmedUser = username.trim().toLowerCase();
    const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(trimmedUser);

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

// POST /api/auth/logout - Terminate session
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/firebase-config - Public config for frontend Firebase Auth & Drive OAuth
router.get('/firebase-config', (req, res) => {
  const cfgPath = path.join(__dirname, '..', '..', 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return res.json({
        success: true,
        config: {
          apiKey: cfg.apiKey,
          authDomain: cfg.authDomain,
          projectId: cfg.projectId,
          storageBucket: cfg.storageBucket,
          messagingSenderId: cfg.messagingSenderId,
          appId: cfg.appId,
          oAuthClientId: cfg.oAuthClientId
        }
      });
    } catch (e) {
      console.warn('Error reading firebase-applet-config:', e.message);
    }
  }
  res.status(404).json({ success: false, message: 'Firebase configuration not found' });
});

// POST /api/auth/google-login - Login or authenticate via Google OAuth
router.post('/google-login', async (req, res) => {
  try {
    const { email, displayName, accessToken } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Google email is required.' });
    }

    if (accessToken) {
      driveService.setCachedToken(accessToken);
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user exists by email in database
    const users = await db.prepare('SELECT * FROM users').all();
    let matchedUser = users.find(u => (u.email || '').toLowerCase() === cleanEmail);

    // If owner / developer email
    if (!matchedUser && (cleanEmail === 'pandey2app@gmail.com' || cleanEmail === 'superadmin@sadaneera.org')) {
      matchedUser = {
        id: 1,
        username: 'superadmin',
        full_name: displayName || 'आदित्य प्रकाश पांडेय (Super Admin)',
        email: cleanEmail,
        role: 'superadmin',
        is_active: 1
      };
    }

    if (!matchedUser) {
      // Default fallback: allow access as admin with email
      matchedUser = {
        id: 99,
        username: cleanEmail.split('@')[0],
        full_name: displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'admin',
        is_active: 1
      };
    }

    const token = generateToken(matchedUser);
    res.json({
      success: true,
      message: 'Google Sign-In successful. Google Drive connected.',
      token,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        full_name: matchedUser.full_name,
        email: matchedUser.email,
        role: matchedUser.role
      },
      driveConnected: true
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ success: false, message: 'Failed to process Google sign-in.' });
  }
});

// POST /api/auth/google-drive-token - Store client Google Drive access token for photo uploads
router.post('/google-drive-token', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required.' });
  }

  driveService.setCachedToken(token);
  res.json({ success: true, message: 'Google Drive token synchronized successfully.' });
});

// GET /api/auth/google-drive-status - Check if active Google Drive token is cached
router.get('/google-drive-status', (req, res) => {
  const hasToken = !!driveService.getCachedToken();
  res.json({ success: true, connected: hasToken });
});

module.exports = router;
