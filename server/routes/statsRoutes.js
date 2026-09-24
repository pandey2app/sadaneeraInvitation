const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

router.use(authenticateToken);

// GET /api/stats/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const isSuper = req.user.role === 'superadmin';

    // Total cards count
    const totalCards = db.prepare('SELECT COUNT(*) AS count FROM invitations').get().count;

    // Today's cards count
    const todayCards = db.prepare(`
      SELECT COUNT(*) AS count 
      FROM invitations 
      WHERE DATE(created_at) = DATE('now')
    `).get().count;

    // Total admins count
    const totalAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;

    // My cards count
    const myCards = db.prepare('SELECT COUNT(*) AS count FROM invitations WHERE created_by_id = ?').get(req.user.id).count;

    // Recent 5 cards
    const recentCards = db.prepare(`
      SELECT id, card_code, title, guest_name, photo_url, created_by_name, created_at, theme
      FROM invitations
      ORDER BY id DESC
      LIMIT 5
    `).all();

    // Top contributing admins (for superadmin)
    let adminLeaderboard = [];
    if (isSuper) {
      adminLeaderboard = db.prepare(`
        SELECT u.id, u.full_name, u.username, u.role, COUNT(i.id) AS total_cards
        FROM users u
        LEFT JOIN invitations i ON i.created_by_id = u.id
        GROUP BY u.id
        ORDER BY total_cards DESC
      `).all();
    }

    res.json({
      success: true,
      stats: {
        totalCards,
        todayCards,
        totalAdmins,
        myCards,
        recentCards,
        adminLeaderboard
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve statistics.' });
  }
});

module.exports = router;
