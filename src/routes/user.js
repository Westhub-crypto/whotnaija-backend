// user.js route
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -emailVerificationToken -passwordResetToken -antiCheat');
    const transactions = await Transaction.find({ userId: req.user._id })
      .sort('-createdAt').limit(10);
    const gameStats = user.gameStats;
    res.json({ success: true, user, transactions, gameStats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

router.patch('/profile', protect, async (req, res) => {
  try {
    const allowed = ['firstName', 'lastName', 'middleName', 'phone'];
    const updates = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true })
      .select('-password');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to change password' });
  }
});

router.post('/bank-details', protect, async (req, res) => {
  try {
    const { accountName, accountNumber, bankName, bankCode } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      bankDetails: { accountName, accountNumber, bankName, bankCode, isVerified: true },
    });
    res.json({ success: true, message: 'Bank details saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save bank details' });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const leaders = await User.find({ role: 'user', 'gameStats.totalGames': { $gte: 5 } })
      .select('username firstName avatar gameStats.wins gameStats.totalGames gameStats.winStreak')
      .sort({ 'gameStats.wins': -1 })
      .limit(20);
    res.json({ success: true, leaders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
