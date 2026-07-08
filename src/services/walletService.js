// walletService.js
const User = require('../models/User');
const Transaction = require('../models/Transaction');

async function processGameResult(room, winner) {
  try {
    if (!winner.isBot && winner.userId) {
      // Credit winner
      await User.findByIdAndUpdate(winner.userId, {
        $inc: { 'wallet.balance': room.winnerPrize, 'wallet.totalWon': room.winnerPrize },
      });

      await Transaction.create({
        userId: winner.userId,
        type: 'game-win',
        amount: room.winnerPrize,
        status: 'completed',
        reference: `win_${room.roomId}_${Date.now()}`,
        description: `Game winnings from room ${room.roomId} (${room.roomType} - ₦${room.stakeAmount} stake)`,
        metadata: { gameRoomId: room.roomId, roomType: room.roomType, stakeAmount: room.stakeAmount },
      });
    }
    // Platform fee is already deducted (winner gets pot - 10%)
  } catch (err) {
    console.error('processGameResult error:', err);
  }
}

module.exports = { processGameResult };
