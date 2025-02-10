import { abilities } from './abilities.mjs';
import { action } from './actions.mjs';
import { events } from './events.mjs';
import { getGS } from './gamestate.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;
globalThis.DECK_IMAGE_EXTENSION = '.png'; // In case we want smaller filesize JPGs in the future, TODO this is only consistently used on the deck generation, not throughout the app
globalThis.CORRECT_CAMP_NUM = 3;
globalThis.FIRST_TURN_WATER_COUNT = 1;
globalThis.EMPTY_LOBBY_CLEANUP_S = 30;
globalThis.TURN_WATER_COUNT = 3;
globalThis.SLOT_NUM_ROWS = 2;
globalThis.SLOT_NUM_COLS = 3;
globalThis.SLOT_ID_PREFIX = 'slot_';
globalThis.AI_PLAYER_ID = 'autoOpponent';
globalThis.MSG_INVALID_TARGETS = 'No valid targets for card effect';
globalThis.GAME_START_COUNTDOWN_S = 2; // TTODO Countdown should be 10, just easier to debug at 2

globalThis.DEBUG_AUTO_SELECT_CAMPS_START_TURN = false; // Debugging flag to automatically choose camps and start the turn for easier refresh -> test behaviour
globalThis.DEBUG_DRAW_SO_MANY_CARDS = 0; // Debugging flag to draw a bigger initial hand of cards, to better test junk effects. Put above 0 to enable. 30 is good for solo testing, 15 is good for two people

const utils = {
  // TODO Probably split up the utils file so it doesn't grow to a crazy size
  lobbies: new Map(), // Global lobby list (used on the server)
  lobbiesTimeout: new Map(), // Global list of cleanup timers for empty lobbies. key=gameId, value=timer instance

  getGameIdByPlayerId(playerId) {
    for (const loopLobby of utils.lobbies.values()) {
      if (loopLobby.started) {
        for (const player of loopLobby.players) {
          if (player.playerId === playerId) {
            return loopLobby.gameId;
          }
        }
      }
    }
  },

  getLobbyByPlayerId(messageOrPlayerId) {
    if (typeof messageOrPlayerId === 'object') {
      messageOrPlayerId = messageOrPlayerId?.playerId;
    }

    return utils.lobbies?.get(utils.getGameIdByPlayerId(messageOrPlayerId));
  },

  // TODO Split out lobby functionality into a separate file or at least separate export here
  leaveAllLobbies(playerId) {
    // Leave any existing lobby
    utils.lobbies.forEach((lobby) => {
      const foundIndex = lobby.players.findIndex((player) => player.playerId === playerId);
      if (foundIndex >= 0) {
        lobby.players.splice(foundIndex, 1);

        // Also if our opponent was AI then we just remove the lobby
        if (lobby.players.length === 1 && lobby.players[0].playerId === AI_PLAYER_ID) {
          utils.lobbies.delete(lobby.gameId);
        }

        // If the lobby is empty delete after a bit
        if (lobby.players.length === 0) {
          // Cleanup any existing timer and start fresh
          if (utils.lobbiesTimeout.get(lobby.gameId)) {
            clearTimeout(utils.lobbiesTimeout.get(lobby.gameId));
            utils.lobbiesTimeout.delete(lobby.gameId);
          }

          const cleanupTimeout = setTimeout(() => {
            if (utils.lobbies.get(lobby.gameId)?.players?.length === 0) {
              utils.lobbies.delete(lobby.gameId);
              utils.refreshLobbyList();
            }
          }, EMPTY_LOBBY_CLEANUP_S * 1000);

          utils.lobbiesTimeout.set(lobby.gameId, cleanupTimeout);
        }
      }
    });
  },

  refreshLobbyList(message, params) { // params.justToPlayer: boolean
    sendS('lobby', message, {
      subtype: 'giveLobbyList',
      lobbies: utils.convertLobbiesForClient(),
    }, params?.justToPlayer ? message?.playerId : null);
  },

  // Convert our map of lobbies to an array of just public information for the client to display
  convertLobbiesForClient() {
    const toReturn = [];
    if (utils.lobbies?.size) {
      utils.lobbies.forEach((lobby, key) => {
        toReturn.push({
          gameId: key,
          title: lobby.title,
          hasPassword: typeof lobby.password === 'string',
          observers: {
            ...lobby.observers,
          },
          timeLimit: lobby.timeLimit ?? 0,
          players: lobby.players.map((player) => player.playerName), // Strip IDs and just send names
        });
      });
    }
    return toReturn;
  },

  clearUniversal(message) {
    getGS(message).universal.highGround = false;
  },

  hasPlayerDataById(playerId) {
    if (playerId && getGS(playerId)) {
      return getGS(playerId).player1.playerId === playerId || getGS(playerId).player2.playerId === playerId;
    }
    return false;
  },

  getOppositePlayerNum(playerNum) {
    return playerNum === 'player1' ? 'player2' : 'player1';
  },

  getOppositePlayerId(playerId) {
    return utils.getPlayerIdByNum(utils.getOppositePlayerNum(utils.getPlayerNumById(playerId)), playerId); // lol nice chaining bro
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
      // Check if we have a matching action for the requested effect
      const toCallFunc = action[effectName];
      if (typeof toCallFunc === 'function') {
        try {
          const requiresTarget = utils.effectRequiresTarget(effectName);
          let validTargets = undefined;
          if (requiresTarget) {
            validTargets = utils.determineGenericTargets(message, effectName);
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
          console.error('Error firing ability or junk', err);
          action.sendError(err?.message, message.playerId);
          return false;
        }
      } else if (typeof abilities[effectName] === 'function') {
        // Action wasn't found, so we try an ability instead
        return abilities[effectName]({ ...message, type: effectName });
      } else if (typeof events[effectName] === 'function') {
        // Ability wasn't found, so we try an event instead
        return events[effectName]({ ...message, type: effectName });
      } else {
        throw new Error('Invalid card effect');
      }
    }
  },

  effectRequiresTarget(effectName) {
    return ['gainPunk', 'restoreCard', 'injurePerson', 'damageCard'].includes(effectName);
  },

  /**
   * Determine targets for the basic effects that require a target: gainPunk, restoreCard, injurePerson, damageCard
   */
  determineGenericTargets(message, effectName) {
    if (!message) {
      return [];
    }

    // Returns a relevant list of validTargets as an array of string IDs of the targets
    const fromPlayerNum = utils.getPlayerNumById(message.playerId);
    if (effectName === 'gainPunk') {
      // TODO Should reshuffle here automatically. As part of the targetting we should only count a Punk as a valid option if there's a card left in the deck to draw - technically wouldn't happen in a real game due to reshuffling rules
      if (!onClient && getGS(message).deck?.length < 1) {
        return [];
      }

      // Determine where our Punk can go
      // If ALL our slots are full then we can place anywhere and destroy the occupant
      let filteredSlots = [];
      if (utils.areAllSlotsFull(getGS(message)[fromPlayerNum].slots)) {
        filteredSlots = getGS(message)[fromPlayerNum].slots;
      } else {
        filteredSlots = getGS(message)[fromPlayerNum].slots
          .filter((slot, index) => {
            // if our target is an empty slot we can place
            if (!slot.content) {
              return true;
            } // Determine if we're dropping a Punk on a card that has a slot above, in which case we can push that card up
            else if (utils.isBottomRow(index)) {
              if (!getGS(message)[fromPlayerNum].slots[utils.indexAbove(index)].content) {
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
        ...utils.getContentFromSlots(getGS(message)[fromPlayerNum].slots),
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
    } else if (effectName === 'damageCard') {
      // Look for unprotected people AND camps
      return utils.getUnprotectedCards(message);
    }
  },

  determineOwnSlotTargets(message) {
    const playerNum = utils.getPlayerNumById(message.playerId);
    return getGS(message)[playerNum].slots
      .filter((slot) => {
        if (message.details?.card?.id) {
          return slot.content && slot.content.id !== message.details.card.id;
        } else {
          return slot.content;
        }
      })
      .map((slot) => String(slot.content.id));
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
    const opponentSlots = getGS(message)[opponentPlayerNum]?.slots;
    const opponentCamps = getGS(message)[opponentPlayerNum]?.camps;

    // Special case juuuuuuuust for High Ground event
    if (getGS(message).universal.highGround) {
      if (!params?.campsOnly) {
        unprotectedCardIds.push(...opponentSlots.filter((slot) => slot.content).map((slot) => String(slot.content.id)));
      }
      if (!params?.peopleOnly) {
        unprotectedCardIds.push(...opponentCamps.filter((camp) => !camp.isDestroyed).map((camp) => String(camp.id)));
      }
      return unprotectedCardIds;
    }

    for (let i = 0; i <= SLOT_NUM_ROWS; i++) {
      if (!params?.campsOnly && opponentSlots[i].content !== null) {
        unprotectedCardIds.push(String(opponentSlots[i].content.id));
      } else if (!params?.campsOnly && opponentSlots[i + SLOT_NUM_COLS].content !== null) {
        unprotectedCardIds.push(String(opponentSlots[i + SLOT_NUM_COLS].content.id));
      } else if (
        !params?.peopleOnly &&
        !opponentCamps[i].isDestroyed && utils.isColumnEmpty(message, i, opponentPlayerNum)
      ) {
        unprotectedCardIds.push(String(opponentCamps[i].id));
      }
    }
    return unprotectedCardIds;
  },

  areAllSlotsFull(slots) {
    return (slots ?? []).every((slot) => slot.content !== null);
  },

  getPlayerIdByNum(playerNum, playerIdForGS) {
    if (playerNum && playerIdForGS && getGS(playerIdForGS)) {
      return getGS(playerIdForGS)[playerNum].playerId;
    }
  },

  getPlayerNumById(playerId) {
    if (playerId && getGS(playerId)) {
      if (getGS(playerId).player1.playerId === playerId) return 'player1';
      else if (getGS(playerId).player2.playerId === playerId) return 'player2';
    }
  },

  getOpponentNumById(playerId) {
    return utils.getOppositePlayerNum(utils.getPlayerNumById(playerId));
  },

  getPlayerDataById(playerId) {
    if (playerId && getGS(playerId)) {
      if (getGS(playerId).player1.playerId === playerId) return getGS(playerId).player1;
      else if (getGS(playerId).player2.playerId === playerId) return getGS(playerId).player2;
    }
    return null;
  },

  isPlayersTurn(playerId) {
    return getGS(playerId).turn.currentPlayer && getGS(playerId).turn.currentPlayer === utils.getPlayerNumById(playerId);
  },

  /**
   * Check both player slots and both player camps for the passed card
   */
  findCardInGame(message, card) {
    return utils.findCardInSlots(message, card) || this.findCardInCamps(message, card);
  },

  findCardInCamps(message, card) {
    function findCardInPlayerCamps(card, playerNum) {
      const foundIndex = getGS(message)[playerNum].camps.findIndex((loopCamp) => {
        return loopCamp?.id === (typeof card.id === 'number' ? card.id : +card.id);
      });
      if (foundIndex !== -1) {
        return {
          cardObj: getGS(message)[playerNum].camps[foundIndex],
          playerNum,
        };
      }
    }

    return findCardInPlayerCamps(card, 'player1') || findCardInPlayerCamps(card, 'player2');
  },

  findCardInSlots(message, card) {
    function findCardInPlayerSlots(card, playerNum) {
      const slotIndex = getGS(message)[playerNum].slots.findIndex((loopSlot) => {
        return loopSlot?.content?.id === (typeof card.id === 'number' ? card.id : +card.id); // TODO Better consistent number typing throughout the whole app
      });
      if (slotIndex !== -1) {
        return {
          cardObj: getGS(message)[playerNum].slots[slotIndex].content,
          slotIndex,
          playerNum,
        };
      }
    }

    return findCardInPlayerSlots(card, 'player1') || findCardInPlayerSlots(card, 'player2');
  },

  makeWaterSiloCard() {
    return { id: 1, img: `water_silo${DECK_IMAGE_EXTENSION}`, cost: 1, junkEffect: 'gainWater', isWaterSilo: true };
  },

  convertCardToPunk(message, cardObj) {
    getGS(message).punks.push(structuredClone(cardObj));

    return {
      id: cardObj.id,
      img: 'punk.png',
      isPunk: true,
    };
  },

  convertPunkToCard(message, punkId) {
    if (!onClient) {
      const matchingPunkIndex = getGS(message).punks.findIndex((punk) => punkId === punk.id);
      if (matchingPunkIndex !== -1) {
        return getGS(message).punks.splice(matchingPunkIndex, 1)[0];
      }
    }
    return null;
  },

  getRaidersEvent() {
    return { isRaid: true, img: 'raiders.png', cost: 0, startSpace: 2, abilityEffect: 'doRaid' };
  },

  playerHasPunk(playerId) {
    if (playerId && utils.getPlayerNumById(playerId)) {
      const slots = getGS(playerId)[utils.getPlayerNumById(playerId)].slots;
      if (slots) {
        return slots.some((slot) => slot.content?.isPunk);
      }
    }
    return false;
  },

  markAllSlotsReady(message) {
    // Set all cards to ready state
    [...getGS(message).player1.slots, ...getGS(message).player2.slots].forEach((slot) => {
      if (slot.content) {
        delete slot.content.unReady;
      }
    });
    [...getGS(message).player1.events, ...getGS(message).player2.events].forEach((event) => {
      if (event) {
        delete event.unReady;
      }
    });
  },

  shuffleDeck(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  drawFromDeck(message) {
    if (onClient) {
      return null;
    }

    let toReturn = null;
    const cachedGS = getGS(message);

    if (cachedGS.deck.length >= 1) {
      toReturn = cachedGS.deck.shift();
    }
    // Per the rules if we have an empty deck we reshuffle ONCE. Then if we need to reshuffle again the game is considered a Draw/Tie
    if (cachedGS.deck.length <= 0) {
      cachedGS.deckReshuffleCount++;

      if (cachedGS.deckReshuffleCount >= 2) {
        // TODO Actual handling of the draw/tie from a double reshuffle - very rare, but worth covering
        action.sendError('Game is a tie! (Had to reshuffle the draw deck twice)');
        return null;
      }
      // Can't imagine a legitimate situation where the draw deck has run out and there are no discards
      if (cachedGS.discard.length <= 0) {
        action.sendError('Game is a tie! (Had to reshuffle the draw deck, but there are no discards)');
        return null;
      }

      // TODO Better UI handling of reshuffling - block UI interaction (dialog?), play an animation, etc.
      const reshuffledDeck = utils.shuffleDeck(cachedGS.discard);
      cachedGS.deck = reshuffledDeck;
      cachedGS.deckCount = cachedGS.deck.length;
      cachedGS.discard = [];
      cachedGS.discardCount = 0;

      action.sync(null, { gsMessage: message });

      action.sendError('Reshuffled the draw deck');
      toReturn = cachedGS.deck.shift();
    }

    return toReturn;
  },

  returnCardToHand(playerId, cardId) {
    if (!playerId || !cardId) {
      return false;
    }

    const foundCard = utils.findCardInGame(playerId, { id: cardId });
    if (!foundCard?.cardObj) {
      return false;
    }

    // If we're a Punk convert to the actual card (was hidden information before)
    if (foundCard.cardObj.isPunk) {
      foundCard.cardObj = utils.convertPunkToCard(playerId, foundCard.cardObj.id);
    }

    const playerData = utils.getPlayerDataById(playerId);
    if (playerData) {
      delete foundCard.cardObj.damage; // Clear any damage when going into the hand

      playerData.cards.push(foundCard.cardObj);
      if (foundCard.slotIndex !== -1) {
        playerData.slots[foundCard.slotIndex].content = null;
      }
    }
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

  cardIsEvent(card) {
    return typeof card?.startSpace === 'number';
  },

  cardIsCamp(card) {
    return typeof card?.drawCount === 'number';
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
  isColumnEmpty(message, columnIndex, playerNum) {
    const slots = utils.getSlotsInColumn(message, columnIndex, playerNum);
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
  getSlotsInColumn(message, columnIndex, playerNum) {
    if (columnIndex < 0 || columnIndex > 2) {
      console.error('Invalid column index requested', columnIndex);
      throw new Error('Invalid column index requested - must be between 0-2');
    }

    const slotsInColumn = [];
    for (let rowIndex = 0; rowIndex < SLOT_NUM_ROWS; rowIndex++) {
      const slotIndex = columnIndex + rowIndex * SLOT_NUM_COLS;
      slotsInColumn.push(getGS(message)[playerNum].slots[slotIndex]);
    }
    return slotsInColumn;
  },

  performNav(page) {
    if (onClient) {
      window.location.href = page;
    }
  },
};

const ai = {
  checkAndHandleAITurn(message, params) { // params.fromServerRequest: boolean, params.isFirstTurn: boolean true if this is the first turn
    // TODO Better AI at some magical point in the future?
    if (message.playerId === AI_PLAYER_ID) {
      const aiData = utils.getPlayerDataById(message.playerId);

      aiData.waterCount = 20; // Make sure we can get plenty of cards out - makes for easier targetting even if we break the rules

      if (params?.isFirstTurn) {
        aiData.cards.forEach((card, index) => {
          action.playCard({
            type: 'playCard',
            playerId: message.playerId,
            details: {
              card: card,
              slot: {
                index: index,
              },
            },
          });
        });
      } else if (Math.random() >= 0.2) { // In MOST cases play a card
        if (aiData.cards.length) {
          const tryToPlay = aiData.cards[0];

          const toSend = {
            type: 'playCard',
            playerId: message.playerId,
            details: {
              card: tryToPlay,
            },
          };

          if (utils.cardIsEvent(tryToPlay)) {
            action.playCard(toSend);
          } else {
            let nextFreeSlot = aiData.slots.findIndex((slot) => !slot.content);

            // If we DON'T have a free slot just replace a random card
            if (nextFreeSlot === -1) {
              nextFreeSlot = utils.randomRange(0, SLOT_NUM_COLS * SLOT_NUM_ROWS);
            }

            toSend.details.slot = {
              index: nextFreeSlot,
            };
            action.playCard(toSend);
          }
        }
      }

      if (params?.isFirstTurn) {
        action.endTurn(message);
      } else {
        setTimeout(() => { // Trust me the computer is thinking - but primarily because just auto-having your next turn is too jaring
          action.endTurn(message);
        }, utils.randomRange(750, 1500));
      }
    }
  },
};

const codeQueue = {
  internalQueue: [], // Internal queue (FIFO) of server side code to execute, for complicated cards like Mutant
  skipPreprocess: false,

  add(trigger, funcToQueue) {
    if (typeof funcToQueue === 'function') {
      this.internalQueue.push({
        trigger: trigger,
        func: funcToQueue,
      });
    }
  },

  start(params) { // params.skipPreprocess: boolean to skip preprocess until the code queue is empty. For out of turn actions, like Vanguard
    if (!onClient) {
      if (params?.skipPreprocess) {
        this.skipPreprocess = true;
      }

      // This will fire the action proxy handlers, which will ensure the queue is stepped through
      action.wait();
    }
  },

  step(justCalledName) {
    if (!onClient) {
      if (this.internalQueue?.length) {
        const nextItem = this.internalQueue[0];
        if (!nextItem?.trigger || nextItem.trigger === justCalledName) {
          this.internalQueue.shift(); // Actually remove from the queue

          try {
            nextItem.func();
          } catch (err) {
            console.error(
              `Error when executing a step of the code queue. Trigger=${nextItem.trigger}, Func=${nextItem.func}`,
              err,
            );
          }

          // If we're done our current queue reset the skipPreprocess flag
          if (this.internalQueue.length === 0) {
            this.skipPreprocess = false;
          }
        }
      }
    }
  },
};

if (onClient) {
  window.utils = utils;
  window.ai = ai;
  window.codeQueue = codeQueue;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { ai, codeQueue, utils };
