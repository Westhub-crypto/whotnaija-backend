const jwt = require('jsonwebtoken');
const User = require('../models/User');
const GameRoom = require('../models/GameRoom');
const { WhotGameEngine } = require('../services/gameEngine');
const { createBot, getBotMove, getBotCalledSuit, getBotEmoji, getBotThinkTime, BOT_DIFFICULTY } = require('../bots/botAI');
const { processGameResult } = require('../services/walletService');
const { detectCheating } = require('../services/antiCheatService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// In-memory game engines (keyed by roomId)
const activeGames = new Map();
// Matchmaking queues
const matchmakingQueues = new Map(); // key: `${stakeAmount}_${roomType}`

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 10;

function initializeSocket(io) {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');

      if (!user || !user.isActive || user.isBanned) {
        return next(new Error('Access denied'));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    logger.info(`Socket connected: ${user.username} (${socket.id})`);

    // Update user online status
    await User.findByIdAndUpdate(user._id, {
      onlineStatus: 'online',
      socketId: socket.id,
      lastActive: new Date(),
    });

    // Join personal room for direct messages
    socket.join(`user:${user._id}`);

    // Emit online count
    const onlineCount = await User.countDocuments({ onlineStatus: { $in: ['online', 'in-game', 'in-queue'] } });
    io.emit('onlineCount', onlineCount);

    // ==================== MATCHMAKING ====================

    socket.on('joinMatchmaking', async (data) => {
      try {
        const { stakeAmount, roomType } = data;
        const validStakes = [500, 1000, 2000, 5000, 10000, 20000];
        const validRoomTypes = ['1v1', '4v4'];

        if (!validStakes.includes(stakeAmount) || !validRoomTypes.includes(roomType)) {
          return socket.emit('error', { message: 'Invalid room configuration' });
        }

        // Check user balance
        const freshUser = await User.findById(user._id);
        const availableBalance = freshUser.getAvailableBalance();
        if (availableBalance < stakeAmount) {
          return socket.emit('error', { message: 'Insufficient balance to join this room' });
        }

        // Check if already in queue or game
        if (['in-queue', 'in-game'].includes(freshUser.onlineStatus)) {
          return socket.emit('error', { message: 'You are already in a queue or game' });
        }

        const queueKey = `${stakeAmount}_${roomType}`;
        const maxPlayers = roomType === '1v1' ? 2 : 4;

        // Add to queue
        if (!matchmakingQueues.has(queueKey)) {
          matchmakingQueues.set(queueKey, []);
        }

        const queue = matchmakingQueues.get(queueKey);
        const existingEntry = queue.find(e => e.userId.toString() === user._id.toString());
        if (!existingEntry) {
          queue.push({
            userId: user._id,
            username: user.username,
            socketId: socket.id,
            avatar: user.avatar,
            assistedWinsRemaining: freshUser.gameStats?.assistedWinsRemaining || 0,
          });
        }

        await User.findByIdAndUpdate(user._id, { onlineStatus: 'in-queue' });
        socket.emit('matchmakingStatus', { status: 'searching', message: 'Looking for opponents...' });

        // Start bot timer (10 seconds if no match found)
        const botTimer = setTimeout(async () => {
          const currentQueue = matchmakingQueues.get(queueKey) || [];
          const stillInQueue = currentQueue.find(e => e.userId.toString() === user._id.toString());
          if (stillInQueue) {
            await startGameWithBots(io, queueKey, stakeAmount, roomType, maxPlayers, currentQueue);
          }
        }, 10000);

        socket.botTimer = botTimer;

        // Check if enough real players to start
        if (queue.length >= maxPlayers) {
          clearTimeout(botTimer);
          await startMatchedGame(io, queueKey, stakeAmount, roomType, maxPlayers, queue);
        }

      } catch (err) {
        logger.error('joinMatchmaking error:', err);
        socket.emit('error', { message: 'Failed to join matchmaking' });
      }
    });

    socket.on('leaveMatchmaking', async (data) => {
      const { stakeAmount, roomType } = data || {};
      if (stakeAmount && roomType) {
        const queueKey = `${stakeAmount}_${roomType}`;
        const queue = matchmakingQueues.get(queueKey) || [];
        const filtered = queue.filter(e => e.userId.toString() !== user._id.toString());
        matchmakingQueues.set(queueKey, filtered);
      }
      if (socket.botTimer) clearTimeout(socket.botTimer);
      await User.findByIdAndUpdate(user._id, { onlineStatus: 'online' });
      socket.emit('matchmakingStatus', { status: 'left' });
    });

    // ==================== GAME EVENTS ====================

    socket.on('joinGameRoom', async ({ roomId }) => {
      try {
        const room = await GameRoom.findOne({ roomId });
        if (!room) return socket.emit('error', { message: 'Room not found' });

        const isPlayer = room.players.some(p =>
          p.userId?.toString() === user._id.toString()
        );
        if (!isPlayer) return socket.emit('error', { message: 'Not authorized to join this room' });

        socket.join(`game:${roomId}`);

        const engine = activeGames.get(roomId);
        if (engine) {
          const playerState = engine.getPlayerState(user._id.toString());
          socket.emit('gameState', playerState);
        }
      } catch (err) {
        logger.error('joinGameRoom error:', err);
      }
    });

    socket.on('playCard', async ({ roomId, card, calledSuit }) => {
      try {
        const engine = activeGames.get(roomId);
        if (!engine) return socket.emit('error', { message: 'Game not found' });

        const room = await GameRoom.findOne({ roomId });
        if (!room || room.status !== 'in-progress') {
          return socket.emit('error', { message: 'Game is not active' });
        }

        // Anti-cheat: track move time
        const moveTime = Date.now();
        await detectCheating(user._id, moveTime, engine, room);

        const result = engine.playCard(user._id.toString(), card, calledSuit);

        if (!result.success) {
          return socket.emit('error', { message: result.error });
        }

        // Update DB game state
        await syncGameStateToDb(roomId, engine, room);

        // Broadcast to all players in room
        const gameState = engine.getGameState();
        io.to(`game:${roomId}`).emit('cardPlayed', {
          playerId: user._id,
          playerName: user.username,
          card: result.card,
          effect: result.effect,
          defended: result.defended,
          gameState,
        });

        // Voice announcement
        if (result.effect?.voiceAnnouncement) {
          io.to(`game:${roomId}`).emit('voiceAnnouncement', {
            text: result.effect.voiceAnnouncement,
            type: result.effect.type,
            triggeredBy: user.username,
          });
        }

        // Send each player their hand
        await broadcastPlayerHands(io, engine, room);

        // Check win
        if (result.winner) {
          await handleGameWin(io, roomId, result.winner, result.winType, engine, room);
          return;
        }

        // Bot turn if needed
        await handleBotTurns(io, roomId, engine, room);

      } catch (err) {
        logger.error('playCard error:', err);
        socket.emit('error', { message: 'Failed to play card' });
      }
    });

    socket.on('pickFromMarket', async ({ roomId }) => {
      try {
        const engine = activeGames.get(roomId);
        if (!engine) return socket.emit('error', { message: 'Game not found' });

        const result = engine.playerPickFromMarket(user._id.toString());

        if (!result.success) {
          if (result.marketEmpty) {
            await handleMarketEmpty(io, roomId, engine);
          }
          return;
        }

        const gameState = engine.getGameState();
        io.to(`game:${roomId}`).emit('marketPick', {
          playerId: user._id,
          playerName: user.username,
          cardCount: result.pickedCards?.length || 1,
          gameState,
        });

        if (result.defended && result.voiceAnnouncement) {
          io.to(`game:${roomId}`).emit('voiceAnnouncement', { text: result.voiceAnnouncement });
        }

        await broadcastPlayerHands(io, engine, await GameRoom.findOne({ roomId }));
        await handleBotTurns(io, roomId, engine, await GameRoom.findOne({ roomId }));

      } catch (err) {
        logger.error('pickFromMarket error:', err);
      }
    });

    socket.on('callLastCard', async ({ roomId }) => {
      try {
        const engine = activeGames.get(roomId);
        if (!engine) return;

        const result = engine.callLastCard(user._id.toString());
        if (result.success) {
          io.to(`game:${roomId}`).emit('lastCardCalled', {
            playerId: user._id,
            playerName: user.username,
            voiceAnnouncement: result.voiceAnnouncement,
          });
        }
      } catch (err) {
        logger.error('callLastCard error:', err);
      }
    });

    // ==================== CHAT & EMOJIS ====================

    socket.on('sendEmoji', async ({ roomId, emoji }) => {
      try {
        const allowedEmojis = ['😂', '😎', '🔥', '💪', '🤣', '😏', '👑', '💯', '⚡', '🎯',
          '😅', '🤔', '😤', '🥳', '💀', '🎉', '👏', '😈', '🃏', '✌️'];

        if (!allowedEmojis.includes(emoji)) return;

        io.to(`game:${roomId}`).emit('emojiReceived', {
          from: user.username,
          fromId: user._id,
          emoji,
          at: new Date(),
        });

        // Save to DB
        await GameRoom.findOneAndUpdate(
          { roomId },
          { $push: { chat: { type: 'emoji', from: user.username, fromUserId: user._id, content: emoji } } }
        );
      } catch (err) {
        logger.error('sendEmoji error:', err);
      }
    });

    // ==================== SUPPORT LIVE CHAT ====================

    socket.on('joinSupportRoom', ({ ticketId }) => {
      socket.join(`support:${ticketId}`);
    });

    socket.on('supportMessage', async ({ ticketId, message }) => {
      try {
        const SupportTicket = require('../models/SupportTicket');
        const ticket = await SupportTicket.findOne({ ticketId });
        if (!ticket) return;

        const msgObj = {
          sender: user.role === 'admin' || user.role === 'superadmin' ? 'admin' : 'user',
          senderId: user._id,
          senderName: user.username,
          content: message.substring(0, 2000),
          createdAt: new Date(),
        };

        ticket.messages.push(msgObj);
        ticket.lastActivityAt = new Date();
        if (ticket.status === 'open') ticket.status = 'in-progress';
        await ticket.save();

        io.to(`support:${ticketId}`).emit('newSupportMessage', msgObj);
      } catch (err) {
        logger.error('supportMessage error:', err);
      }
    });

    // ==================== DISCONNECT ====================

    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${user.username}`);

      // Remove from queues
      matchmakingQueues.forEach((queue, key) => {
        const filtered = queue.filter(e => e.userId.toString() !== user._id.toString());
        matchmakingQueues.set(key, filtered);
      });

      if (socket.botTimer) clearTimeout(socket.botTimer);

      await User.findByIdAndUpdate(user._id, {
        onlineStatus: 'offline',
        lastActive: new Date(),
      });

      const onlineCount = await User.countDocuments({ onlineStatus: { $in: ['online', 'in-game', 'in-queue'] } });
      io.emit('onlineCount', onlineCount);
    });
  });

  return io;
}

// ==================== HELPER FUNCTIONS ====================

async function startMatchedGame(io, queueKey, stakeAmount, roomType, maxPlayers, queue) {
  const players = queue.splice(0, maxPlayers);
  matchmakingQueues.set(queueKey, queue);

  const roomId = `room_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const totalPot = stakeAmount * maxPlayers;
  const platformFee = totalPot * (PLATFORM_FEE_PERCENT / 100);
  const winnerPrize = totalPot - platformFee;

  const roomPlayers = players.map((p, idx) => ({
    userId: p.userId,
    username: p.username,
    avatar: p.avatar,
    isBot: false,
    hand: [],
    isReady: true,
    isActive: true,
    hasCalledLastCard: false,
    position: idx,
    socketId: p.socketId,
  }));

  const engine = new WhotGameEngine();
  const gameState = engine.initGame(roomPlayers.map(p => ({ ...p })));

  // Sync engine players with hands
  engine.players.forEach((ep, idx) => {
    roomPlayers[idx].hand = ep.hand;
    roomPlayers[idx].cardCount = ep.hand.length;
  });

  const room = await GameRoom.create({
    roomId,
    roomType,
    stakeAmount,
    totalPot,
    platformFee,
    winnerPrize,
    status: 'in-progress',
    players: roomPlayers,
    maxPlayers,
    topCard: engine.topCard,
    timer: {
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 5 * 60 * 1000),
      duration: 300,
    },
    startedAt: new Date(),
  });

  activeGames.set(roomId, engine);

  // Deduct stakes from wallets
  for (const player of players) {
    await deductStake(player.userId, stakeAmount, roomId);
    await User.findByIdAndUpdate(player.userId, { onlineStatus: 'in-game' });
  }

  // Notify players
  for (const player of players) {
    io.to(player.socketId).emit('matchFound', {
      roomId,
      players: roomPlayers.map(p => ({ username: p.username, avatar: p.avatar })),
    });
  }

  // Set 5-min game timer
  setTimeout(async () => {
    await handleGameTimeout(io, roomId, engine);
  }, 5 * 60 * 1000);
}

async function startGameWithBots(io, queueKey, stakeAmount, roomType, maxPlayers, queue) {
  const realPlayers = queue.splice(0, queue.length);
  matchmakingQueues.set(queueKey, []);

  // If any real player still has assisted wins remaining (new user perk),
  // fill the table with easier bots to give them a fairer shot at an early win.
  const hasAssistedPlayer = realPlayers.some(p => (p.assistedWinsRemaining || 0) > 0);
  const botDifficulty = hasAssistedPlayer ? BOT_DIFFICULTY.EASY : BOT_DIFFICULTY.EXPERT;

  const botsNeeded = maxPlayers - realPlayers.length;
  const bots = [];
  for (let i = 0; i < botsNeeded; i++) {
    bots.push(createBot(botDifficulty));
  }

  const roomId = `room_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const totalPot = stakeAmount * maxPlayers;
  const platformFee = totalPot * (PLATFORM_FEE_PERCENT / 100);
  const winnerPrize = totalPot - platformFee;

  const allPlayers = [
    ...realPlayers.map((p, idx) => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      isBot: false,
      hand: [],
      isReady: true,
      isActive: true,
      hasCalledLastCard: false,
      position: idx,
      socketId: p.socketId,
    })),
    ...bots.map((b, idx) => ({
      userId: null,
      username: b.username,
      botName: b.botName,
      avatar: null,
      isBot: true,
      hand: [],
      isReady: true,
      isActive: true,
      hasCalledLastCard: false,
      position: realPlayers.length + idx,
      socketId: null,
      difficulty: b.difficulty,
      personality: b.personality,
    })),
  ];

  const engine = new WhotGameEngine();
  engine.initGame(allPlayers.map(p => ({ ...p })));

  engine.players.forEach((ep, idx) => {
    if (allPlayers[idx]) {
      allPlayers[idx].hand = ep.hand;
      allPlayers[idx].cardCount = ep.hand.length;
    }
  });

  // Sync bot hands to engine players
  engine.players.forEach((ep, idx) => {
    if (allPlayers[idx]?.isBot) {
      const bot = bots.find(b => b.username === ep.username);
      if (bot) bot.hand = ep.hand;
    }
  });

  const room = await GameRoom.create({
    roomId,
    roomType,
    stakeAmount,
    totalPot,
    platformFee,
    winnerPrize,
    status: 'in-progress',
    players: allPlayers,
    maxPlayers,
    topCard: engine.topCard,
    timer: {
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 5 * 60 * 1000),
      duration: 300,
    },
    startedAt: new Date(),
  });

  activeGames.set(roomId, engine);

  // Deduct stakes only from real players
  for (const player of realPlayers) {
    await deductStake(player.userId, stakeAmount, roomId);
    await User.findByIdAndUpdate(player.userId, { onlineStatus: 'in-game' });

    io.to(player.socketId).emit('matchFound', {
      roomId,
      players: allPlayers.map(p => ({ username: p.username || p.botName, isBot: p.isBot })),
      hasBot: true,
    });
  }

  // Set 5-min timeout
  setTimeout(async () => {
    await handleGameTimeout(io, roomId, engine);
  }, 5 * 60 * 1000);

  // Trigger bot move if bot goes first
  await handleBotTurns(io, roomId, engine, room);
}

async function handleBotTurns(io, roomId, engine, room) {
  if (engine.gameState === 'finished') return;

  const currentPlayer = engine.players[engine.currentPlayerIndex];
  if (!currentPlayer?.isBot) return;

  const thinkTime = getBotThinkTime(currentPlayer.difficulty || 'expert', currentPlayer.hand?.length || 5);

  setTimeout(async () => {
    try {
      const freshEngine = activeGames.get(roomId);
      if (!freshEngine || freshEngine.gameState === 'finished') return;

      const freshCurrentPlayer = freshEngine.players[freshEngine.currentPlayerIndex];
      if (!freshCurrentPlayer?.isBot) return;

      const botId = freshCurrentPlayer.botName || freshCurrentPlayer.username;
      const validMoves = freshEngine.getValidMoves(botId);

      let result;
      if (validMoves.length === 0) {
        // Bot must pick from market
        result = freshEngine.playerPickFromMarket(botId);
        if (result.success) {
          io.to(`game:${roomId}`).emit('marketPick', {
            playerId: null,
            playerName: freshCurrentPlayer.botName,
            isBot: true,
            cardCount: result.pickedCards?.length || 1,
            gameState: freshEngine.getGameState(),
          });
          if (result.defended && result.voiceAnnouncement) {
            io.to(`game:${roomId}`).emit('voiceAnnouncement', { text: result.voiceAnnouncement });
          }
        }
        if (result.marketEmpty) {
          await handleMarketEmpty(io, roomId, freshEngine);
          return;
        }
      } else {
        const cardToPlay = getBotMove(
          { hand: freshCurrentPlayer.hand, ...freshCurrentPlayer },
          { topCard: freshEngine.topCard, calledSuit: freshEngine.calledSuit, pendingPickCount: freshEngine.pendingPickCount, pendingPickType: freshEngine.pendingPickType },
          freshCurrentPlayer.difficulty || BOT_DIFFICULTY.EXPERT
        );

        let calledSuit = null;
        if (cardToPlay?.value === 20) {
          calledSuit = getBotCalledSuit(freshCurrentPlayer);
        }

        result = freshEngine.playCard(botId, cardToPlay, calledSuit);

        if (result.success) {
          const gameState = freshEngine.getGameState();
          io.to(`game:${roomId}`).emit('cardPlayed', {
            playerId: null,
            playerName: freshCurrentPlayer.botName,
            isBot: true,
            card: result.card,
            effect: result.effect,
            defended: result.defended,
            calledSuit,
            gameState,
          });

          if (result.effect?.voiceAnnouncement) {
            io.to(`game:${roomId}`).emit('voiceAnnouncement', {
              text: result.effect.voiceAnnouncement,
              type: result.effect.type,
              triggeredBy: freshCurrentPlayer.botName,
            });
          }

          // Bot emoji reaction
          const emoji = getBotEmoji(freshCurrentPlayer, result.effect?.type === 'pick2' ? 'pick2_played' : 'random');
          if (emoji) {
            setTimeout(() => {
              io.to(`game:${roomId}`).emit('emojiReceived', {
                from: freshCurrentPlayer.botName,
                fromId: null,
                isBot: true,
                emoji,
                at: new Date(),
              });
            }, 800);
          }

          if (result.winner) {
            await handleGameWin(io, roomId, result.winner, result.winType, freshEngine, await GameRoom.findOne({ roomId }));
            return;
          }

          if (freshCurrentPlayer.hand.length === 1) {
            freshCurrentPlayer.hasCalledLastCard = true;
            io.to(`game:${roomId}`).emit('lastCardCalled', {
              playerId: null,
              playerName: freshCurrentPlayer.botName,
              isBot: true,
              voiceAnnouncement: 'Last Card!',
            });
          }
        }
      }

      await broadcastPlayerHands(io, freshEngine, await GameRoom.findOne({ roomId }));

      // Recursive: handle next bot turn
      await handleBotTurns(io, roomId, freshEngine, await GameRoom.findOne({ roomId }));

    } catch (err) {
      logger.error('Bot turn error:', err);
    }
  }, thinkTime);
}

async function handleGameWin(io, roomId, winner, winType, engine, room) {
  try {
    engine.gameState = 'finished';
    activeGames.delete(roomId);

    await GameRoom.findOneAndUpdate({ roomId }, {
      status: 'completed',
      winner: {
        userId: winner.userId,
        username: winner.username || winner.botName,
        isBot: winner.isBot || false,
        winType,
      },
      gameState: 'finished',
      endedAt: new Date(),
    });

    // Process financial results
    await processGameResult(room, winner);

    // Update player stats
    for (const player of room.players) {
      if (!player.isBot && player.userId) {
        const isWinner = player.userId.toString() === winner.userId?.toString();
        const update = {
          $inc: {
            'gameStats.totalGames': 1,
            ...(isWinner ? {
              'gameStats.wins': 1,
              'gameStats.winStreak': 1,
              'wallet.totalWon': room.winnerPrize,
            } : {
              'gameStats.losses': 1,
              'wallet.totalLost': room.stakeAmount,
            }),
          },
          onlineStatus: 'online',
        };

        // Consume one assisted win if this new user just won an assisted match
        if (isWinner) {
          const freshWinnerUser = await User.findById(player.userId).select('gameStats.assistedWinsRemaining');
          if ((freshWinnerUser?.gameStats?.assistedWinsRemaining || 0) > 0) {
            update.$inc['gameStats.assistedWinsRemaining'] = -1;
          }
        }

        await User.findByIdAndUpdate(player.userId, update);
      }
    }

    io.to(`game:${roomId}`).emit('gameOver', {
      winner: {
        username: winner.username || winner.botName,
        isBot: winner.isBot || false,
      },
      winType,
      prize: room.winnerPrize,
    });

    io.to(`game:${roomId}`).emit('voiceAnnouncement', {
      text: winner.isBot ? 'Game Over!' : 'Whot! I win!',
      type: 'win',
      triggeredBy: winner.username || winner.botName,
    });

  } catch (err) {
    logger.error('handleGameWin error:', err);
  }
}

async function handleGameTimeout(io, roomId, engine) {
  const currentEngine = activeGames.get(roomId);
  if (!currentEngine || currentEngine.gameState === 'finished') return;

  const room = await GameRoom.findOne({ roomId });
  if (!room || room.status !== 'in-progress') return;

  currentEngine.gameState = 'finished';
  activeGames.delete(roomId);

  const { winner, rankings, winType } = currentEngine.calculateWinnerByCardCount();

  io.to(`game:${roomId}`).emit('gameTimeout', {
    message: 'Time is up! Counting cards...',
    rankings: rankings.map(p => ({
      username: p.username || p.botName,
      totalPoints: p.totalPoints,
      handSize: p.handSize,
    })),
  });

  setTimeout(async () => {
    await handleGameWin(io, roomId, winner, 'timeout', currentEngine, room);
  }, 3000);
}

async function handleMarketEmpty(io, roomId, engine) {
  const room = await GameRoom.findOne({ roomId });
  if (!room) return;

  io.to(`game:${roomId}`).emit('marketEmpty', {
    message: 'No more cards in market! Counting cards...',
  });

  setTimeout(async () => {
    const { winner, rankings } = engine.calculateWinnerByCardCount();

    io.to(`game:${roomId}`).emit('gameTimeout', {
      message: 'Market empty! Card count result:',
      rankings: rankings.map(p => ({
        username: p.username || p.botName,
        totalPoints: p.totalPoints,
      })),
    });

    await handleGameWin(io, roomId, winner, 'card-count', engine, room);
  }, 3000);
}

async function broadcastPlayerHands(io, engine, room) {
  if (!room) return;
  for (const player of room.players) {
    if (!player.isBot && player.userId && player.socketId) {
      const playerState = engine.getPlayerState(player.userId.toString());
      if (playerState) {
        io.to(player.socketId).emit('handUpdate', {
          hand: playerState.myHand,
          cardCount: playerState.myCardCount,
          isMyTurn: playerState.isMyTurn,
          canPlayableCards: playerState.canPlayableCards,
        });
      }
    }
  }
}

async function syncGameStateToDb(roomId, engine, room) {
  const gameState = engine.getGameState();
  await GameRoom.findOneAndUpdate({ roomId }, {
    topCard: engine.topCard,
    currentPlayerIndex: engine.currentPlayerIndex,
    'timer.isExpired': false,
  });
}

async function deductStake(userId, amount, roomId) {
  const user = await User.findById(userId);
  if (!user) return;

  let remaining = amount;
  const walletBal = user.wallet.balance;
  const bonusBal = user.wallet.hasDeposited ? user.wallet.bonusBalance : 0;

  // Use wallet balance first, then bonus
  if (walletBal >= remaining) {
    await User.findByIdAndUpdate(userId, { $inc: { 'wallet.balance': -remaining } });
  } else {
    const walletDeduct = walletBal;
    const bonusDeduct = remaining - walletDeduct;
    await User.findByIdAndUpdate(userId, {
      $inc: { 'wallet.balance': -walletDeduct, 'wallet.bonusBalance': -bonusDeduct },
    });
  }

  const Transaction = require('../models/Transaction');
  await Transaction.create({
    userId,
    type: 'game-stake',
    amount,
    status: 'completed',
    reference: `stake_${roomId}_${userId}_${Date.now()}`,
    description: `Game stake for room ${roomId}`,
    metadata: { gameRoomId: roomId },
  });
}

module.exports = { initializeSocket };
