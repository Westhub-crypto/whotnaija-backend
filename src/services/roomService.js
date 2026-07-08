// roomService.js
const GameRoom = require('../models/GameRoom');
const User = require('../models/User');
const logger = require('../utils/logger');

async function cleanupAbandonedRooms() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
  const abandonedRooms = await GameRoom.find({
    status: 'in-progress',
    'timer.endsAt': { $lt: new Date() },
  });

  for (const room of abandonedRooms) {
    await GameRoom.findByIdAndUpdate(room._id, { status: 'abandoned' });
    for (const player of room.players) {
      if (!player.isBot && player.userId) {
        await User.findByIdAndUpdate(player.userId, { onlineStatus: 'online' });
      }
    }
    logger.info(`Cleaned up abandoned room: ${room.roomId}`);
  }
}

module.exports = { cleanupAbandonedRooms };
  
