import { abilities } from './abilities.mjs';
import { events } from './events.mjs';
import { gs } from './gamestate.mjs';
import { codeQueue, utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

const raidersEvent = { isRaid: true, img: 'raiders.png', cost: 0, startSpace: 2, abilityEffect: 'doRaid' };
const undoStack = []; // Stack (LIFO) of gs we can undo back to
let discardCardTimer;

const rawAction = {
  joinGame(message) {
    if (onClient) {
      sendC('joinGame', message);
    } else {
      /* TODO TEMPORARY For now it's annoying to check if a player already joined for our playerNum, as refreshing our page currently would trigger this
                        Because we don't have proper leaving and rejoining support yet. So for now just count each request as valid... */
      if (!DEBUG_TESTING_PLAYERS) {
        const desiredPlayer = message.details.player;
        if (gs[desiredPlayer] && (!gs[desiredPlayer].playerId || gs[desiredPlayer].playerId === message.playerId)) {
          gs[desiredPlayer].playerId = message.playerId;
        } else {
          return action.sendError('Invalid join request or someone already playing', message.playerId);
        }
      }

      gs[message.details.player].playerId = message.playerId;

      sendS('setPlayer', message.details, message.playerId);

      // Draw our initial set of camps to choose from
      action.sync(message.playerId, { includeChat: true });
      action.promptCamps(message);

      if (DEBUG_AUTO_OPPONENT) {
        const autoPlayerId = 'autoOpponent';
        if (!utils.getPlayerNumById(autoPlayerId)) {
          // Autojoin the game
          action.joinGame({
            type: 'joinGame',
            playerId: autoPlayerId,
            details: {
              player: utils.getOppositePlayerNum(message.details.player),
            },
          });

          utils.sleep(500);

          // Autochoose our camps too
          const campOptions = gs.campDeck.splice(0, 3);
          utils.getPlayerDataById(autoPlayerId).camps = campOptions;
          action.doneCamps({
            type: 'doneCamps',
            playerId: autoPlayerId,
            details: {
              camps: campOptions,
              debugDrawAutoOpponent: true,
            },
          });

          utils.sleep(500);

          // Autostart the opponent turn
          action.startTurn({
            type: 'startTurn',
            playerId: autoPlayerId,
          });

          utils.sleep(500);

          // Play some random cards on the board as easy targets
          utils.getPlayerDataById(autoPlayerId).waterCount = 20; // Make sure we can get plenty of cards out
          utils.getPlayerDataById(autoPlayerId).cards.forEach((card, index) => {
            action.playCard({
              type: 'playCard',
              playerId: autoPlayerId,
              details: {
                card: card,
                slot: {
                  index: index,
                },
              },
            });
          });

          utils.sleep(500);

          // End our turn so the human can just go
          action.endTurn({
            type: 'endTurn',
            playerId: autoPlayerId,
          });
        }
      }
    }
  },

  startTurn(message) {
    if (onClient) {
      sendC('startTurn');
    } else {
      // Don't allow starting the game until an opponent is present
      if (!DEBUG_TESTING_PLAYERS) {
        if (!gs.player1.playerId || !gs.player2.playerId) {
          action.sendError('Cannot start the turn, no opponent yet', message.playerId);
          return;
        }
      }

      const nextPlayerNum = utils.getPlayerNumById(message.playerId);
      gs[nextPlayerNum].waterCount = TURN_WATER_COUNT;
      gs.turn[nextPlayerNum].turnCount++;
      gs.turn.currentPlayer = nextPlayerNum;

      // Reset ready state of cards, then apply for our damaged cards
      utils.markAllSlotsReady();
      gs[nextPlayerNum].slots.forEach((slot) => {
        if (slot.content) {
          if (slot.content.damage > 0) {
            slot.content.unReady = true;
          } else {
            delete slot.content.unReady;
          }
        }
      });

      // Handle Event queue moving forward on start of turn, plus triggering any effects
      const eventQueue = gs[nextPlayerNum].events;
      for (let i = 0; i < eventQueue.length; i++) {
        eventQueue[i] = eventQueue[i + 1];
      }

      // If an event just came off the queue (aka is at index 0) we trigger it
      if (eventQueue[0]) {
        action.triggerEvent({
          playerId: message.playerId,
          details: {
            card: structuredClone(eventQueue[0]),
          },
        });
        eventQueue[0] = undefined;
      }

      action.drawCard(message, { fromServerRequest: true });
      action.sync();
    }
  },

  endTurn(message) {
    if (onClient) {
      sendC('endTurn');
    } else {
      utils.clearUniversal();
      utils.markAllSlotsReady();

      const currentPlayerNum = utils.getPlayerNumById(message.playerId);
      const nextPlayerNum = utils.getOppositePlayerNum(currentPlayerNum);
      const nextPlayerId = utils.getPlayerIdByNum(nextPlayerNum);

      if (nextPlayerId) {
        gs.turn.currentPlayer = nextPlayerNum;
        action.startTurn({
          playerId: nextPlayerId,
        });
        action.sync(); // For applying the reset of slot ready state
      } else {
        action.sendError('No opponent yet', message.playerId);
        return;
      }
    }
  },

  undo(message) {
    if (onClient) {
      sendC('undo');
    } else {
      if (undoStack.length > 0) {
        Object.assign(gs, undoStack.pop());
        action.sync();
      }
    }
  },

  playCard(message) {
    if (onClient) {
      sendC('playCard', message);
    } else {
      // Abort if we're playing a Water Silo onto the board haha
      if (message.details.card.isWaterSilo) {
        return;
      }

      const waterCost = message.details.card.cost || 0;
      if (waterCost > utils.getPlayerDataById(message.playerId).waterCount) {
        action.sendError('Not enough Water to play that card', message.playerId);
        return;
      }

      // Now we split our behaviour, but keep this a long winded function instead of breaking it up
      // Either we're an event and we need to manage our queue, or we're into a slot and need to adjust the board
      if (utils.cardIsEvent(message.details.card)) {
        let targetSpace = message.details.card.startSpace;
        const eventQueue = gs[utils.getPlayerNumById(message.playerId)].events;

        // If our event is space 0 we just do the effect immediately
        if (targetSpace === 0) {
          action.triggerEvent(message);
        } else {
          // Normally just place in startSpace
          // If that is full, try the one behind it, and so on until either we find an empty space or are outside the queue (and can't play the card)
          for (let i = targetSpace; i <= eventQueue.length; i++) {
            targetSpace = i;
            if (!eventQueue[i]) { // Found an empty space
              break;
            }
          }
        }

        if (targetSpace >= eventQueue.length) {
          action.sendError('No empty space for this Event', message.playerId);
          return;
        }

        eventQueue.splice(targetSpace, 1, message.details.card);
        action.sync(); // TODO Could send a more targetted message to JUST update the event queue (like the 'slot' send below), but meh we've been pretty lax with the syncing cause it's so fast
      } else {
        // Determine if our column is full or other validity scenarios
        const playerSlots = gs[utils.getPlayerNumById(message.playerId)].slots;
        let targetSlot = playerSlots[message.details.slot.index];
        if (!utils.determineValidDropSlot(targetSlot, playerSlots)) {
          action.sendError('Invalid card position', message.playerId);
          return;
        }

        // Check if we're playing a card on a card that has an empty slot above - push other card up
        if (targetSlot.content && utils.isBottomRow(targetSlot.index)) {
          const slotAbove = playerSlots[utils.indexAbove(targetSlot.index)];
          if (!slotAbove.content) {
            slotAbove.content = structuredClone(targetSlot.content);
            targetSlot.content = null;

            // Send an extra slot message to notify a card was pushed
            sendS('slot', {
              playerNum: utils.getPlayerNumById(message.playerId),
              index: slotAbove.index,
              card: slotAbove.content,
            });
          }
        }

        // If we have content in our targetSlot still, that means we're trying to destroy and replace the card in question due to having ALL our slots filled
        // Instead of just nullifying the card (like we do when pushing a card up) we want to destroyCard it, so if it was a Punk it'll go in the deck properly
        if (targetSlot.content?.isPunk) {
          action.destroyPunk({
            ...message,
            details: {
              ...message.details,
              card: targetSlot.content,
            },
          });
          targetSlot.content = null;
        }

        // Check if we're playing a card with an empty slot below - drop card down to bottom row
        if (utils.isTopRow(targetSlot.index)) {
          const slotBelow = playerSlots[utils.indexBelow(targetSlot.index)];
          if (!slotBelow.content) {
            targetSlot = slotBelow;
          }
        }

        targetSlot.content = message.details.card;
        sendS('slot', {
          playerNum: utils.getPlayerNumById(message.playerId),
          index: targetSlot.index,
          card: message.details.card,
        });
      }

      action.reduceWater(message, waterCost);
      action.removeCard(message);
    }
  },

  useCard(message, userAbilityIndex) { // userAbilityIndex: optional array index of message.details.card.abilities for subsequent calls to this function
    if (onClient) {
      if (message.details.card.abilities?.length) {
        if (typeof userAbilityIndex !== 'number' && message.details.card.abilities?.length > 1) {
          // Before showing a choice determine if we even have enough water to use any ability
          // The backend still validates, but we want to avoid showing a dialog that has no point on the client
          if (message.details.card.abilities.some((ability) => (ability.cost <= getPlayerData()?.waterCount))) {
            showAbilityChooserDialog(message.details.card);
            return;
          }
        }

        // Track what ability we're using on the card
        message.details.card.chosenAbilityIndex = typeof userAbilityIndex === 'number' ? userAbilityIndex : 0;

        sendC('useCard', message.details);
      }
    } else {
      // Check if card is ready before trying to use a card ability
      if (message.details?.card?.unReady) { // TODO General validation that we'll need to improve - in this case instead of trusting the client we'd use the card.id to check our server gs and use the unReady from that version
        action.sendError('Card is not ready to be used', message.playerId);
        return;
      }

      let chosenAbilityIndex = 0;
      if (
        message.details?.card?.abilities?.length > 1 &&
        typeof message.details?.card?.chosenAbilityIndex === 'number'
      ) {
        chosenAbilityIndex = message.details.card.chosenAbilityIndex;
      }

      // Check for water validity before continuing
      const abilityObj = message.details.card.abilities[chosenAbilityIndex];
      if (abilityObj.cost > utils.getPlayerDataById(message.playerId).waterCount) {
        action.sendError('Not enough Water to use that ability', message.playerId);
        return;
      }

      // Use our chosen ability
      try {
        const returnStatus = utils.fireAbilityOrJunk(
          message,
          abilityObj.abilityEffect,
        );

        // If we aren't targetting, we can just mark the card not ready when it initiated the effect
        if (!gs.pendingTargetAction && returnStatus !== false) {
          action.reduceWater(message, abilityObj.cost);
        } else {
          action.sync(message.playerId);
        }
      } catch (err) {
        console.error('Error using ability', err);
        action.sendError(err?.message, message.playerId);
      }
    }
  },

  triggerEvent(message) {
    if (!onClient) {
      try {
        utils.fireAbilityOrJunk(
          message,
          message.details.card.abilityEffect,
        );
      } catch (err) {
        console.error('Error using event', err);
        action.sendError(err?.message, message.playerId);
      }
    }
  },

  gainWater(message) {
    if (!onClient) {
      const playerData = utils.getPlayerDataById(message.playerId);

      // Handle if we're junking the Water Silo
      if (message.details.card.isWaterSilo) {
        const foundIndex = playerData.cards.findIndex((card) => card.isWaterSilo);

        if (!playerData.hasWaterSilo || foundIndex === -1) {
          action.sendError('No Water Silo taken to junk', message.playerId);
          return false;
        }

        playerData.cards.splice(foundIndex, 1);
        playerData.hasWaterSilo = false;
        action.sync();
      }

      playerData.waterCount += 1;

      sendS('gainWater', message.playerId);
    }
  },

  reduceWater(message, overrideCost, params) { // params.ignoreUnready: boolean true for draw card, silo, etc. where we don't need to mark the card as not ready
    if (!onClient) {
      const waterCost = overrideCost ?? message.details.cost;

      // Manage our ready state, specifically around cost
      if (!params?.ignoreUnready && message.details.card) {
        const card = utils.findCardInGame(message.details.card);
        if (card?.cardObj && !utils.cardIsEvent(card?.cardObj)) {
          card.cardObj.unReady = true;
          card.cardObj.unReadyCost = waterCost;
          action.sync(); // Needed for the unReady to apply
        }
      }

      // Only bother sending if water is actually going to change
      if (waterCost > 0) {
        utils.getPlayerDataById(message.playerId).waterCount -= waterCost;

        sendS('reduceWater', {
          cost: waterCost,
        }, message.playerId);
      }
    }
  },

  removeCard(message) {
    if (!onClient) {
      const cards = utils.getPlayerDataById(message.playerId).cards;
      const foundIndex = cards.findIndex((card) => card.id === message.details.card.id);
      if (foundIndex !== -1) {
        cards.splice(foundIndex, 1);
      }

      action.sync(message.playerId);
    }
  },

  discardCard(message) {
    if (!onClient) {
      const cards = utils.getPlayerDataById(message.playerId).cards;
      const foundIndex = cards.findIndex((card) => card.id === message.details.card.id);
      if (foundIndex !== -1) {
        gs.discard.push(cards.splice(foundIndex, 1)[0]);

        // Sync on a timer, so that if we have multiple requests in a row we just sync once
        if (discardCardTimer) {
          clearTimeout(discardCardTimer);
        }
        discardCardTimer = setTimeout(() => {
          action.sync(message.playerId);
        }, 200);
      }
    }
  },

  drawCard(message, params) { // params.fromServerRequest: boolean
    if (onClient) {
      sendC('drawCard', message);
    } else {
      if (!params?.fromServerRequest && !utils.isPlayersTurn(message.playerId)) {
        return false;
      }

      if (message.details?.fromWater) {
        if (2 > utils.getPlayerDataById(message.playerId).waterCount) {
          action.sendError('Not enough Water to draw a card', message.playerId);
          return false;
        }

        action.reduceWater(message, 2, { ignoreUnready: true });
      }

      const newCard = utils.drawFromDeck();
      if (newCard) {
        // TODO Sort hand to have Water Silo at the front, then people, then events (and eventually a setting to toggle this option off)
        utils.getPlayerDataById(message.playerId).cards.push(newCard);

        const newMessage = {
          ...message.details,
          card: newCard,
          deckCount: gs.deck.length,
        };
        if (message.details?.fromWater || params?.fromServerRequest) {
          newMessage.showAnimation = true; // TODO Clean this flag up after use otherwise it'll be attached to the message / gamestate forever
        }

        sendS('addCard', newMessage, message.playerId);
      } else {
        action.sendError('No cards left to draw', message.playerId);
        return false;
      }
    }
  },

  junkCard(message) {
    if (onClient) {
      sendC('junkCard', message);
    } else {
      try {
        // TODO Check validity of junkEffect before processing, current options are: raid, drawCard, restoreCard, gainWater, damageCard, injurePerson, gainPunk - if only there was some...kind...of...typing system
        const returnStatus = utils.fireAbilityOrJunk(message, message?.details?.card?.junkEffect);

        // If we aren't targetting, we can just remove the card that initiated the junk effect now
        // Assuming of course our action was valid
        if (!gs.pendingTargetAction && returnStatus !== false) {
          // TODO Bit of a known issue - if you drawCard via a junk effect, then because of this sync the new card is added immediately on the UI, instead of waiting for the animation to complete. But if we don't sync in the removeCard call, the junked card will stay in our hand
          action.discardCard(message);
        } else {
          action.sync(message.playerId);
        }
        return returnStatus;
      } catch (err) {
        console.error('Error junking card', err);
        action.sendError(err?.message, message.playerId);
      }
    }
  },

  takeWaterSilo(message) {
    if (onClient) {
      sendC('takeWaterSilo');
    } else {
      const playerData = utils.getPlayerDataById(message.playerId);
      if (playerData.hasWaterSilo) {
        action.sendError('Already have Water Silo', message.playerId);
        return;
      } else if (playerData.waterCount < 1) {
        action.sendError('Not enough Water to take Water Silo', message.playerId);
        return;
      }

      // Consistently keep Water Silo at the front of your hand
      playerData.cards.unshift(utils.makeWaterSiloCard());
      playerData.hasWaterSilo = true;

      action.reduceWater(message, 1, { ignoreUnready: true });
      action.sync(message.playerId);
    }
  },

  gainPunk(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);

      if (targets?.length) {
        let newPunk = utils.drawFromDeck();
        if (!newPunk) {
          action.sendError('No cards left to draw', message.playerId);
          return false;
        }

        newPunk = utils.convertCardToPunk(newPunk);

        // Determine if we're putting our Punk in an empty slot OR dropping a Punk back to an empty slot below OR on a card that we push upwards OR replace entirely
        const targetId = targets[0];
        const playerSlots = gs[utils.getPlayerNumById(message.playerId)].slots;
        if (targetId.startsWith(SLOT_ID_PREFIX)) {
          const targetSlotIndex = parseInt(targetId.substring(SLOT_ID_PREFIX.length));

          if (utils.isTopRow(targetSlotIndex)) {
            const slotBelow = playerSlots[utils.indexBelow(targetSlotIndex)];
            if (!slotBelow.content) {
              slotBelow.content = newPunk;
              action.sync();
              return;
            }
          }

          playerSlots[targetSlotIndex].content = newPunk;
          action.sync();
        } else {
          const inTargetSlot = utils.findCardInGame({ id: targetId });

          // If all our slots are full replace the card in our slot
          // Obviously if that is also a Punk we return it to the deck properly
          if (utils.areAllSlotsFull(playerSlots)) {
            if (inTargetSlot.cardObj.isPunk) {
              action.destroyPunk({
                ...message,
                details: {
                  ...message.details,
                  card: inTargetSlot.cardObj,
                },
              });
            }
          } // Otherwise we placed to push the current card upwards
          else {
            playerSlots[utils.indexAbove(inTargetSlot.slotIndex)].content = inTargetSlot.cardObj;
          }

          // And add the new punk
          playerSlots[inTargetSlot.slotIndex].content = newPunk;
          action.sync();
        }
      } else {
        action.targetMode(message, { help: 'Choose a slot to put your Punk in', colorType: 'variant', hideCancel: true });
      }
    }
  },

  raid(message) {
    if (!onClient) {
      // If we have raiders in play advance them a space
      const playerEvents = utils.getPlayerDataById(message.playerId)?.events;
      let existingRaidersIndex = playerEvents?.findIndex((event) => event?.isRaid);

      if (existingRaidersIndex > 0) {
        if (!playerEvents[existingRaidersIndex - 1]) {
          playerEvents[existingRaidersIndex - 1] = playerEvents[existingRaidersIndex];
          playerEvents[existingRaidersIndex] = undefined;
          existingRaidersIndex--;
        } else {
          action.sendError('Cannot advance Raiders, next event queue spot is full');
          return false;
        }

        if (existingRaidersIndex === 0) {
          // Queue here to ensure we finish our potential junk (that started this raid) before targetting
          const toTrigger = structuredClone(playerEvents[0]);
          codeQueue.add('sync', () =>
            action.triggerEvent({
              playerId: message.playerId,
              details: {
                card: toTrigger,
              },
            }));
          playerEvents[0] = undefined;
        } else {
          action.sync();
        }
      } else {
        action.playCard({
          ...message,
          details: {
            card: raidersEvent,
          },
        });
      }
      return true;
    }
  },

  doRaid(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.doDamageCard({ ...message, details: { card: { id: targetId } } });
        });
      } else {
        const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        const opponentPlayerId = utils.getPlayerIdByNum(opponentPlayerNum);
        const opponentCamps = gs[opponentPlayerNum]?.camps;

        // We use a queue here even though it's a single action specifically to skip preprocessing so we can do the out of turn opponent choice
        message.validTargets = opponentCamps.filter((camp) => !camp.isDestroyed).map((camp) => String(camp.id));
        message.playerId = opponentPlayerId;
        codeQueue.add(null, () =>
          action.targetMode(message, {
            help: 'Raiders hit! Choose your camp to damage',
            cursor: 'damageCard',
            colorType: 'danger',
            hideCancel: true,
          }));
        codeQueue.add('doneTargets', () => action.wait());
        codeQueue.start({ skipPreprocess: true });
      }
    }
  },

  injurePerson(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.doDamageCard({ ...message, details: { card: { id: targetId } } });
        });
      } else {
        action.targetMode(message, { help: 'Select an unprotected person to Injure', colorType: 'danger' });
      }
    }
  },

  // Target a card for damage, then doDamageCard to it once valid
  damageCard(message, helpTextOverride) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.doDamageCard({ ...message, details: { card: { id: targetId } } });
        });
        return true;
      } else {
        // If we don't have validTargets, which can happen from an ability not an action, just set them
        if (!message.validTargets) {
          message.validTargets = utils.getUnprotectedCards(message);
        }

        action.targetMode(message, {
          help: helpTextOverride ?? 'Select an unprotected person or camp to damage',
          colorType: 'danger',
        });
      }
    }
  },

  // Directly damage the passed message.details.card (normally meant to be called through damageCard for targetting first)
  doDamageCard(message) {
    if (!onClient) {
      const { cardObj } = utils.findCardInGame(message.details.card);
      if (cardObj) {
        cardObj.damage = (cardObj.damage ?? 0) + (message.details.amount ?? 1);

        if (
          (cardObj.isPunk && cardObj.damage >= 1) ||
          cardObj.damage >= 2
        ) {
          action.destroyCard(message);
        } else {
          action.sync();
        }
      }

      // TODO Send a separate message to request for injure and damage animations (explosions?) on the client
    }
  },

  destroyCard(message) {
    if (!onClient) {
      const foundRes = utils.findCardInGame(message.details.card);
      if (foundRes) {
        // TODO Play a destroy animation so the card being removed from the board is less abrupt
        if (typeof foundRes.slotIndex === 'number') {
          // Destroy our card
          const playerSlots = gs[foundRes.playerNum].slots;
          playerSlots[foundRes.slotIndex].content = null;

          // Check if we have a card above of our destroyed card, if we do, slide it down towards the camp
          if (!message.details.noSlideDown) {
            if (utils.isBottomRow(foundRes.slotIndex)) {
              const slotAbove = playerSlots[utils.indexAbove(foundRes.slotIndex)];
              if (slotAbove.content) {
                playerSlots[foundRes.slotIndex].content = structuredClone(slotAbove.content);
                playerSlots[foundRes.slotIndex].index = foundRes.slotIndex;
                slotAbove.content = null;
              }
            }
          }
        } else {
          foundRes.cardObj.isDestroyed = true;
        }

        // Check if we're going to destroy a Punk put the actual card back on top of the deck
        if (foundRes.cardObj.isPunk) {
          action.destroyPunk({
            ...message,
            details: {
              ...message.details,
              card: foundRes.cardObj,
            },
          });
        }

        action.sync();
      } else {
        action.sendError('Invalid target to destroy', message.playerId);
      }
    }
  },

  destroyPunk(message) {
    if (!onClient) {
      const cardObj = message.details.card;
      if (cardObj?.isPunk) {
        const matchingPunkIndex = gs.punks.findIndex((punk) => cardObj.id === punk.id);
        if (matchingPunkIndex !== -1) {
          gs.deck.unshift(gs.punks.splice(matchingPunkIndex, 1)[0]);
        }
      }
    }
  },

  restoreCard(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        try {
          targets.forEach((targetId) => {
            const { cardObj } = utils.findCardInGame({ id: +targetId }); // TODO Not in love with these bastardized objects instead of a pure `card`
            if (cardObj && typeof cardObj.damage === 'number') {
              // Slot and camp are handled similar, except we technically delete a non-existent flag on a slot (shrug)
              delete cardObj.isDestroyed;
              cardObj.damage = Math.min(0, cardObj.damage - 1);
              cardObj.unReady = true; // Mark card unReady after a restore

              action.sync(); // TODO Not ideal - restoreCard sync needed for Mutant because it directly calls fireAbilityOrJunk, whereas other approaches (like junkCard) naturally sync afterwards
            } else {
              action.sendError('No damage to Restore', message.playerId);
              throw new Error(); // Ditch if we didn't restore (would be an invalid target)
            }
          });
        } catch (ignored) {
          return false;
        }
      } else {
        action.targetMode(message, {
          help: 'Select a damaged card to restore and rotate. Note a person will not be ready this turn.',
          colorType: 'success',
        });
      }
    }
  },

  promptCamps(message) {
    if (!onClient) {
      let campOptions = utils.getPlayerDataById(message.playerId).camps;
      if (!campOptions || campOptions.length === 0) {
        campOptions = gs.campDeck.splice(0, 6);
        utils.getPlayerDataById(message.playerId).camps = campOptions;
      }

      if (campOptions.length !== CORRECT_CAMP_NUM) {
        sendS('promptCamps', {
          camps: campOptions,
        }, message.playerId);
      } else {
        action.sync(message.playerId);
      }
    }
  },

  doneCamps(message) {
    if (onClient) {
      sendC('doneCamps', message);
    } else {
      // Validate that we have the right number of camps and they were valid choices (in the case of malicious use)
      const playerData = utils.getPlayerDataById(message.playerId);
      if (message?.details?.camps?.length !== CORRECT_CAMP_NUM) {
        action.sendError(`Select ${CORRECT_CAMP_NUM} camps`, message.playerId);
        return;
      }
      const incomingCampIds = message.details.camps.map((camp) => camp.id);
      if (playerData.camps.filter((camp) => incomingCampIds.includes(camp.id)).length !== CORRECT_CAMP_NUM) {
        action.sendError('Invalid camp selections', message.playerId);
        return;
      }

      playerData.camps = message.details.camps;
      playerData.doneCamps = true;

      let totalDrawCount = message.details.camps.reduce((total, camp) => total + camp.drawCount, 0); // TODO DEBUG Should be a const and remove the DEBUG_DRAW_SO_MANY_CARDS
      totalDrawCount = DEBUG_DRAW_SO_MANY_CARDS > 0 ? DEBUG_DRAW_SO_MANY_CARDS : totalDrawCount;

      if (DEBUG_AUTO_OPPONENT && message.details.debugDrawAutoOpponent) {
        totalDrawCount = DEBUG_AUTO_OPPONENT_DRAW;
      }

      for (let i = 0; i < totalDrawCount; i++) {
        action.drawCard({
          ...message,
          details: {
            multiAnimation: totalDrawCount > 1,
          },
        }, { fromServerRequest: true });
      }

      action.sync();
    }
  },

  sendError(text, playerId) {
    function sendErrorChat(text, playerId) {
      action.chat({ details: { text: text } }, { playerId: playerId, fromServerRequest: true });
    }

    if (!onClient) {
      if (playerId) {
        console.error(`Send Error (to ${playerId}):`, text);
        sendErrorChat(text, playerId);
      } else {
        sendErrorChat(text, gs.player1.playerId);
        sendErrorChat(text, gs.player2.playerId);
      }
    } else {
      console.error(text);
    }
  },

  dumpDebug() {
    const now = new Date().toLocaleTimeString();
    if (onClient) {
      console.log(now + ': DUMP: Client UI', ui);
      console.table(ui);
      console.log(now + ': DUMP: Gamestate', gs);
      console.table(gs);
      sendC('dumpDebug');
    } else {
      console.log(now + ': DUMP: Gamestate', gs);
      console.log(now + ': DUMP done');
    }
  },

  chat(message, params) { // params.fromServerRequest: boolean, params.playerId: string
    if (onClient) {
      sendC('chat', message);
    } else {
      // TODO Don't blindly append chat messages - validate first
      let text = null;
      if (params?.fromServerRequest) {
        // TODO Have the concept of a System level message too, maybe special formatting on the client. SYS (general stuff like start turn) and ERR (error)?
        text = 'SYS';
      } else {
        text = utils.getPlayerNumById(message.playerId);
      }
      text += ': ' + message.details.text;

      if (text) {
        if (!params?.playerId) {
          gs.chat.push(text);
        }

        sendS('chat', { text: text }, params?.playerId ?? null);
      }
    }
  },

  targetMode(message, params) { // message has playerId, type. params has help, colorType, cursor (optional), expectedTargetCount (optional, default 1)
    if (!onClient) {
      gs.pendingTargetAction = structuredClone(message);
      gs.pendingTargetCancellable = !params.hideCancel;
      const toSend = {
        playerId: message.playerId,
        type: message.type,
        help: params.help ?? '',
        cursor: params.cursor ?? '',
        colorType: params.colorType ?? 'accent',
        expectedTargetCount: params.expectedTargetCount ?? 1,
        validTargets: message.validTargets?.filter((target) => target && target !== null),
        hideCancel: params.hideCancel ?? false,
      };

      sendS('targetMode', toSend, message.playerId);
    }
  },

  cancelTarget(message) {
    if (onClient) {
      sendC('cancelTarget', message);
    } else {
      if (gs.pendingTargetAction) {
        // Protect against malicious attempts to cancel an uncancellable target
        if (!gs.pendingTargetCancellable) {
          action.sendError('Cannot cancel target mode', message.playerId);
          return;
        }

        gs.pendingTargetAction = null;
        sendS('cancelTarget', {}, message.playerId);
      } else {
        action.sendError('Not in target mode', message.playerId);
      }
    }
  },

  doneTargets(message) {
    if (onClient) {
      sendC('doneTargets', message);
    } else if (message?.details?.targets) {
      try {
        const pendingFunc = events[gs.pendingTargetAction?.type] || abilities[gs.pendingTargetAction?.type] ||
          action[gs.pendingTargetAction?.type];
        if (typeof pendingFunc === 'function') {
          // Bit of a complicated one, but gs.pendingTargetAction USED to be reset at the bottom of this function
          // The problem is with the codeQueue there is a chance we trigger a new action code path in the proxy handler
          // Which might want to set the target action - so clearing it at the end here (as we did before)
          //  would interrupt and mess with that ordering
          const pendingTargetActionClone = structuredClone(gs.pendingTargetAction);
          gs.pendingTargetAction = null;

          const returnStatus = pendingFunc({
            ...message,
            validTargets: pendingTargetActionClone.validTargets,
          });

          if (pendingTargetActionClone.details?.card && returnStatus !== false) {
            if (utils.cardIsEvent(pendingTargetActionClone.details?.card)) {
              // No extra handling needed for a triggered event
            } // TODO Probably clean up this flag reliance?
            // If we don't have a chosenAbilityIndex that means we junked and should discard
            else if (typeof pendingTargetActionClone.details?.card?.chosenAbilityIndex !== 'number') {
              action.discardCard(pendingTargetActionClone);
            } // Otherwise reduce the water cost of a used ability from a played card
            else {
              const abilityObj =
                pendingTargetActionClone.details.card.abilities[pendingTargetActionClone.details.card.chosenAbilityIndex];
              action.reduceWater(pendingTargetActionClone, abilityObj.cost);
            }
          }
        } else {
          console.error('Unknown pendingTargetAction type', gs.pendingTargetAction);
          throw new Error();
        }
      } catch (err) {
        console.error('Unknown target action', err);
        action.sendError('Unknown target action', message.playerId);
      }
    }
  },

  sync(playerIdOrNullForBoth, params) { // params.includeChat (default false)
    /* Dev notes: when to sync vs not
     Syncing is marginally more expensive both in terms of processing and variable allocation here, and Websocket message size going to the client
     But that's also a huge worry about premature optimization given that a realistic game state is still under 5kb
     The best time to sync is if we're doing basically the same calculations on the client and server (which we want to avoid - duplication sucks),
      such as determining which card was damaged
     In most cases after a state change we can just call sync followed by a separate message if the UI needs to trigger some animation (like drawing
      a card or destroying a camp)
     A sync is overkill if we're literally just updating a single property on our client gamestate, such as myPlayerNum, with no additional logic done
    */
    // TODO Could just call sync as a post-process feature of the actionHandler instead of scattering it throughout the app? - especially if optimized (maybe do a JSON-diff and just return changes?). Might be easier to throttle these calls too so double calling doesn't matter (besides different params I guess...)
    // TODO Need to throttle/batch syncs, for example junking a card fires 4 (at time of comment) - wait a few milliseconds and take the last sync to execute

    function internalSync(playerNum) {
      const currentPlayerId = utils.getPlayerIdByNum(playerNum);
      if (!currentPlayerId) {
        return;
      }

      const updatedGs = structuredClone(gs);
      const opponentNum = utils.getOppositePlayerNum(playerNum);

      updatedGs.deckCount = updatedGs.deck.length;
      updatedGs.discardCount = updatedGs.discard.length;

      // Send a minimal version of our current server game state that the UI can apply to itself
      // TODO Could further trim down minor packet size savings like delete slot.content if null, etc. - do this all once the format is finalized
      delete updatedGs[playerNum].playerId;
      delete updatedGs.myPlayerNum;
      delete updatedGs.opponentPlayerNum;
      delete updatedGs.campDeck;
      delete updatedGs.deck;
      delete updatedGs.discard;
      delete updatedGs.punks;
      delete updatedGs.pendingTargetAction;
      delete updatedGs.pendingTargetCancellable;

      if (!params?.includeChat) {
        delete updatedGs.chat;
      }

      // Strip out any sensitive information from the opponent
      const { [opponentNum]: opponentData } = updatedGs;
      opponentData.cards = Array.from({ length: opponentData.cards.length }, (_, index) => index * -1); // Just fill with numbered junk, but negative in case this ever gets looped over looking for IDs
      if (!opponentData.doneCamps) {
        opponentData.camps = [];
      }
      delete opponentData.playerId;
      updatedGs[opponentNum] = opponentData;

      sendS('sync', {
        gs: updatedGs,
      }, currentPlayerId);
    }

    // Request a sync to both if no ID was specified, as per the wordily named variable implies
    if (!playerIdOrNullForBoth) {
      internalSync('player1');
      internalSync('player2');
    } else {
      internalSync(utils.getPlayerNumById(playerIdOrNullForBoth));
    }
  },

  wait() {
    // Spoiler, wait doesn't do anything, it more nebulously just ensures the actionHandler pre and post process is done
  },
};

// Certain actions can be done outside of our turn, which means skipping the preprocessor
rawAction.joinGame.skipPreprocess = true;
rawAction.promptCamps.skipPreprocess = true;
rawAction.doneCamps.skipPreprocess = true;
rawAction.startTurn.skipPreprocess = true;
rawAction.drawCard.skipPreprocess = true;
rawAction.dumpDebug.skipPreprocess = true;
rawAction.sendError.skipPreprocess = true;
rawAction.chat.skipPreprocess = true;
rawAction.sync.skipPreprocess = true;
rawAction.wait.skipPreprocess = true;

// Certain actions can be Undone - basically anything that doesn't reveal new information (such as drawing cards)
rawAction.playCard.recordUndo = true;
rawAction.junkCard.recordUndo = true;
rawAction.useCard.recordUndo = true;
rawAction.takeWaterSilo.recordUndo = true;

// Certain actions also clear the undo queue
rawAction.joinGame.clearUndo = true;
rawAction.promptCamps.clearUndo = true;
rawAction.doneCamps.clearUndo = true;
rawAction.triggerEvent.recordUndo = true;
rawAction.startTurn.clearUndo = true;
rawAction.endTurn.clearUndo = true;
rawAction.drawCard.clearUndo = true;

const actionHandler = {
  manageUndo(originalMethod, beforeGS) {
    if (!onClient) {
      if (originalMethod?.recordUndo) {
        undoStack.push(beforeGS);
      }
      if (originalMethod?.clearUndo) {
        undoStack.length = 0;
      }
    }
  },
  get(allActions, requestedAction) {
    const originalMethod = allActions[requestedAction];
    if (typeof originalMethod === 'function') {
      if (!onClient) {
        console.log('...action=' + requestedAction);
      }

      return function (...args) {
        const applyOriginalMethod = (originalMethod, context, args) => {
          const beforeGS = JSON.parse(JSON.stringify(gs));
          actionHandler.manageUndo(originalMethod, beforeGS);
          const res = originalMethod.apply(context, args);
          codeQueue.step(requestedAction);
          return res;
        };

        // If our action or current code queue skips the preprocess just execute the function now
        if (originalMethod?.skipPreprocess || codeQueue.skipPreprocess) {
          return applyOriginalMethod(originalMethod, this, args);
        }

        // PRE PROCESS hook for all actions
        if (!onClient && !utils.isPlayersTurn(args[0].playerId)) {
          console.error(`Ignored action [${originalMethod.name}] out of turn order by playerId=${args[0].playerId}`);
          action.sendError('Not your turn', args[0].playerId);
          return;
        }

        return applyOriginalMethod(originalMethod, this, args);
      };
    }

    return originalMethod;
  },
};

const action = new Proxy(rawAction, actionHandler);

if (onClient) {
  window.action = action;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { action };
