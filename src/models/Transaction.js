const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'game-win', 'game-loss', 'game-stake', 'referral-bonus', 'welcome-bonus', 'refund'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative'],
  },
  balanceBefore: Number,
  balanceAfter: Number,
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  },
  reference: {
    type: String,
    unique: true,
    required: true,
  },
  squadReference: String, // Squad payment gateway reference
  description: String,
  metadata: {
    gameRoomId: String,
    roomType: String,
    stakeAmount: Number,
    opponentName: String,
    bankName: String,
    accountNumber: String,
    accountName: String,
    bankCode: String,
    referredUserId: mongoose.Schema.Types.ObjectId,
  },
  failureReason: String,
  processedAt: Date,
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ reference: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
