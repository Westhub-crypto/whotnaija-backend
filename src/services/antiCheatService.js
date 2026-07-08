const User = require('../models/User');
const logger = require('../utils/logger');

const SUSPICIOUS_THRESHOLDS = {
  MIN_MOVE_TIME_MS: 200, // Moves faster than 200ms = suspicious
  MAX_WIN_RATE: 0.95,    // >95% win rate = suspicious
  MAX_RAPID_MOVES: 10,   // More than 10 moves in 5 seconds = suspicious
};

async function detectCheating(userId, moveTime, engine, room) {
  try {
    const user = await User.findById(userId).select('gameStats antiCheat');
    if (!user) return;

    const flags = [];
    let riskIncrease = 0;

    // 1. Check move speed (too fast = bot/script)
    const lastMoveTime = engine.lastMoveTime || (Date.now() - 5000);
    const timeSinceLastMove = moveTime - lastMoveTime;
    engine.lastMoveTime = moveTime;

    if (timeSinceLastMove < SUSPICIOUS_THRESHOLDS.MIN_MOVE_TIME_MS) {
      flags.push(`Abnormally fast move: ${timeSinceLastMove}ms`);
      riskIncrease += 10;
    }

    // 2. Track move times for pattern analysis
    if (!engine.moveTimes) engine.moveTimes = [];
    engine.moveTimes.push(timeSinceLastMove);

    // Check for rapid consecutive moves
    const recentMoves = engine.moveTimes.slice(-10);
    if (recentMoves.length === 10) {
      const avgTime = recentMoves.reduce((a, b) => a + b, 0) / recentMoves.length;
      if (avgTime < 300) {
        flags.push(`Suspicious average move time: ${avgTime.toFixed(0)}ms`);
        riskIncrease += 15;
      }
    }

    // 3. Win rate check
    const totalGames = user.gameStats.totalGames;
    if (totalGames > 20) {
      const winRate = user.gameStats.wins / totalGames;
      if (winRate > SUSPICIOUS_THRESHOLDS.MAX_WIN_RATE) {
        flags.push(`Suspicious win rate: ${(winRate * 100).toFixed(1)}%`);
        riskIncrease += 20;
      }
    }

    if (flags.length > 0) {
      await User.findByIdAndUpdate(userId, {
        $inc: {
          'antiCheat.suspiciousActivityCount': 1,
          'antiCheat.riskScore': riskIncrease,
        },
        $push: { 'antiCheat.flags': { $each: flags } },
        $set: { 'antiCheat.lastFlaggedAt': new Date() },
      });

      // Auto-ban if risk score too high
      const updatedUser = await User.findById(userId).select('antiCheat');
      if (updatedUser.antiCheat.riskScore >= 100) {
        await User.findByIdAndUpdate(userId, {
          isBanned: true,
          banReason: 'Automatic ban: Cheating detected by anti-cheat system',
        });
        logger.warn(`Auto-banned user ${userId} for cheating. Risk score: ${updatedUser.antiCheat.riskScore}`);
      }

      logger.warn(`Suspicious activity detected for user ${userId}:`, flags);
    }
  } catch (err) {
    logger.error('Anti-cheat error:', err.message);
  }
}

module.exports = { detectCheating };
