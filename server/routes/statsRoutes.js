const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

router.use(authenticateToken);

// GET /api/stats/dashboard
// Dashboard activity is intentionally visible to every authenticated admin.
router.get('/dashboard', (req, res) => {
  try {
    const totalCards = db.prepare('SELECT COUNT(*) AS count FROM invitations').get().count;
    const todayCards = db.prepare(`
      SELECT COUNT(*) AS count
      FROM invitations
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `).get().count;

    const totalAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('admin','superadmin') AND is_active = 1").get().count;
    const myCards = db.prepare('SELECT COUNT(*) AS count FROM invitations WHERE created_by_id = ?').get(req.user.id).count;

    // Keep dashboard recent activity compact: maximum 10 records.
    const recentCards = db.prepare(`
      SELECT id, card_code, title, guest_name, photo_url, created_by_name, created_at, theme, is_deleted,
             deleted_by_name, deleted_at
      FROM invitations
      ORDER BY id DESC
      LIMIT 10
    `).all();

    // All admins are included. Counts are lifetime counts; deleted cards remain
    // part of accountability totals because soft-deleted records are retained.
    const adminActivity = db.prepare(`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.created_at AS admin_created_at,
        COUNT(i.id) AS total_cards,
        SUM(CASE WHEN COALESCE(i.is_deleted, 0) = 1 THEN 1 ELSE 0 END) AS deleted_cards,
        SUM(CASE WHEN i.id IS NOT NULL AND COALESCE(i.is_deleted, 0) = 0 THEN 1 ELSE 0 END) AS active_cards,
        SUM(CASE WHEN i.id IS NOT NULL AND DATE(i.created_at) = DATE('now', 'localtime') THEN 1 ELSE 0 END) AS today_cards,
        (SELECT COUNT(*) FROM invitations d WHERE d.deleted_by_id = u.id) AS deleted_actions,
        (SELECT COUNT(*) FROM invitations d WHERE d.deleted_by_id = u.id AND DATE(d.deleted_at) = DATE('now', 'localtime')) AS today_deleted_actions
      FROM users u
      LEFT JOIN invitations i ON i.created_by_id = u.id
      WHERE u.role IN ('admin', 'superadmin')
      GROUP BY u.id
      ORDER BY total_cards DESC, u.created_at ASC
    `).all();

    const lifetimeTotal = adminActivity.reduce((sum, a) => sum + Number(a.total_cards || 0), 0);
    const todayTotal = adminActivity.reduce((sum, a) => sum + Number(a.today_cards || 0), 0);

    const withPercentages = adminActivity.map(a => ({
      ...a,
      total_cards: Number(a.total_cards || 0),
      deleted_cards: Number(a.deleted_cards || 0),
      active_cards: Number(a.active_cards || 0),
      today_cards: Number(a.today_cards || 0),
      deleted_actions: Number(a.deleted_actions || 0),
      today_deleted_actions: Number(a.today_deleted_actions || 0),
      lifetime_percentage: lifetimeTotal ? Number(((Number(a.total_cards || 0) / lifetimeTotal) * 100).toFixed(1)) : 0,
      today_percentage: todayTotal ? Number(((Number(a.today_cards || 0) / todayTotal) * 100).toFixed(1)) : 0
    }));

    res.json({
      success: true,
      stats: {
        totalCards,
        todayCards,
        totalAdmins,
        myCards,
        recentCards,
        adminActivity: withPercentages,
        lifetimeTotal,
        todayTotal
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve statistics.' });
  }
});

module.exports = router;
