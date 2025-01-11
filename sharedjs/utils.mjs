import { abilities } from './abilities.mjs';
import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;
globalThis.DECK_IMAGE_EXTENSION = '.png'; // In case we want smaller filesize JPGs in the future
globalThis.CORRECT_CAMP_NUM = 3;
globalThis.TURN_WATER_COUNT = 3;
globalThis.SLOT_NUM_ROWS = 2;
globalThis.SLOT_NUM_COLS = 3;
globalThis.SLOT_ID_PREFIX = 'slot_';
globalThis.MSG_INVALID_TARGETS = 'No valid targets for card effect';

globalThis.DEBUG_AUTO_SELECT_CAMPS_START_TURN = true; // Debugging flag to automatically choose camps and start the turn for easier refresh -> test behaviour
globalThis.DEBUG_DRAW_SO_MANY_CARDS = 30; // Debugging flag to draw a bigger initial hand of cards, to better test junk effects. Put above 0 to enable
globalThis.DEBUG_TESTING_PLAYERS = true; // Debugging flag to avoid a few checks to make it easier to test the main game logic. Such as can start your turn without an opponent present
globalThis.DEBUG_AUTO_OPPONENT = true; // Debugging flag to automatically join the game as the opponent when someone starts a game

const utils = {
  hasPlayerDataById(playerId) {
    if (gs && playerId) {
      return gs.player1.playerId === playerId || gs.player2.playerId === playerId;
    }
    return false;
  },

  getOppositePlayerNum(playerNum) {
    return playerNum === 'player1' ? 'player2' : 'player1';
  },

  getContentFromSlots(checkSlots, params) { // params.idOnly: boolean
    return checkSlots.reduce((slots, s) => {
      if (s?.content?.id) {
        slots.push(params?.idOnly ? String(s.content.id) : s.content);
      }
      return slots;
    }, []);
  },

  fireAbilityOrJunk(message, effectName) {
    if (!onClient && effectName) {
      const toCallFunc = action[effectName];
      if (typeof toCallFunc === 'function') {
        try {
          const requiresTarget = utils.effectRequiresTarget(effectName);
          let validTargets = undefined;
          if (requiresTarget) {
            validTargets = utils.determineValidTargets(effectName, message);
            // TODO Need to handle the case where we have SOME validTargets but not equal to expectedTargetCount (when it's not the default of 1, such as a Gunner)
            if (!validTargets.length) {
              throw new Error(MSG_INVALID_TARGETS);
            }
          }

          return toCallFunc(
            { ...message, validTargets, type: effectName },
            effectName === 'drawCard' ? { fromServerRequest: true } : undefined,
          );
        } catch (err) {
          action.sendError(err?.message, message.playerId);
          return false;
        }
      } else if (typeof abilities[effectName] === 'function') {
        return abilities[effectName]({ ...message, type: effectName });
      } else {
        throw new Error('Invalid card effect');
      }
    }
  },

  effectRequiresTarget(effectName) {
    return ['injurePerson', 'restoreCard', 'gainPunk'].includes(effectName);
  },

  determineValidTargets(effectName, message) {
    // TODO Bug with massive draw - sometimes when you do a junk effect a few cards in the hand are valid? Clicking them then a valid target on the board makes those cards disabled too? Really weird state
    if (!message) {
      return [];
    }

    // Returns a relevant list of validTargets as an array of string IDs of the targets
    const fromPlayerNum = utils.getPlayerNumById(message.playerId);
    if (effectName === 'gainPunk') {
      // TODO Should reshuffle here automatically. As part of the targetting we should only count a Punk as a valid option if there's a card left in the deck to draw - technically wouldn't happen in a real game due to reshuffling rules
      if (!onClient && gs.deck?.length <= 1) {
        return [];
      }

      // Determine where our Punk can go
      // If ALL our slots are full then we can place anywhere and destroy the occupant
      let filteredSlots = [];
      if (utils.areAllSlotsFull(gs.slots[fromPlayerNum])) {
        filteredSlots = gs.slots[fromPlayerNum];
      } else {
        filteredSlots = gs.slots[fromPlayerNum]
          .filter((slot, index) => {
            // if our target is an empty slot we can place
            if (!slot.content) {
              return true;
            } // Determine if we're dropping a Punk on a card that has a slot above, in which case we can push that card up
            else if (utils.isBottomRow(index)) {
              if (!gs.slots[fromPlayerNum][utils.indexAbove(index)].content) {
                return true;
              }
            }
          });
      }

      return filteredSlots.map((slot) => {
        return slot.content ? String(slot.content.id) : SLOT_ID_PREFIX + slot.index;
      });
    } else if (effectName === 'restoreCard') {
      let targets = [
        ...utils.getContentFromSlots(gs.slots[fromPlayerNum]),
        ...utils.getPlayerDataById(message.playerId).camps,
      ];
      // Target must be damaged and cannot be self
      targets = targets.filter((target) =>
        typeof target.damage === 'number' && target.damage >= 1 && target.id !== message.details.card.id
      );
      // Return only the IDs
      targets = targets.map((target) => String(target.id));

      return targets;
    } else if (effectName === 'injurePerson') {
      // Look for unprotected people
      return utils.getUnprotectedCards(message, { peopleOnly: true });
    }
    // TODO Eventually do plain Damage (person or camp) effect as well that we can just pass in here generically from playing cards (obviously not from junk effects)
  },

  determineValidDropSlot(targetSlot, allSlots) {
    if (onClient && (!ui.draggedCard || ui.draggedCard.isWaterSilo)) {
      return false;
    }
    if (!targetSlot || !allSlots || !allSlots.length === 0) {
      return false;
    }

    // There is a rules case (added in v1.2) where if ALL your slots are full, you can destroy a card
    // Which means any slot is a valid target in that case
    if (utils.areAllSlotsFull(allSlots)) {
      return true;
    }

    // Determine if our potential column is full
    if (targetSlot.content) {
      if (utils.isTopRow(targetSlot.index)) {
        const slotBelow = allSlots[utils.indexBelow(targetSlot.index)];
        if (slotBelow.content) {
          return false;
        }
        // TODO If our slot below is empty play a dragOverHighlight of the card sliding down into the bottom slot (or a subtle arrow)
      } else if (utils.isBottomRow(targetSlot.index)) {
        const slotAbove = allSlots[utils.indexAbove(targetSlot.index)];
        if (slotAbove.content) {
          return false;
        }
        // TODO If our slot above is empty (and our targetSlot.content is null) then add an animation of pushing the card upwards (or a subtle arrow)
      }
    }

    return true;
  },

  getUnprotectedCards(message, params) { // params are campsOnly (boolean) and peopleOnly (boolean)
    // Get the outermost unprotected opponent card in each column and return their IDs as targets
    const unprotectedCardIds = [];
    const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
    const opponentSlots = gs.slots[opponentPlayerNum];
    const opponentCamps = gs[opponentPlayerNum]?.camps;
    for (let i = 0; i <= SLOT_NUM_ROWS; i++) {
      if (!params?.campsOnly && opponentSlots[i].content !== null) {
        unprotectedCardIds.push(String(opponentSlots[i].content.id));
      } else if (!params?.campsOnly && opponentSlots[i + SLOT_NUM_COLS].content !== null) {
        unprotectedCardIds.push(String(opponentSlots[i + SLOT_NUM_COLS].content.id));
      } else if (
        !params?.peopleOnly &&
        !opponentCamps[i].isDestroyed && utils.isColumnEmpty(i, opponentPlayerNum)
      ) {
        unprotectedCardIds.push(String(opponentCamps[i].id));
      }
    }
    return unprotectedCardIds;
  },

  areAllSlotsFull(slots) {
    return (slots ?? []).every((slot) => slot.content !== null);
  },

  getPlayerIdByNum(playerNum) {
    if (gs && playerNum) {
      return gs[playerNum].playerId;
    }
  },

  getPlayerNumById(playerId) {
    if (gs && playerId) {
      if (gs.player1.playerId === playerId) return 'player1';
      else if (gs.player2.playerId === playerId) return 'player2';
    }
  },

  getOpponentNumById(playerId) {
    getOppositePlayerNum(utils.getPlayerNumById(playerId));
  },

  getPlayerDataById(playerId) {
    if (gs && playerId) {
      if (gs.player1.playerId === playerId) return gs.player1;
      else if (gs.player2.playerId === playerId) return gs.player2;
    }
    return null;
  },

  isPlayersTurn(playerId) {
    return gs.turn.currentPlayer && gs.turn.currentPlayer === utils.getPlayerNumById(playerId);
  },

  /**
   * Check both player slots and both player camps for the passed card
   */
  findCardInGame(card) {
    return utils.findCardInSlots(card) || this.findCardInCamps(card);
  },

  findCardInCamps(card) {
    function findCardInPlayerCamps(card, playerNum) {
      const foundIndex = gs[playerNum].camps.findIndex((loopCamp) => {
        return loopCamp?.id === (typeof card.id === 'number' ? card.id : +card.id);
      });
      if (foundIndex !== -1) {
        return {
          cardObj: gs[playerNum].camps[foundIndex],
          playerNum,
        };
      }
    }

    return findCardInPlayerCamps(card, 'player1') || findCardInPlayerCamps(card, 'player2');
  },

  findCardInSlots(card) {
    function findCardInPlayerSlots(card, playerNum) {
      const slotIndex = gs.slots[playerNum].findIndex((loopSlot) => {
        return loopSlot?.content?.id === (typeof card.id === 'number' ? card.id : +card.id); // TODO Better consistent number typing throughout the whole app
      });
      if (slotIndex !== -1) {
        return {
          cardObj: gs.slots[playerNum][slotIndex].content,
          slotIndex,
          playerNum,
        };
      }
    }

    return findCardInPlayerSlots(card, 'player1') || findCardInPlayerSlots(card, 'player2');
  },

  makeWaterSiloCard() {
    return { img: `water_silo${DECK_IMAGE_EXTENSION}`, cost: 1, junkEffect: 'gainWater', isWaterSilo: true };
  },

  convertCardToPunk(cardObj) {
    gs.punks.push(structuredClone(cardObj));

    return {
      id: cardObj.id,
      img: 'punk.png',
      isPunk: true,
    };
  },

  shuffleDeck(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  drawFromDeck() {
    if (onClient) {
      return null;
    }

    let toReturn = null;

    if (gs.deck.length >= 1) {
      toReturn = gs.deck.shift();
    }
    // Per the rules if we have an empty deck we reshuffle ONCE. Then if we need to reshuffle again the game is considered a Draw/Tie
    if (gs.deck.length <= 0) {
      gs.deckReshuffleCount++;

      if (gs.deckReshuffleCount >= 2) {
        // TODO Actual handling of the draw/tie from a double reshuffle - very rare, but worth covering
        action.sendError('Game is a tie! (Had to reshuffle the draw deck twice)');
        return null;
      }
      // Can't imagine a legitimate situation where the draw deck has run out and there are no discards
      if (gs.discard.length <= 0) {
        action.sendError('Game is a tie! (Had to reshuffle the draw deck, but there are no discards)');
        return null;
      }

      // TODO Better UI handling of reshuffling - block UI interaction (dialog?), play an animation, etc.
      const reshuffledDeck = utils.shuffleDeck(gs.discard);
      gs.deck = reshuffledDeck;
      gs.deckCount = gs.deck.length;
      gs.discard = [];
      gs.discardCount = 0;

      action.sync();

      action.sendError('Reshuffled the draw deck');
      toReturn = gs.deck.shift();
    }

    return toReturn;
  },

  checkSelectedTargets(message) {
    const validTargets = message?.validTargets;
    const targets = message?.details?.targets ?? [];
    if (validTargets?.length && targets?.length) {
      if (!targets.every((id) => validTargets.includes(id))) {
        throw new Error('Target(s) invalid');
      }

      return targets;
    }
    return null;
  },

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  randomRange(min, max) {
    // TODO Probably rock and roll as good as a random generator we can find - given that it's a game and all
    let randomNumber = 0;
    if ((globalThis && globalThis.crypto) || (window && window.crypto)) {
      const randomBuffer = new Uint32Array(1);
      ((globalThis && globalThis.crypto) || (window && window.crypto)).getRandomValues(randomBuffer);
      randomNumber = randomBuffer[0] / (0xffffffff + 1);
    } else {
      randomNumber = Math.random();
    }

    return Math.floor(randomNumber * (max - min + 1)) + min;
  },

  cardImgToName(img) {
    if (!img) {
      return img;
    }

    // Convert our img name such as rabble_rouser.png to Rabble Rouser
    img = img.substring(0, 1).toUpperCase() + img.substring(1);
    if (img.lastIndexOf('.') !== -1) {
      img = img.substring(0, img.lastIndexOf('.'));
    }
    // Replace all _ with a space and capitalize the next character
    while (img.indexOf('_') !== -1) {
      img = img.substring(0, img.indexOf('_')) +
        ' ' +
        img.substring(img.indexOf('_') + 1, img.indexOf('_') + 2).toUpperCase() +
        img.substring(img.indexOf('_') + 2);
    }

    return img;
  },

  // This particular slot index rules are based on the opponent board being (due to CSS rotation):
  // [ camps ]
  // [5][4][3]
  // [2][1][0]
  // And the player board being:
  // [0][1][2]
  // [3][4][5]
  // [ camps ]
  // So the "top row" is the front row, and "bottom row" is closest to the camps
  // We use hardcoded indexes here but that's okay given that it's centralized
  isTopRow(index) {
    return index <= SLOT_NUM_ROWS;
  },
  isBottomRow(index) {
    return index >= SLOT_NUM_COLS;
  },
  indexAbove(index) {
    return index - SLOT_NUM_COLS;
  },
  indexBelow(index) {
    return index + SLOT_NUM_COLS;
  },
  // Check if a column is empty: columnIndex 0 (slots 0, 3), columnIndex 1 (slots 1, 4), columnIndex 2 (slots 2, 5)
  isColumnEmpty(columnIndex, playerNum) {
    const slots = utils.getSlotsInColumn(columnIndex, playerNum);
    if (slots?.length) {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].content !== null) {
          return false;
        }
      }
    }
    return true;
  },
  // Given a columnIndex (0-2) get all slots in that column
  getSlotsInColumn(columnIndex, playerNum) {
    if (columnIndex < 0 || columnIndex > 2) {
      console.error('Invalid column index requested', columnIndex);
      throw new Error('Invalid column index requested - must be between 0-2');
    }

    const slotsInColumn = [];
    for (let rowIndex = 0; rowIndex < SLOT_NUM_ROWS; rowIndex++) {
      const slotIndex = columnIndex + rowIndex * SLOT_NUM_COLS;
      slotsInColumn.push(gs.slots[playerNum][slotIndex]);
    }
    return slotsInColumn;
  },
};

if (onClient) {
  window.utils = utils;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { utils };
