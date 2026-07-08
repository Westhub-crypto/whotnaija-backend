// referral.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('referral.referrals', 'username firstName createdAt wallet.hasDeposited');
    res.json({
      success: true,
      referralCode: user.referral.code,
      referralLink: `${process.env.CLIENT_URL}/register?ref=${user.referral.code}`,
      totalReferrals: user.referral.referrals.length,
      totalEarned: user.referral.totalEarned,
      referrals: user.referral.referrals,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch referral stats' });
  }
});

module.exports = router;
