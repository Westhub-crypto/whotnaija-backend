const express = require('express');
const router = express.Router();
const GameRoom = require('../models/GameRoom');
const { protect } = require('../middleware/auth');

// GET /api/rooms/active
router.get('/active', protect, async (req, res) => {
  try {
    const { roomType, stakeAmount } = req.query;
    const query = { status: { $in: ['waiting', 'in-progress'] } };
    if (roomType) query.roomType = roomType;
    if (stakeAmount) query.stakeAmount = parseInt(stakeAmount);

    const rooms = await GameRoom.find(query)
      .select('-deck -gameHistory -discardPile')
      .sort('-createdAt')
      .limit(20);
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rooms' });
  }
});

// GET /api/rooms/my-history
router.get('/my-history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const rooms = await GameRoom.find({
      'players.userId': req.user._id,
      status: { $in: ['completed', 'abandoned'] },
    })
      .select('-deck -gameHistory -discardPile -antiCheat')
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await GameRoom.countDocuments({ 'players.userId': req.user._id });
    res.json({ success: true, rooms, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch game history' });
  }
});

// GET /api/rooms/:roomId
router.get('/:roomId', protect, async (req, res) => {
  try {
    const room = await GameRoom.findOne({ roomId: req.params.roomId })
      .select('-deck -antiCheat');
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch room' });
  }
});

module.exports = router;
