/**
 * WhotNaija Bot AI Service
 * Professional bots with Nigerian names that play intelligently
 */

const { SPECIAL_CARDS, SUITS, WHOT_VALUE } = require('../services/gameEngine');

// Nigerian male names
const NIGERIAN_MALE_NAMES = [
  'Emeka', 'Chukwuemeka', 'Tunde', 'Segun', 'Biodun', 'Kelechi', 'Obiora',
  'Ifeanyi', 'Adebayo', 'Chidi', 'Femi', 'Gbenga', 'Hakeem', 'Ikenna',
  'Jide', 'Kehinde', 'Lanre', 'Musa', 'Nnamdi', 'Ola', 'Pita', 'Raphael',
  'Samson', 'Tobi', 'Uche', 'Victor', 'Wale', 'Xavier', 'Yemi', 'Zach',
  'Adeleke', 'Babatunde', 'Chinonso', 'Damilola', 'Ebuka', 'Festus', 'Godwin',
  'Hycienth', 'Ifeoma', 'Jimoh', 'Kolawole', 'Leke', 'Mahmoud', 'Niyi',
  'Olumide', 'Pius', 'Quadri', 'Rotimi', 'Sunday', 'Taiwo', 'Uchenna',
];

// Nigerian female names
const NIGERIAN_FEMALE_NAMES = [
  'Ngozi', 'Amaka', 'Chioma', 'Adaeze', 'Funke', 'Blessing', 'Chiamaka',
  'Damilola', 'Ejiro', 'Fatima', 'Grace', 'Hauwa', 'Ifeoma', 'Jumoke',
  'Kemi', 'Lara', 'Maryam', 'Nneka', 'Omowunmi', 'Priscilla', 'Queen',
  'Remi', 'Sade', 'Temi', 'Uche', 'Vivian', 'Wunmi', 'Xenia', 'Yetunde',
  'Zainab', 'Adaora', 'Bukola', 'Chidinma', 'Deborah', 'Esther', 'Francisca',
  'Gloria', 'Helen', 'Isioma', 'Josephine', 'Kelechi', 'Lola', 'Miriam',
  'Nkechi', 'Oluchi', 'Patience', 'Queeneth', 'Rita', 'Sandra', 'Titilayo',
];

// Nigerian last names
const NIGERIAN_LAST_NAMES = [
  'Okonkwo', 'Adeyemi', 'Eze', 'Bello', 'Okafor', 'Ibrahim', 'Nwachukwu',
  'Adesanya', 'Chukwu', 'Danjuma', 'Emeka', 'Fashola', 'Gana', 'Hassan',
  'Idibia', 'Jakande', 'Kalu', 'Lawal', 'Mba', 'Nwosu', 'Obi', 'Pius',
  'Rabiu', 'Sani', 'Tinubu', 'Usman', 'Vandu', 'Wabara', 'Yakubu', 'Zungeru',
  'Adeola', 'Babangida', 'Coker', 'Dike', 'Effiong', 'Fela', 'Gowon',
  'Henshaw', 'Igwe', 'Jega', 'Kukah', 'Lukman', 'Musa', 'Ndidi', 'Obiechina',
];

// Bot difficulty levels
const BOT_DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  EXPERT: 'expert',
};

// Bot emojis - Nigerian style
const BOT_EMOJIS = ['😂', '🔥', '💪', '😎', '🃏', '👑', '⚡', '🎯', '💯', '🎉'];
const BOT_TAUNT_EMOJIS = ['😏', '😈', '💀', '🤣', '😤'];
const BOT_CELEBRATE_EMOJIS = ['🥳', '🎊', '👏', '🔥', '💯'];

const usedBotNames = new Set();

/**
 * Generate a unique Nigerian bot name
 */
function generateBotName() {
  const isFemale = Math.random() < 0.4;
  const firstNames = isFemale ? NIGERIAN_FEMALE_NAMES : NIGERIAN_MALE_NAMES;

  let attempts = 0;
  let name;

  do {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = NIGERIAN_LAST_NAMES[Math.floor(Math.random() * NIGERIAN_LAST_NAMES.length)];
    name = `${firstName} ${lastName}`;
    attempts++;
  } while (usedBotNames.has(name) && attempts < 100);

  usedBotNames.add(name);

  // Auto-cleanup after 1 hour
  setTimeout(() => usedBotNames.delete(name), 3600000);

  return name;
}

/**
 * Generate bot username from full name
 */
function generateBotUsername(fullName) {
  const parts = fullName.split(' ');
  const rand = Math.floor(Math.random() * 999);
  return `${parts[0].toLowerCase()}${rand}`;
}

/**
 * Create a bot player object
 */
function createBot(difficulty = BOT_DIFFICULTY.EXPERT) {
  const name = generateBotName();
  return {
    userId: null,
    username: generateBotUsername(name),
    botName: name,
    avatar: null,
    isBot: true,
    difficulty,
    hand: [],
    hasCalledLastCard: false,
    isActive: true,
    socketId: null,
    // Personality traits
    personality: {
      aggression: Math.random() * 0.4 + 0.6, // 0.6-1.0 (high)
      reactivity: Math.random() * 0.5 + 0.5, // How often it reacts with emojis
      emojiFrequency: Math.random() * 0.3 + 0.1, // 0.1-0.4
    },
  };
}

/**
 * Bot AI: Choose best card to play
 */
function getBotMove(bot, gameState, difficulty = BOT_DIFFICULTY.EXPERT) {
  const { hand, topCard, calledSuit, pendingPickCount, pendingPickType } = {
    hand: bot.hand,
    topCard: gameState.topCard,
    calledSuit: gameState.calledSuit,
    pendingPickCount: gameState.pendingPickCount,
    pendingPickType: gameState.pendingPickType,
  };

  // Filter playable cards
  const playableCards = hand.filter(card => {
    if (card.value === WHOT_VALUE) {
      return pendingPickCount === 0; // Whot can't defend picks
    }
    if (pendingPickCount > 0) {
      if (pendingPickType === 'pick2' && card.value === 2) return true;
      if (pendingPickType === 'pick3' && card.value === 5) return true;
      return false;
    }
    if (calledSuit) return card.suit === calledSuit;
    return card.suit === topCard.suit || card.value === topCard.value;
  });

  if (playableCards.length === 0) return null; // Must pick from market

  switch (difficulty) {
    case BOT_DIFFICULTY.EASY:
      return getEasyMove(playableCards, hand);
    case BOT_DIFFICULTY.MEDIUM:
      return getMediumMove(playableCards, hand, pendingPickCount);
    case BOT_DIFFICULTY.HARD:
    case BOT_DIFFICULTY.EXPERT:
    default:
      return getExpertMove(playableCards, hand, pendingPickCount, pendingPickType);
  }
}

/**
 * Easy bot: plays randomly
 */
function getEasyMove(playableCards) {
  return playableCards[Math.floor(Math.random() * playableCards.length)];
}

/**
 * Medium bot: prefers special cards
 */
function getMediumMove(playableCards, hand, pendingPickCount) {
  // Defend picks if possible
  if (pendingPickCount > 0) {
    const defender = playableCards.find(c => c.value === 2 || c.value === 5);
    if (defender) return defender;
  }

  // Prefer special cards
  const specialCard = playableCards.find(c => SPECIAL_CARDS[c.value]);
  if (specialCard) return specialCard;

  return playableCards[Math.floor(Math.random() * playableCards.length)];
}

/**
 * Expert bot: strategic play
 */
function getExpertMove(playableCards, hand, pendingPickCount, pendingPickType) {
  // Always defend pick2/pick3 if possible
  if (pendingPickCount > 0) {
    const defender = playableCards.find(c =>
      (pendingPickType === 'pick2' && c.value === 2) ||
      (pendingPickType === 'pick3' && c.value === 5)
    );
    if (defender) return defender;
  }

  // Priority 1: Play Whot if low on cards and need to control suit
  const whotCard = playableCards.find(c => c.value === WHOT_VALUE);
  if (whotCard && hand.length <= 3) return whotCard;

  // Priority 2: Play pick2 or pick5 to disrupt opponent
  const pickCard = playableCards.find(c => c.value === 2 || c.value === 5);
  if (pickCard && hand.length > 3) return pickCard;

  // Priority 3: Play suspension or hold-on
  const controlCard = playableCards.find(c => c.value === 1 || c.value === 8);
  if (controlCard) return controlCard;

  // Priority 4: Play general market if opponent has few cards
  const generalMarket = playableCards.find(c => c.value === 14);
  if (generalMarket) return generalMarket;

  // Priority 5: Play the highest value card (to reduce hand points)
  playableCards.sort((a, b) => b.value - a.value);

  // Prefer to play card that changes suit to one we have most of
  const suitCounts = {};
  hand.forEach(c => { suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1; });
  const bestSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const suitPreferred = playableCards.find(c => c.suit === bestSuit);
  if (suitPreferred) return suitPreferred;

  return playableCards[0];
}

/**
 * Bot: Choose which suit to call when playing Whot
 */
function getBotCalledSuit(bot) {
  const hand = bot.hand;
  if (!hand || hand.length === 0) {
    return SUITS[Math.floor(Math.random() * SUITS.length)];
  }

  // Count suits in hand (excluding whot cards)
  const suitCounts = {};
  SUITS.forEach(s => { suitCounts[s] = 0; });
  hand.forEach(card => {
    if (card.value !== WHOT_VALUE && SUITS.includes(card.suit)) {
      suitCounts[card.suit]++;
    }
  });

  // Call suit we have most of
  return Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Bot: Decide whether to send an emoji
 */
function getBotEmoji(bot, trigger = 'random') {
  const { personality } = bot;
  const rand = Math.random();

  // Only send emoji based on personality
  if (rand > personality.emojiFrequency) return null;

  switch (trigger) {
    case 'won':
      return BOT_CELEBRATE_EMOJIS[Math.floor(Math.random() * BOT_CELEBRATE_EMOJIS.length)];
    case 'pick2_played':
    case 'pick3_played':
      return BOT_TAUNT_EMOJIS[Math.floor(Math.random() * BOT_TAUNT_EMOJIS.length)];
    case 'last_card':
      return '🃏';
    default:
      return BOT_EMOJIS[Math.floor(Math.random() * BOT_EMOJIS.length)];
  }
}

/**
 * Calculate bot move delay (human-like)
 */
function getBotThinkTime(difficulty, handSize) {
  const baseTimes = {
    [BOT_DIFFICULTY.EASY]: [2000, 4000],
    [BOT_DIFFICULTY.MEDIUM]: [1500, 3000],
    [BOT_DIFFICULTY.HARD]: [800, 2000],
    [BOT_DIFFICULTY.EXPERT]: [600, 1500],
  };

  const [min, max] = baseTimes[difficulty] || [1000, 2000];
  // Add slight variation based on hand size (more cards = slightly longer think)
  const sizeBonus = Math.min(handSize * 100, 500);
  return Math.floor(Math.random() * (max - min) + min) + sizeBonus;
}

module.exports = {
  createBot,
  getBotMove,
  getBotCalledSuit,
  getBotEmoji,
  getBotThinkTime,
  generateBotName,
  BOT_DIFFICULTY,
};
