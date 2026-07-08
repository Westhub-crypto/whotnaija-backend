/**
 * WhotNaija Game Engine
 * Complete implementation of Nigerian Whot card game rules
 */

const SUITS = ['circle', 'star', 'cross', 'triangle', 'square'];
const WHOT_VALUE = 20;

// Real Whot deck composition (Nigerian 54-card pack):
// Circle & Triangle: 12 cards each — 1,2,3,4,5,7,8,10,11,12,13,14
// Cross & Square: 9 cards each — 1,2,3,5,7,10,11,13,14
// Star: 7 cards — 1,2,3,4,5,7,8
// Whot: 5 cards, value 20
// Total: 12+12+9+9+7+5 = 54 cards
const SUIT_VALUES = {
  circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  star: [1, 2, 3, 4, 5, 7, 8],
};

// Special card values and their actions
const SPECIAL_CARDS = {
  1: { name: 'Hold On', action: 'skip', description: 'Next player skips their turn' },
  2: { name: 'Pick Two', action: 'pick2', description: 'Next player picks 2 cards (stackable)' },
  5: { name: 'Pick Three', action: 'pick3', description: 'Next player picks 3 cards' },
  8: { name: 'Suspension', action: 'suspend', description: 'Next player is suspended' },
  14: { name: 'General Market', action: 'generalMarket', description: 'All players pick one card' },
  20: { name: 'Whot', action: 'whot', description: 'Wild card - caller chooses suit' },
};

// Voice announcements for special cards
const VOICE_ANNOUNCEMENTS = {
  pick2: 'Pick Two!',
  pick2_defended: 'Defended!',
  pick3: 'Pick Three!',
  skip: 'Hold On!',
  suspend: 'Suspension!',
  generalMarket: 'General Market!',
  whot: 'Whot!',
  lastCard: 'Last Card!',
  whot_win: 'Whot! I win!',
  checkUp: 'Check Up!',
};

class WhotGameEngine {
  constructor() {
    this.deck = [];
    this.discardPile = [];
    this.players = [];
    this.currentPlayerIndex = 0;
    this.direction = 'clockwise';
    this.gameState = 'idle';
    this.calledSuit = null;
    this.pendingPickCount = 0; // For stacked pick2/pick3
    this.pendingPickType = null; // 'pick2' or 'pick3'
    this.marketEmpty = false;
    this.topCard = null;
  }

  /**
   * Create a full Whot deck
   */
  createDeck() {
    const deck = [];
    let idCounter = 0;

    SUITS.forEach(suit => {
      SUIT_VALUES[suit].forEach(value => {
        deck.push({
          suit,
          value,
          id: `${suit}_${value}_${idCounter++}`,
        });
      });
    });

    // Add 5 Whot cards
    for (let i = 0; i < 5; i++) {
      deck.push({
        suit: 'whot',
        value: WHOT_VALUE,
        id: `whot_${WHOT_VALUE}_${idCounter++}`,
      });
    }

    return deck;
  }

  /**
   * Shuffle deck using Fisher-Yates algorithm
   */
  shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Initialize a new game
   */
  initGame(players) {
    this.deck = this.shuffleDeck(this.createDeck());
    this.discardPile = [];
    this.players = players.map((p, idx) => ({
      ...p,
      hand: [],
      hasCalledLastCard: false,
      position: idx,
    }));
    this.currentPlayerIndex = 0;
    this.direction = 'clockwise';
    this.gameState = 'playing';
    this.calledSuit = null;
    this.pendingPickCount = 0;
    this.pendingPickType = null;
    this.marketEmpty = false;

    // Deal 6 cards to each player (standard Whot deal)
    this.players.forEach(player => {
      player.hand = this.deck.splice(0, 6);
    });

    // Flip top card - ensure it's not a special card (including Whot) to start
    let startCard;
    let attempts = 0;
    do {
      startCard = this.deck.shift();
      if (SPECIAL_CARDS[startCard.value]) {
        this.deck.push(startCard); // Put back at the end
        startCard = null;
      }
      attempts++;
    } while (!startCard && attempts < 200);

    // Fallback safety: if somehow only special cards remain, just take one
    if (!startCard) {
      startCard = this.deck.shift();
    }

    this.discardPile = [startCard];
    this.topCard = startCard;

    return this.getGameState();
  }

  /**
   * Get current top of discard pile
   */
  getTopCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  /**
   * Check if a card can be played
   */
  canPlayCard(card, topCard, calledSuit, pendingPickCount, pendingPickType) {
    // Whot card can always be played (unless there's a pending pick to defend)
    if (card.value === WHOT_VALUE) {
      // Can defend a pick with another whot? No - whot cannot defend picks
      if (pendingPickCount > 0) return false;
      return true;
    }

    // If there's a pending pick (pick2 or pick3 stacked), must defend with same card
    if (pendingPickCount > 0) {
      if (pendingPickType === 'pick2' && card.value === 2) return true;
      if (pendingPickType === 'pick3' && card.value === 5) return true;
      return false;
    }

    // Called suit takes priority (after Whot card)
    if (calledSuit) {
      return card.suit === calledSuit;
    }

    // Match by suit or value
    return card.suit === topCard.suit || card.value === topCard.value;
  }

  /**
   * Play a card and return the result
   */
  playCard(playerId, card, calledSuit = null) {
    const playerIndex = this.players.findIndex(p =>
      p.userId?.toString() === playerId?.toString() ||
      p.botName === playerId
    );

    if (playerIndex === -1) {
      return { success: false, error: 'Player not found' };
    }

    if (playerIndex !== this.currentPlayerIndex) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.players[playerIndex];
    const topCard = this.getTopCard();

    // Find card in player's hand
    const cardIndex = player.hand.findIndex(c => c.id === card.id);
    if (cardIndex === -1) {
      return { success: false, error: 'Card not in hand' };
    }

    const playedCard = player.hand[cardIndex];

    // Validate move
    if (!this.canPlayCard(playedCard, topCard, this.calledSuit, this.pendingPickCount, this.pendingPickType)) {
      return { success: false, error: 'Invalid move - card cannot be played' };
    }

    // Remove card from hand
    player.hand.splice(cardIndex, 1);

    // Add to discard pile
    this.discardPile.push(playedCard);
    this.topCard = playedCard;
    this.calledSuit = null;

    // If a pick2/pick3 is pending, playing the matching special card stacks the threat
    // (it does NOT defend/cancel it — it passes a bigger threat to the next player)
    let stacked = false;
    if (this.pendingPickCount > 0) {
      if ((this.pendingPickType === 'pick2' && playedCard.value === 2) ||
          (this.pendingPickType === 'pick3' && playedCard.value === 5)) {
        this.pendingPickCount += playedCard.value === 2 ? 2 : 3;
        stacked = true;
      }
    }

    // Process special card effects
    const effect = this.processSpecialCard(playedCard, calledSuit, stacked);

    // Check win condition
    if (player.hand.length === 0) {
      this.gameState = 'finished';
      return {
        success: true,
        card: playedCard,
        effect,
        winner: player,
        winType: 'normal',
        gameState: this.getGameState(),
      };
    }

    // Check last card
    const calledLastCard = player.hasCalledLastCard;
    if (player.hand.length === 1) {
      // Player should have called last card
    }

    return {
      success: true,
      card: playedCard,
      effect,
      stacked,
      gameState: this.getGameState(),
    };
  }

  /**
   * Process special card effects and advance turn
   */
  processSpecialCard(card, calledSuit, stacked) {
    const effect = {
      type: 'normal',
      voiceAnnouncement: null,
      affectedPlayers: [],
      cardsToPickCount: 0,
    };

    // If this card stacks onto an existing pick2/pick3 threat, re-announce with the new total
    // and pass the (now bigger) threat to the next player — it is NOT defended yet.
    if (stacked) {
      effect.type = this.pendingPickType;
      effect.voiceAnnouncement = this.pendingPickType === 'pick2'
        ? VOICE_ANNOUNCEMENTS.pick2
        : VOICE_ANNOUNCEMENTS.pick3;
      effect.cardsToPickCount = this.pendingPickCount;
      this.advanceTurn(1);
      return effect;
    }

    switch (card.value) {
      case 1: // Hold On - skip next player
        effect.type = 'skip';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.skip;
        this.advanceTurn(2); // Skip next player
        break;

      case 2: // Pick Two
        if (this.pendingPickCount === 0) {
          this.pendingPickCount = 2;
          this.pendingPickType = 'pick2';
        }
        effect.type = 'pick2';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.pick2;
        effect.cardsToPickCount = this.pendingPickCount;
        this.advanceTurn(1);
        break;

      case 5: // Pick Three
        if (this.pendingPickCount === 0) {
          this.pendingPickCount = 3;
          this.pendingPickType = 'pick3';
        }
        effect.type = 'pick3';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.pick3;
        effect.cardsToPickCount = this.pendingPickCount;
        this.advanceTurn(1);
        break;

      case 8: // Suspension
        effect.type = 'suspend';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.suspend;
        this.advanceTurn(2); // Next player suspended
        break;

      case 14: // General Market
        effect.type = 'generalMarket';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.generalMarket;
        this.handleGeneralMarket();
        this.advanceTurn(1);
        break;

      case 20: // Whot
        this.calledSuit = calledSuit;
        effect.type = 'whot';
        effect.voiceAnnouncement = VOICE_ANNOUNCEMENTS.whot;
        effect.calledSuit = calledSuit;
        this.advanceTurn(1);
        break;

      default:
        this.advanceTurn(1);
        break;
    }

    return effect;
  }

  /**
   * Handle General Market - all other players pick a card
   */
  handleGeneralMarket() {
    this.players.forEach((player, idx) => {
      if (idx !== this.currentPlayerIndex) {
        const card = this.drawFromDeck();
        if (card) player.hand.push(card);
      }
    });
  }

  /**
   * Advance to next player's turn
   */
  advanceTurn(steps = 1) {
    const totalPlayers = this.players.filter(p => p.isActive !== false).length;
    if (this.direction === 'clockwise') {
      this.currentPlayerIndex = (this.currentPlayerIndex + steps) % this.players.length;
    } else {
      this.currentPlayerIndex = ((this.currentPlayerIndex - steps) + this.players.length) % this.players.length;
    }
  }

  /**
   * Draw a card from deck
   */
  drawFromDeck() {
    if (this.deck.length === 0) {
      // Reshuffle discard pile (keep top card)
      if (this.discardPile.length <= 1) {
        this.marketEmpty = true;
        return null;
      }
      const topCard = this.discardPile.pop();
      this.deck = this.shuffleDeck(this.discardPile);
      this.discardPile = [topCard];
    }
    return this.deck.shift() || null;
  }

  /**
   * Player picks from market (cannot play)
   */
  playerPickFromMarket(playerId) {
    const playerIndex = this.players.findIndex(p =>
      p.userId?.toString() === playerId?.toString() ||
      p.botName === playerId
    );

    if (playerIndex !== this.currentPlayerIndex) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.players[playerIndex];

    // If there's a pending pick, force pick that many
    if (this.pendingPickCount > 0) {
      const pickedCards = [];
      const pickedCount = this.pendingPickCount;
      for (let i = 0; i < this.pendingPickCount; i++) {
        const card = this.drawFromDeck();
        if (card) {
          player.hand.push(card);
          pickedCards.push(card);
        }
      }
      this.pendingPickCount = 0;
      this.pendingPickType = null;
      this.advanceTurn(1);
      return {
        success: true,
        pickedCards,
        marketEmpty: this.marketEmpty,
        defended: true,
        voiceAnnouncement: VOICE_ANNOUNCEMENTS.pick2_defended,
        pickedCount,
        gameState: this.getGameState(),
      };
    }

    // Normal market pick
    const card = this.drawFromDeck();
    if (!card) {
      this.marketEmpty = true;
      // Check if player has playable card
      return { success: false, error: 'Market is empty', marketEmpty: true };
    }

    player.hand.push(card);

    // After picking, player can play if card is playable
    const topCard = this.getTopCard();
    const canPlayPickedCard = this.canPlayCard(card, topCard, this.calledSuit, 0, null);

    if (!canPlayPickedCard) {
      this.advanceTurn(1);
    }

    return {
      success: true,
      pickedCard: card,
      canPlayPickedCard,
      marketEmpty: this.marketEmpty,
      gameState: this.getGameState(),
    };
  }

  /**
   * Call "Last Card" when one card remaining
   */
  callLastCard(playerId) {
    const player = this.players.find(p =>
      p.userId?.toString() === playerId?.toString() ||
      p.botName === playerId
    );
    if (!player) return { success: false };
    player.hasCalledLastCard = true;
    return { success: true, voiceAnnouncement: VOICE_ANNOUNCEMENTS.lastCard };
  }

  /**
   * Calculate winner by card count (when market is empty / timeout)
   */
  calculateWinnerByCardCount() {
    const playerScores = this.players.map(player => {
      // Star cards count double points; all other suits (including Whot, at value 20) count face value.
      const totalPoints = player.hand.reduce((sum, card) => {
        const cardPoints = card.suit === 'star' ? card.value * 2 : card.value;
        return sum + cardPoints;
      }, 0);
      return {
        ...player,
        totalPoints,
        handSize: player.hand.length,
      };
    });

    // Sort by total points (ascending - less is better)
    playerScores.sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) return a.totalPoints - b.totalPoints;
      return a.handSize - b.handSize; // Tiebreaker: fewer cards
    });

    return {
      winner: playerScores[0],
      rankings: playerScores,
      winType: 'card-count',
    };
  }

  /**
   * Get serializable game state
   */
  getGameState() {
    return {
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      gameState: this.gameState,
      topCard: this.topCard,
      calledSuit: this.calledSuit,
      pendingPickCount: this.pendingPickCount,
      pendingPickType: this.pendingPickType,
      marketEmpty: this.marketEmpty,
      deckCount: this.deck.length,
      discardPileCount: this.discardPile.length,
      players: this.players.map(p => ({
        userId: p.userId,
        username: p.username || p.botName,
        isBot: p.isBot,
        cardCount: p.hand.length,
        hasCalledLastCard: p.hasCalledLastCard,
        position: p.position,
        isActive: p.isActive,
        // Only include hand details for the specific player (sent separately per-player)
      })),
    };
  }

  /**
   * Get player-specific state (includes their hand)
   */
  getPlayerState(playerId) {
    const player = this.players.find(p =>
      p.userId?.toString() === playerId?.toString() ||
      p.botName === playerId
    );
    if (!player) return null;

    return {
      ...this.getGameState(),
      myHand: player.hand,
      myCardCount: player.hand.length,
      isMyTurn: this.players[this.currentPlayerIndex]?.userId?.toString() === playerId?.toString(),
      canPlayableCards: player.hand.filter(card =>
        this.canPlayCard(card, this.topCard, this.calledSuit, this.pendingPickCount, this.pendingPickType)
      ),
    };
  }

  /**
   * Get valid moves for a player
   */
  getValidMoves(playerId) {
    const player = this.players.find(p =>
      p.userId?.toString() === playerId?.toString() ||
      p.botName === playerId
    );
    if (!player) return [];

    return player.hand.filter(card =>
      this.canPlayCard(card, this.topCard, this.calledSuit, this.pendingPickCount, this.pendingPickType)
    );
  }

  /**
   * Check if game is over
   */
  isGameOver() {
    return this.gameState === 'finished' || this.marketEmpty;
  }
}

module.exports = {
  WhotGameEngine,
  SPECIAL_CARDS,
  VOICE_ANNOUNCEMENTS,
  SUITS,
  SUIT_VALUES,
  WHOT_VALUE,
};
