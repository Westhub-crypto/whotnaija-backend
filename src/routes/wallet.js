const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

// GET /api/wallet/balance
router.get('/balance', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet bankDetails');
    res.json({
      success: true,
      balance: user.wallet.balance,
      bonusBalance: user.wallet.hasDeposited ? user.wallet.bonusBalance : 0,
      totalBalance: user.getAvailableBalance ? user.getAvailableBalance() : user.wallet.balance,
      hasDeposited: user.wallet.hasDeposited,
      totalDeposited: user.wallet.totalDeposited,
      totalWithdrawn: user.wallet.totalWithdrawn,
      totalWon: user.wallet.totalWon,
      totalLost: user.wallet.totalLost,
      bankDetails: user.bankDetails,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch balance' });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const query = { userId: req.user._id };
    if (type) query.type = type;

    const transactions = await Transaction.find(query)
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Transaction.countDocuments(query);
    res.json({ success: true, transactions, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

module.exports = router;
