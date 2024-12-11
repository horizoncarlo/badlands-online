import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// TTODO Add a new cancelTarget action and hook into the UI (button in the help panel?) that clears a pendingTargetAction
// TODO Handle persisting pendingTargetAction between client refreshes - probably when we have a lobby system, but should maintain target after manual page reload. Slicker system probably to send a new "cancelTarget" action right before refresh/unload (if we can reliably get it across)
let pendingTargetAction = null; // Format { action: null, validTargets: [] };

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
      gs[nextPlayerNum].waterCount = 3;
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

  playCard(message) {
    if (onClient) {
      sendC('playCard', message);
    } else {
      const targetSlot = gs.slots[utils.getPlayerNumById(message.playerId)][message.details.slot.index];
      if (targetSlot?.content) {
        action.sendError('Card already here');
        return;
      }

      const waterCost = message.details.card.cost || 0;
      if (waterCost > utils.getPlayerDataById(message.playerId).waterCount) {
        action.sendError('Not enough water to play that card', message.playerId);
        return;
      }

      targetSlot.content = message.details.card;
      sendS('slot', {
        playerNum: utils.getPlayerNumById(message.playerId),
        index: message.details.slot.index,
        card: message.details.card,
      });

      action.reduceWater(message, waterCost);
      action.removeCard(message);
    }
  },

  useCard(message) {
    if (onClient) {
      sendC('useCard', message);
    } else {
      // TODO Deal with trying to use a card ability - check if card is not ready, reduce water cost if possible, mark unready, request client targets with a valid list of targets sent by the server
    }
  },

  gainWater(message) {
    if (!onClient) {
      utils.getPlayerDataById(message.playerId).waterCount += 1;
      sendS('gainWater', {}, message.playerId);
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

  drawCard(message, params) { // params.fromServerRequest: boolean
    if (onClient) {
      sendC('drawCard', message);
    } else {
      if (!params?.fromServerRequest && !utils.isPlayersTurn(message.playerId)) {
        return;
      }

      if (message.details?.fromWater) {
        if (2 > utils.getPlayerDataById(message.playerId).waterCount) {
          action.sendError('Not enough water to draw a card', message.playerId);
          return;
        }

        action.reduceWater(message, 2);
      }

      const newCard = gs.deck.shift();
      if (newCard) {
        utils.getPlayerDataById(message.playerId).cards.push(newCard);

        const newMessage = {
          card: newCard,
          ...message.details,
        };
        if (message.details?.fromWater || params?.fromServerRequest) {
          newMessage.showAnimation = true;
        }

        sendS('addCard', newMessage, message.playerId);
      } else {
        action.sendError('No cards left to draw', message.playerId);
      }
    }
  },

  junkCard(message) {
    if (onClient) {
      sendC('junkCard', message);
    } else {
      const junkEffect = message?.details?.card?.junkEffect;
      // TODO Check validity of junkEffect before processing, current options are: raid, drawCard, restoreCard, gainWater, injurePerson, gainPunk - if only there was some...kind...of...typing system
      if (junkEffect && typeof action[junkEffect] === 'function') {
        try {
          const requiresTarget = utils.junkEffectRequiresTarget(junkEffect);
          let validTargets = undefined;
          if (requiresTarget) {
            validTargets = utils.determineValidTargets(message);
            // TODO Need to handle the case where we have SOME validTargets but not equal to expectedTargetCount (when it's not the default of 1, such as a Gunner)
            if (!validTargets.length) {
              throw new Error('No valid targets for Junk effect');
            }
          }
          action[junkEffect](
            { ...message, validTargets, type: junkEffect },
            junkEffect === 'drawCard' ? { fromServerRequest: true } : undefined,
          );

          // TODO We're relying on the underlying sync here, but still need to sort that out
          action.removeCard(message);
        } catch (err) {
          action.sendError(err?.message, message.playerId);
        }
      } else {
        action.sendError(`Invalid Junk effect ${junkEffect}`, message.playerId);
      }
    }
  },

  gainPunk(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        const targetSlotIndex = parseInt(targets[0].substring(gs.slotIdPrefix.length));
        const newPunk = gs.deck.shift();
        // TODO As part of the targetting we should only count a Punk as a valid option if there's a card left in the deck to draw
        if (newPunk) {
          gs.slots[utils.getPlayerNumById(message.playerId)][targetSlotIndex].content = utils.convertCardToPunk(newPunk);
          pendingTargetAction = null;
        } else {
          action.sendError('No cards left to draw', message.playerId);
        }
      } else {
        action.targetMode(message, { help: 'Choose a slot to put your Punk in', colorType: 'info' });
      }
    }
  },

  raid(message) {
    if (!onClient) {
      // TODO insert or advance raiders
    }
  },

  injurePerson(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.damageCard({ ...message, details: { card: { id: targetId } } });
        });
        pendingTargetAction = null;
      } else {
        action.targetMode(message, { help: 'Select an unprotected person to Injure', colorType: 'danger' });
      }
    }
  },

  damageCard(message) {
    if (!onClient) {
      const foundRes = utils.findCardInSlots(message.details.card);
      if (foundRes) {
        // TODO Need to do janky stuff like finding the exact card instance (so that our updates propogate) when we've added params in findCardInSlots (like playerNum/foundIndex)
        const cardObj = gs.slots[foundRes.playerNum][foundRes.foundIndex].content;
        cardObj.damage = (foundRes.damage ?? 0) + (message.details.amount ?? 1);
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
      const toDestroy = utils.findCardInSlots(message.details.card);
      if (toDestroy) {
        gs.slots[toDestroy.playerNum][toDestroy.foundIndex].content = null;
        // TODO Play a destroy animation so the card being removed from the board is less abrupt
        action.sync();
      } else {
        action.sendError('Invalid target to destroy', message.playerId);
      }
    }
  },

  restoreCard(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          const foundRes = utils.findCardInSlots({ id: +targetId }); // TODO Not in love with these bastardized objects instead of a pure `card`
          if (foundRes && typeof foundRes.damage === 'number') {
            gs.slots[foundRes.playerNum][foundRes.foundIndex].content.damage = Math.min(0, foundRes.damage - 1);
          }
          action.sync();
        });
        pendingTargetAction = null;
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

      if (campOptions.length !== 3) {
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
      if (message?.details?.camps?.length !== 3) {
        action.sendError('Select 3 camps', message.playerId);
        return;
      }
      const incomingCampIds = message.details.camps.map((camp) => camp.id);
      if (playerData.camps.filter((camp) => incomingCampIds.includes(camp.id)).length !== 3) {
        action.sendError('Invalid camp selections', message.playerId);
        return;
      }

      playerData.camps = message.details.camps;
      playerData.doneCamps = true;

      let totalDrawCount = message.details.camps.reduce((total, camp) => total + camp.drawCount, 0); // TODO DEBUG Should be a const and remove the DEBUG_DRAW_SO_MANY_CARDS
      totalDrawCount = DEBUG_DRAW_SO_MANY_CARDS ? 30 : totalDrawCount;
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

  doneTargets(message) {
    if (onClient) {
      sendC('doneTargets', message);
    } else {
      if (message.details.targets) {
        if (typeof action[pendingTargetAction?.action] === 'function') {
          action[pendingTargetAction.action]({ ...message, validTargets: pendingTargetAction.validTargets });

          action.sync(); // TODO Remove - each sub-action should handle it's own updates
        } else {
          action.sendError('Unknown target action', message.playerId);
        }
      }
    }
  },

  sendError(text, playerId) {
    if (!onClient) {
      console.error(`Send Error (to ${playerId}):`, text);
      action.chat({ details: { text: text } }, { playerId: playerId, fromServerRequest: true });
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

  targetMode(message, params) { // message has playerId, type. params has help, colorType, expectedTargetCount (optional, default 1)
    if (!onClient) {
      pendingTargetAction = { action: message.type, validTargets: message.validTargets };
      const toSend = {
        playerId: message.playerId,
        type: message.type,
        help: params.help ?? '',
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

      // Send a minimal version of our current server game state that the UI can apply to itself
      // TODO Could further trim down minor packet size savings like delete slot.content if null, etc. - do this all once the format is finalized
      delete updatedGs[playerNum].playerId;
      delete updatedGs.myPlayerNum;
      delete updatedGs.opponentPlayerNum;
      delete updatedGs.campDeck;
      delete updatedGs.deck;

      // TTODO Handle an empty deck - rules say shuffle discards once, then if you have to shuffle again it's a draw,
      //       So need to send a count of cards left in the deck, then display it overlayed on the UI draw pile
      //       Also need to announce the deck is being shuffled (can leave handling a draw until later until we have proper win/loss, just make a note of it)
      //       Rules also say you can't look through the deck discard pile

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

    // Request a sync to both if no
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

const actionHandler = {
  get(target, prop) {
    const originalMethod = target[prop];
    if (typeof originalMethod === 'function') {
      if (!onClient) {
        console.log('...action=' + prop);
      }

      return function (...args) {
        if (originalMethod?.skipPreprocess) {
          return originalMethod.apply(this, args);
        }

        // TODO Although cool this proxy approach is probably overengineered given how many messages we skipPreprocess on anyway
        //      Likely can just do on a function by function basis in actions (see drawCard for an example of a manual isPlayersTurn check)
        //      Or just in main.ts itself as the Websocket messages come in (ignore or process them accordingly)
        //      Reminder that the entire intent was to have server side protection from out of turn client actions like playing a card
        // PRE PROCESS hook for all actions
        if (!onClient && !utils.isPlayersTurn(args[0].playerId)) {
          console.error(`Ignored action [${originalMethod.name}] out of turn order by playerId=${args[0].playerId}`);
          action.sendError('Not your turn', args[0].playerId);
          return;
        }

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
