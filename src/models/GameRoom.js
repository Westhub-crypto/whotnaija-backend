const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  suit: { type: String, enum: ['circle', 'star', 'cross', 'triangle', 'square', 'whot'], required: true },
  value: { type: Number, required: true }, // 1-14 for normal, 20 for whot
  id: String,
}, { _id: false });

const playerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: String,
  avatar: String,
  isBot: { type: Boolean, default: false },
  botName: String,
  hand: [cardSchema],
  cardCount: { type: Number, default: 0 },
  isReady: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  hasCalledLastCard: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  position: Number, // seat position
  socketId: String,
  emojisReceived: [{ emoji: String, from: String, at: Date }],
}, { _id: false });

const gameRoomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    unique: true,
    required: true,
  },
  roomType: {
    type: String,
    enum: ['1v1', '4v4'],
    required: true,
  },
  stakeAmount: {
    type: Number,
    required: true,
    enum: [500, 1000, 2000, 5000, 10000, 20000],
  },
  totalPot: {
    type: Number,
    default: 0,
  },
  platformFee: {
    type: Number,
    default: 0,
  },
  winnerPrize: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['waiting', 'matching', 'in-progress', 'completed', 'abandoned', 'cancelled'],
    default: 'waiting',
  },
  players: [playerSchema],
  maxPlayers: {
    type: Number,
    default: 2,
  },
  currentPlayerIndex: {
    type: Number,
    default: 0,
  },
  direction: {
    type: String,
    enum: ['clockwise', 'counter-clockwise'],
    default: 'clockwise',
  },
  deck: [cardSchema],
  discardPile: [cardSchema],
  topCard: cardSchema,
  calledSuit: String, // When Whot(20) is played
  gameState: {
    type: String,
    enum: ['idle', 'playing', 'market-empty', 'finished'],
    default: 'idle',
  },
  winner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    isBot: Boolean,
    winType: { type: String, enum: ['normal', 'card-count', 'timeout'] },
  },
  timer: {
    startedAt: Date,
    endsAt: Date,
    duration: { type: Number, default: 300 }, // 5 minutes in seconds
    isExpired: { type: Boolean, default: false },
  },
  chat: [{
    type: { type: String, enum: ['emoji', 'system'] },
    from: String,
    fromUserId: mongoose.Schema.Types.ObjectId,
    content: String,
    at: { type: Date, default: Date.now },
  }],
  gameHistory: [{
    action: String,
    playerId: mongoose.Schema.Types.ObjectId,
    playerName: String,
    card: cardSchema,
    calledSuit: String,
    timestamp: { type: Date, default: Date.now },
  }],
  antiCheat: {
    moveTimes: [Number],
    suspiciousPlayers: [mongoose.Schema.Types.ObjectId],
    flags: [String],
  },
  startedAt: Date,
  endedAt: Date,
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

gameRoomSchema.index({ roomId: 1 });
gameRoomSchema.index({ status: 1, roomType: 1, stakeAmount: 1 });
gameRoomSchema.index({ 'players.userId': 1 });
gameRoomSchema.index({ createdAt: -1 });

module.exports = mongoose.model('GameRoom', gameRoomSchema);
