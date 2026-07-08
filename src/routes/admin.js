const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GameRoom = require('../models/GameRoom');
const SupportTicket = require('../models/SupportTicket');
const { protect, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const adminAuth = [protect, authorize('admin', 'superadmin')];

// @route GET /api/admin/dashboard
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalDeposits,
      totalWithdrawals,
      totalGames,
      activeGames,
      openTickets,
      todayUsers,
      todayDeposits,
      todayGames,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ onlineStatus: { $in: ['online', 'in-game', 'in-queue'] } }),
      User.countDocuments({ isBanned: true }),
      Transaction.aggregate([{ $match: { type: 'deposit', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'withdrawal', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      GameRoom.countDocuments(),
      GameRoom.countDocuments({ status: 'in-progress' }),
      SupportTicket.countDocuments({ status: { $in: ['open', 'in-progress'] } }),
      User.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }, role: 'user' }),
      Transaction.aggregate([
        { $match: { type: 'deposit', status: 'completed', createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      GameRoom.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    ]);

    // Platform revenue (10% of all stakes)
    const revenueData = await Transaction.aggregate([
      { $match: { type: 'game-stake', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const platformRevenue = (revenueData[0]?.total || 0) * 0.1;

    // Weekly revenue chart
    const weeklyRevenue = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'completed', createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers, banned: bannedUsers, today: todayUsers },
        finance: {
          totalDeposits: totalDeposits[0]?.total || 0,
          totalWithdrawals: totalWithdrawals[0]?.total || 0,
          platformRevenue,
          todayDeposits: todayDeposits[0]?.total || 0,
        },
        games: { total: totalGames, active: activeGames, today: todayGames },
        support: { openTickets },
        weeklyRevenue,
      },
    });
  } catch (err) {
    logger.error('Admin dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard data' });
  }
});

// @route GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, sort = '-createdAt' } = req.query;
    const query = { role: 'user' };

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (status === 'banned') query.isBanned = true;
    if (status === 'active') query.isBanned = false;
    if (status === 'unverified') query.isVerified = false;

    const users = await User.find(query)
      .select('-password -emailVerificationToken -passwordResetToken')
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({ success: true, users, total, pages: Math.ceil(total / parseInt(limit)), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// @route PATCH /api/admin/users/:id/ban
router.patch('/users/:id/ban', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, {
      isBanned: true,
      banReason: reason || 'Violation of terms of service',
    }, { new: true });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    logger.info(`Admin ${req.user.username} banned user ${user.username}`);
    res.json({ success: true, message: 'User banned successfully', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to ban user' });
  }
});

// @route PATCH /api/admin/users/:id/unban
router.patch('/users/:id/unban', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, {
      isBanned: false,
      banReason: null,
    }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User unbanned successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unban user' });
  }
});

// @route POST /api/admin/users/:id/adjust-balance
router.post('/users/:id/adjust-balance', [protect, authorize('superadmin')], async (req, res) => {
  try {
    const { amount, type, reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const adjustment = type === 'credit' ? Math.abs(amount) : -Math.abs(amount);
    await User.findByIdAndUpdate(req.params.id, { $inc: { 'wallet.balance': adjustment } });

    await Transaction.create({
      userId: req.params.id,
      type: 'refund',
      amount: Math.abs(amount),
      status: 'completed',
      reference: `admin_adj_${Date.now()}`,
      description: `Admin balance adjustment: ${reason}`,
    });

    logger.info(`Admin ${req.user.username} adjusted balance for ${user.username}: ${type} ₦${amount}`);
    res.json({ success: true, message: 'Balance adjusted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to adjust balance' });
  }
});

// @route GET /api/admin/transactions
router.get('/transactions', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, search } = req.query;
    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (search) query.reference = { $regex: search, $options: 'i' };

    const transactions = await Transaction.find(query)
      .populate('userId', 'username email firstName lastName')
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Transaction.countDocuments(query);
    res.json({ success: true, transactions, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// @route GET /api/admin/games
router.get('/games', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;

    const games = await GameRoom.find(query)
      .select('-deck -gameHistory -antiCheat')
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await GameRoom.countDocuments(query);
    res.json({ success: true, games, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch games' });
  }
});

// @route GET /api/admin/support
router.get('/support', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;

    const tickets = await SupportTicket.find(query)
      .populate('userId', 'username email firstName lastName')
      .sort('-lastActivityAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await SupportTicket.countDocuments(query);
    res.json({ success: true, tickets, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tickets' });
  }
});

// @route POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (email !== adminEmail || password !== adminPassword) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);
      admin = await User.create({
        firstName: 'WhotNaija',
        lastName: 'Admin',
        username: process.env.ADMIN_USERNAME || 'whotnaija_admin',
        email: adminEmail,
        phone: '+2348000000000',
        state: 'Lagos',
        lga: 'Lagos Island',
        password: adminPassword,
        role: 'superadmin',
        isVerified: true,
      });
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '12h' });

    res.json({ success: true, token, admin: { id: admin._id, username: admin.username, role: admin.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Admin login failed' });
  }
});

// @route GET /api/admin/anti-cheat/flags
router.get('/anti-cheat/flags', adminAuth, async (req, res) => {
  try {
    const flaggedUsers = await User.find({
      $or: [
        { 'antiCheat.suspiciousActivityCount': { $gt: 3 } },
        { 'antiCheat.riskScore': { $gt: 70 } },
      ],
    }).select('username email antiCheat gameStats createdAt');

    res.json({ success: true, flaggedUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch flagged users' });
  }
});

module.exports = router;
