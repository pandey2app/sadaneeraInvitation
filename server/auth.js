const jwt = require('jsonwebtoken');
const db = require('./db');

// Multi-secret verification ensures seamless persistence across server restarts/deployments
const KNOWN_SECRETS = [
  process.env.JWT_SECRET,
  'aditya@sadaneera',
  'sadaneera-mahotsav-secret-token-key-2026'
].filter(Boolean);

const PRIMARY_SECRET = KNOWN_SECRETS[0] || 'sadaneera-mahotsav-secret-token-key-2026';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    },
    PRIMARY_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  for (const secret of KNOWN_SECRETS) {
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded && decoded.id) {
        return { decoded, err: null };
      }
    } catch (e) {
      // Continue checking fallback secrets
    }
  }
  return { decoded: null, err: new Error('Invalid or expired token') };
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  const { decoded, err } = verifyToken(token);
  if (err || !decoded) {
    return res.status(401).json({ success: false, message: 'Session expired or invalid token. Please log in again.' });
  }

  try {
    // Verify user still exists and is active
    const user = await db.prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.is_active !== 1) {
      return res.status(403).json({ success: false, message: 'User account is deactivated or no longer exists.' });
    }

    req.user = user;
    next();
  } catch (dbErr) {
    console.error('Error verifying user in authenticateToken:', dbErr);
    return res.status(500).json({ success: false, message: 'Authentication verification error.' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Only Super Admin has permission to perform this action.'
    });
  }
  next();
}

module.exports = {
  generateToken,
  authenticateToken,
  requireSuperAdmin
};
