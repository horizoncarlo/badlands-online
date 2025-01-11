import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

/**
 * Internal function to centralize handling targetting
 * Returns true if still need to do targetting, false if we had targets and handled them
 * By default calls doDamageCard, but can pass an optionalFunc string name to use instead (such as destroyCard)
 */
function _needTargets(message, optionalFunc) {
  const targets = utils.checkSelectedTargets(message);
  if (targets?.length) {
    targets.forEach((targetId) => {
      if (typeof optionalFunc === 'string') {
        action[optionalFunc]({ ...message, details: { card: { id: targetId } } });
      } else {
        action.doDamageCard({ ...message, details: { card: { id: targetId } } });
      }
    });
    return false;
  }
  return true;
}

// Abilities that require targetting or special cases are generally called twice
// Once without targets, when we turn targetMode on, then again after the client has chosen
// On the second call we should apply our effect, such as doDamageCard from Sniper
const abilities = {
  // destroyCard an unprotected enemy person
  assassin(message) {
    if (!onClient) {
      if (_needTargets(message, 'destroyCard')) {
        // Get a list of valid targets for injurePerson, then when we target destroyCard instead
        const unprotectedPeopleIds = utils.determineValidTargets('injurePerson', message);

        if (unprotectedPeopleIds?.length) {
          message.validTargets = unprotectedPeopleIds;

          action.targetMode(message, {
            help: 'Select an unprotected person to destroy with Assassin',
            cursor: 'destroyCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // destroy one of your people, then damageCard
  cultLeader(message) {
    if (!onClient) {
      if (_needTargets(message, 'destroyCard')) {
        // Target your own person to destroy first
        const validTargets = utils.determineOwnSlotTargets(message);
        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select a person to destroy for Cult Leader',
            cursor: 'destroyCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      } // Once our targets are done we continue with Cult Leader to a simple damageCard
      else {
        return action.damageCard({
          type: 'damageCard',
          playerId: message.playerId,
        });
      }
    }
  },

  // if opponent has an event, damageCard
  doomsayer(message) {
    if (!onClient) {
      // TODO When event system is done fix Doomsayer card to check if the opponent has an event in play. For now use plain damage
      // if (utils.opponentHasEvent(utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId)))) {
      action.damageCard(message, 'Select an unprotected card to damage with Doomsayer');
      // } else {
      //   throw new Error('No opponent Event, so cannot use card ability');
      // }
    }
  },

  // destroyCard to all damaged enemy people
  exterminator(message) {
    if (!onClient) {
      const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const damagedSlots = gs.slots[opponentNum].filter((slot) =>
        slot.content && typeof slot.content.damage === 'number' && slot.content.damage > 0
      );

      if (damagedSlots.length === 0) {
        throw new Error(MSG_INVALID_TARGETS);
        return;
      }

      damagedSlots.forEach((slot) => {
        action.destroyCard({
          type: message.type,
          playerId: message.playerId,
          details: {
            noSlideDown: true,
            card: slot.content,
          },
        });
      });
    }
  },

  // injurePerson all unprotected enemy people
  gunner(message) {
    if (!onClient) {
      // Get a list of valid targets for injurePerson, instead of targetting these we just injure them all
      const unprotectedPeopleIds = utils.determineValidTargets('injurePerson', message);

      if (unprotectedPeopleIds?.length) {
        unprotectedPeopleIds.forEach((targetId) => {
          action.doDamageCard({ ...message, details: { card: { id: +targetId } } });
        });
      } else {
        throw new Error(MSG_INVALID_TARGETS);
      }
    }
  },

  // damageCard unprotected card, if it's a camp, draw a card
  looter(message) {
    if (!onClient) {
      if (action.damageCard(message, 'Select an unprotected card to damage with Looter')) {
        // If we just handled our targets, check if any were a camp and draw
        const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        const opponentCamps = utils.getPlayerDataById(utils.getPlayerIdByNum(opponentPlayerNum))?.camps;
        const targets = utils.checkSelectedTargets(message);
        if (opponentCamps.some((camp) => String(camp.id) === targets[0])) {
          action.drawCard(message, { fromServerRequest: true });
        }
      }
    }
  },

  // damageCard an unprotected enemy camp
  pyromaniac(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const unprotectedCampIds = utils.getUnprotectedCards(message, { campsOnly: true });
        if (unprotectedCampIds?.length) {
          message.validTargets = unprotectedCampIds;

          action.targetMode(message, {
            help: 'Select an unprotected camp to damage with Pyromaniac',
            cursor: 'damageCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // if you have a punk, damageCard (second ability)
  rabbleRouser(message) {
    if (!onClient) {
      if (utils.playerHasPunk(message.playerId)) {
        action.damageCard(message, 'Select an unprotected card to damage with Rabble Rouser');
      } else {
        throw new Error('No Punk, so cannot use card ability');
      }
    }
  },

  // return one of your people to your hand
  rescueTeam(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        const playerNum = utils.getPlayerNumById(message.playerId);
        const playerData = utils.getPlayerDataById(message.playerId);
        targets.forEach((targetId) => {
          // Find the card and return to hand
          const target = utils.findCardInGame({ id: targetId });
          if (target) {
            // If we're a Punk convert to the actual card (is hidden information before)
            if (target.cardObj.isPunk) {
              target.cardObj = utils.convertPunkToCard(target.cardObj.id);
            }

            playerData.cards.push(target.cardObj);
            gs.slots[playerNum][target.slotIndex].content = null;
          }
        });
        action.sync();
      } else {
        const validTargets = utils.determineOwnSlotTargets(message);
        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select your person to return to hand (Punks are people too)',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // discard top 3 cards of the deck, MAY use the junk effect from 1 of them
  scientist(message) {
    if (!onClient) {
      const cardOptions = [];
      for (let i = 0; i < 3; i++) {
        const newCard = utils.drawFromDeck();
        if (newCard) {
          cardOptions.push(newCard);
        }
      }

      // Safety check that should never happen - don't think we can run out of cards in a proper game, and if we reshuffle too many times the game is just a draw
      if (cardOptions.length <= 0) {
        action.sendError('Not enough cards for Scientist effect', message.playerId);
        return false;
      }

      // Reduce our water here, as the normal ability chain relies on targetting
      action.reduceWater(message, message.details.card.abilities[0].cost);

      // Discard the selections right away
      cardOptions.forEach((card) => gs.discard.push(card));

      message.details = {
        effectName: message.type,
        cardOptions: cardOptions,
      };

      gs.pendingTargetAction = structuredClone(message);

      sendS('useAbility', message.details, message.playerId);
    } else {
      ui.cardData.scientistChoices = message.details.cardOptions;
      showScientistDialog();
    }
  },

  doneScientist(message) {
    if (!onClient) {
      // If our pending action matches the incoming scientist request we're valid
      if (
        typeof message.details.chosenCardIndex === 'number' &&
        JSON.stringify(gs.pendingTargetAction?.details?.cardOptions) ===
          JSON.stringify(message.details.cardOptions)
      ) {
        gs.pendingTargetAction = null;

        // Do the junk effect
        const chosenCard = message.details.cardOptions[message.details.chosenCardIndex];
        const returnStatus = action.junkCard({ ...message, details: { card: chosenCard } });

        if (returnStatus === false) {
          // TODO Should we do anything else (like re-choose?) if a junkEffect that has no valid targets is chosen? Opens a can of worms on what if ALL choices are invalid, etc. So likely just notify player and they can pay more attention next time
          action.sendError('Drastic misuse of scientific resources', message.playerId);
        }

        action.sync();
      }
    } else {
      sendC('doneScientist', message.details);
    }
  },

  // damageCard to ANY card
  sniper(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        message.validTargets = [
          ...gs.slots[opponentNum].filter((slot) => slot.content ? true : false).map((slot) => String(slot.content.id)),
          ...gs[opponentNum].camps.map((camp) => String(camp.id)),
        ];

        action.targetMode(message, {
          help: 'Select a card to damage with Sniper',
          cursor: 'damageCard',
          colorType: 'danger',
        });
      }
    }
  },

  /*********************** UNIQUE CARDS ***********************/
  // damageCard all cards in one opponent column
  magnusKarv(message) {
    if (!onClient) {
      // TTODO Do a proxy/raw style for abilities and store a bunch of local convenience variables from our utility functions, like playerNum, opponentNum, etc. so we don't have to do long chains like the next line in each function?
      const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const opponentCamps = utils.getPlayerDataById(utils.getPlayerIdByNum(opponentPlayerNum))?.camps;
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        // Get the column we've chosen to damage
        const columnCampTargetIndex = opponentCamps.findIndex((camp) => camp.id === +targets[0]);
        if (columnCampTargetIndex !== -1) {
          const camp = opponentCamps[columnCampTargetIndex];
          if (!camp.isDestroyed) {
            // Damage the camp first of all
            action.doDamageCard({ ...message, details: { card: { id: String(camp.id) } } });
          }

          // Damage everyone in the column
          const slots = utils.getSlotsInColumn(columnCampTargetIndex, opponentPlayerNum);
          if (slots?.length) {
            slots.forEach((slot) => {
              if (slot.content !== null) {
                action.doDamageCard({ ...message, details: { card: { id: String(slot.content.id) } } });
              }
            });
          }
        }
      } else {
        // For simplicity just choose columns that are not empty or have an active camp, then use the camp as the target
        message.validTargets = [];

        if (opponentCamps?.length) {
          for (let i = 0; i < opponentCamps.length; i++) {
            if (!opponentCamps[i].isDestroyed || !utils.isColumnEmpty(i, opponentPlayerNum)) {
              message.validTargets.push(String(opponentCamps[i].id));
            }
          }
        }

        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: 'Select an entire column to damage everything with Magnus Karv',
            cursor: 'damageCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // destroyCard to ANY camp
  molgurStang(message) {
    if (!onClient) {
      if (_needTargets(message, 'destroyCard')) {
        const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        const opponentCamps = utils.getPlayerDataById(utils.getPlayerIdByNum(opponentPlayerNum))?.camps;
        if (opponentCamps?.length) {
          message.validTargets = opponentCamps.filter((camp) => !camp.isDestroyed).map((camp) => String(camp.id));
        }

        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: 'Select a camp to destroy with Molgur Stang',
            cursor: 'destroyCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },
};

if (onClient) {
  window.abilities = abilities;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { abilities };
