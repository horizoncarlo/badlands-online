import { abilities } from './abilities.mjs';
import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

const undoQueue = [];

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
          for (let i = 0; i < 4; i++) {
            action.playCard({
              type: 'playCard',
              playerId: autoPlayerId,
              details: {
                card: utils.getPlayerDataById(autoPlayerId).cards[0],
                slot: {
                  index: i,
                },
              },
            });
          }

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

      action.drawCard(message, { fromServerRequest: true });

      action.sync(); // Sync to update turn status
    }
  },

  endTurn(message) {
    if (onClient) {
      sendC('endTurn');
    } else {
      const nextPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const nextPlayerId = utils.getPlayerIdByNum(nextPlayerNum);

      if (nextPlayerId) {
        gs.turn.currentPlayer = nextPlayerNum;
        action.startTurn({
          playerId: nextPlayerId,
        });
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
      if (undoQueue.length > 0) {
        Object.assign(gs, undoQueue.pop());
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

      // Determine if our column is full or other validity scenarios
      const playerSlots = gs.slots[utils.getPlayerNumById(message.playerId)];
      let targetSlot = playerSlots[message.details.slot.index];
      if (!utils.determineValidDropSlot(targetSlot, playerSlots)) {
        action.sendError('Invalid card position');
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

      action.reduceWater(message, waterCost);
      action.removeCard(message);
    }
  },

  useCard(message, userAbilityIndex) { // userAbilityIndex: optional array index of message.details.card.abilities for subsequent calls to this function
    if (onClient) {
      if (message.card.abilities?.length) {
        // TTODO If we have multiple abilities prompt the user with a dialog choice on which to use - see Rabble Rouser as an example. For now just use our first ability
        if (message.card.abilities?.length > 1) {
          alert('TODO Prompt to choose ability to use');
        }

        // Track what ability we're using on the card
        message.card.chosenAbilityIndex = typeof userAbilityIndex === 'number' ? userAbilityIndex : 0;

        sendC('useCard', message);
      } else {
        action.sendError('TODO Ability not available or implemented yet');
      }
    } else {
      // TTODO Check if card is ready before trying to use a card ability
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
        action.sendError('Not enough Water to use that ability');
        return;
      }

      // Use our chosen ability
      try {
        const returnStatus = utils.fireAbilityOrJunk(
          message,
          abilityObj.abilityEffect,
        );

        // If we aren't targetting, we can just mark the card unready that initiated the effect
        if (!gs.pendingTargetAction && returnStatus !== false) {
          // TTODO Mark a used card unready

          action.reduceWater(message, abilityObj.cost);
        } else {
          action.sync(message.playerId);
        }
      } catch (err) {
        action.sendError(err?.message, message.playerId);
      }
    }
  },

  gainWater(message) {
    if (!onClient) {
      const playerData = utils.getPlayerDataById(message.playerId);

      // Handle if we're junking the water silo
      if (message.details.card.isWaterSilo) {
        const foundIndex = playerData.cards.findIndex((card) => card.isWaterSilo);

        if (!playerData.hasWaterSilo || foundIndex === -1) {
          action.sendError('No Water Silo taken to junk');
          return false;
        }

        playerData.cards.splice(foundIndex, 1);
        playerData.hasWaterSilo = false;
      }

      playerData.waterCount += 1;

      sendS('gainWater', message.playerId);
    }
  },

  reduceWater(message, overrideCost) {
    if (!onClient) {
      utils.getPlayerDataById(message.playerId).waterCount -= overrideCost || message.details.cost;

      sendS('reduceWater', {
        cost: overrideCost || message.details.cost,
      }, message.playerId);
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
        gs.discard.push(cards.splice(foundIndex, 1));
        action.sync(message.playerId);
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

        action.reduceWater(message, 2);
      }

      const newCard = utils.drawFromDeck();
      if (newCard) {
        utils.getPlayerDataById(message.playerId).cards.push(newCard);

        const newMessage = {
          ...message.details,
          card: newCard,
          deckCount: gs.deck.length,
        };
        if (message.details?.fromWater || params?.fromServerRequest) {
          newMessage.showAnimation = true;
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
        // TODO Check validity of junkEffect before processing, current options are: raid, drawCard, restoreCard, gainWater, injurePerson, gainPunk - if only there was some...kind...of...typing system
        const returnStatus = utils.fireAbilityOrJunk(message, message?.details?.card?.junkEffect);

        // If we aren't targetting, we can just remove the card that initiated the junk effect now
        // Assuming of course our action was valid
        if (!gs.pendingTargetAction && returnStatus !== false) {
          // TODO Bit of a known issue - if you drawCard via a junk effect, then because of this sync the new card is added immediately on the UI, instead of waiting for the animation to complete. But if we don't sync in the removeCard call, the junked card will stay in our hand
          action.discardCard(message);
        } else {
          action.sync(message.playerId);
        }
      } catch (err) {
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
        action.sendError('Already have Water Silo');
        return;
      } else if (playerData.waterCount < 1) {
        action.sendError('Not enough Water to take Water Silo');
        return;
      }

      // Consistently keep Water Silo at the front of your hand
      playerData.cards.unshift(utils.makeWaterSiloCard());
      playerData.hasWaterSilo = true;

      action.reduceWater(message, 1);
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
        const playerSlots = gs.slots[utils.getPlayerNumById(message.playerId)];
        if (targetId.startsWith(gs.SLOT_ID_PREFIX)) {
          const targetSlotIndex = parseInt(targetId.substring(gs.SLOT_ID_PREFIX.length));

          if (utils.isTopRow(targetSlotIndex)) {
            const slotBelow = playerSlots[utils.indexBelow(targetSlotIndex)];
            if (!slotBelow.content) {
              slotBelow.content = newPunk;
              return;
            }
          }

          playerSlots[targetSlotIndex].content = newPunk;
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
        }
      } else {
        action.targetMode(message, { help: 'Choose a slot to put your Punk in', colorType: 'info' });
      }
    }
  },

  raid(message) {
    if (!onClient) {
      // TODO Insert or advance raiders
      action.sendError('Raid effect not implemented yet', message.playerId);
      return false;
    }
  },

  injurePerson(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.damageCard({ ...message, details: { card: { id: targetId } } });
        });
      } else {
        action.targetMode(message, { help: 'Select an unprotected person to Injure', colorType: 'danger' });
      }
    }
  },

  damageCard(message) {
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
          const playerSlots = gs.slots[foundRes.playerNum];
          playerSlots[foundRes.slotIndex].content = null;

          // Check if we have a card in above of our destroyed card, if we do, slide it down towards the camp
          if (!message.details.noSlideDown) {
            if (utils.isBottomRow(foundRes.slotIndex)) {
              const slotAbove = playerSlots[utils.indexAbove(foundRes.slotIndex)];
              if (slotAbove.content) {
                playerSlots[foundRes.slotIndex] = structuredClone(slotAbove.content);
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

              // TODO Mark card unready after a restore
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
        totalDrawCount = 4;
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

  cancelTarget(message) {
    if (onClient) {
      sendC('cancelTarget', message);
    } else {
      if (gs.pendingTargetAction) {
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
    } else {
      if (message.details.targets) {
        try {
          const pendingFunc = abilities[gs.pendingTargetAction?.type] || action[gs.pendingTargetAction?.type];
          if (typeof pendingFunc === 'function') {
            const returnStatus = pendingFunc({
              ...message,
              validTargets: gs.pendingTargetAction.validTargets,
            });

            if (returnStatus !== false) {
              // TODO Probably clean up this flag reliance?
              // If we don't have a chosenAbilityIndex that means we junked and should discard
              if (typeof gs.pendingTargetAction?.details?.card?.chosenAbilityIndex !== 'number') {
                action.discardCard(gs.pendingTargetAction);
              } // Otherwise reduce the water cost
              else {
                const abilityObj =
                  gs.pendingTargetAction.details.card.abilities[gs.pendingTargetAction.details.card.chosenAbilityIndex];
                action.reduceWater(message, abilityObj.cost);
              }

              gs.pendingTargetAction = null;
            }
          } else {
            throw new Error();
          }
        } catch (err) {
          console.error('Unknown target action', err);
          action.sendError('Unknown target action', message.playerId);
        }
      }
    }
  },

  sendError(text, playerId) {
    if (!onClient) {
      console.error(`Send Error (to ${playerId}):`, text);
      action.chat({ details: { text: text } }, { playerId: playerId, fromServerRequest: true });
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
      const toSend = {
        playerId: message.playerId,
        type: message.type,
        help: params.help ?? '',
        cursor: params.cursor ?? '',
        colorType: params.colorType ?? 'info',
        expectedTargetCount: params.expectedTargetCount ?? 1,
        validTargets: message.validTargets.filter((target) => target && target !== null),
      };

      sendS('targetMode', toSend, message.playerId);
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

// Certain actions can be Undone - basically anything that doesn't reveal new information (such as drawing cards)
rawAction.playCard.recordUndo = true;
rawAction.junkCard.recordUndo = true;
rawAction.useCard.recordUndo = true;
rawAction.takeWaterSilo.recordUndo = true;

// Certain actions also clear the undo queue
rawAction.joinGame.clearUndo = true;
rawAction.promptCamps.clearUndo = true;
rawAction.doneCamps.clearUndo = true;
rawAction.startTurn.clearUndo = true;
rawAction.endTurn.clearUndo = true;
rawAction.drawCard.clearUndo = true;

const actionHandler = {
  manageUndo(originalMethod, beforeGS) {
    if (!onClient) {
      if (originalMethod?.recordUndo) {
        undoQueue.push(beforeGS);
      }
      if (originalMethod?.clearUndo) {
        undoQueue.length = 0;
      }
    }
  },
  get(target, prop) {
    const originalMethod = target[prop];
    if (typeof originalMethod === 'function') {
      if (!onClient) {
        console.log('...action=' + prop);
      }

      return function (...args) {
        const beforeGS = JSON.parse(JSON.stringify(gs));

        if (originalMethod?.skipPreprocess) {
          actionHandler.manageUndo(originalMethod, beforeGS);
          return originalMethod.apply(this, args);
        }

        // PRE PROCESS hook for all actions
        if (!onClient && !utils.isPlayersTurn(args[0].playerId)) {
          console.error(`Ignored action [${originalMethod.name}] out of turn order by playerId=${args[0].playerId}`);
          action.sendError('Not your turn', args[0].playerId);
          return;
        }

        actionHandler.manageUndo(originalMethod, beforeGS);
        return originalMethod.apply(this, args);
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
