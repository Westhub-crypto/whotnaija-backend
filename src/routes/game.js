// game.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');

router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('gameStats');
    res.json({ success: true, stats: user.gameStats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch game stats' });
  }
});

module.exports = router;
