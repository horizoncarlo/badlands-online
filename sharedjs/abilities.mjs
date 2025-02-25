import { action } from './actions.mjs';
import { getGS } from './gamestate.mjs';
import { codeQueue, utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

/**
 * Internal function to centralize handling targetting
 * Returns true if still need to do targetting, false if we had targets and handled them
 * By default calls doBugCard, but can pass an optionalFunc string name to use instead (such as crashCard)
 */
function _needTargets(message, optionalFunc) {
  const targets = utils.checkSelectedTargets(message);
  if (targets?.length) {
    targets.forEach((targetId) => {
      if (typeof optionalFunc === 'string') {
        action[optionalFunc]({ ...message, details: { card: { id: targetId } } });
      } else {
        action.doBugCard({ ...message, details: { card: { id: targetId } } });
      }
    });
    return false;
  }
  return true;
}

// Abilities that require targetting or special cases are generally called twice
// Once without targets, when we turn targetMode on, then again after the client has chosen
// On the second call we should apply our effect, such as doBugCard from Sniper
const abilities = {
  // crashCard an external enemy program
  assassin(message) {
    if (!onClient) {
      if (_needTargets(message, 'crashCard')) {
        // Get a list of valid targets for exploitProgram, then when we target crashCard instead
        const externalPeopleIds = utils.determineGenericTargets(message, 'exploitProgram');

        if (externalPeopleIds?.length) {
          message.validTargets = externalPeopleIds;

          action.targetMode(message, {
            help: 'Select an external program to crash with Assassin',
            cursor: 'crashCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // destroy one of your people, then bugCard
  cultLeader(message) {
    if (!onClient) {
      if (_needTargets(message, 'crashCard')) {
        // Target your own program to destroy first
        const validTargets = utils.determineOwnSlotTargets(message);
        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select a program to crash for Cult Leader',
            cursor: 'crashCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      } // Once our targets are done we continue with Cult Leader to a simple bugCard
      else {
        return action.bugCard({
          type: 'bugCard',
          playerId: message.playerId,
        });
      }
    }
  },

  // if opponent has an event, bugCard
  doomsayer(message) {
    if (!onClient) {
      if (getGS(message)[utils.getOpponentNumById(message.playerId)].events.find((event) => event !== undefined)) {
        action.bugCard(message, 'Select an external card to damage with Doomsayer');
      } else {
        throw new Error('No opponent Event, so cannot use card ability');
      }
    }
  },

  // crashCard to all damaged enemy people
  exterminator(message) {
    if (!onClient) {
      const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const damagedSlots = getGS(message)[opponentNum].slots.filter((slot) =>
        slot.content && typeof slot.content.damage === 'number' && slot.content.damage > 0
      );

      if (damagedSlots.length === 0) {
        throw new Error(MSG_INVALID_TARGETS);
        return;
      }

      // We explicitly set noSlideDown here as we're looping through cards and don't want to start modifying the slots while we are
      // TODO BUG After Exterminator finishes destroying cards we need to slide down to any empty spaces (will need a new "settleCards" function or similar)
      damagedSlots.forEach((slot) => {
        action.crashCard({
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

  // exploitProgram all external enemy people
  gunner(message) {
    if (!onClient) {
      // Get a list of valid targets for exploitProgram, instead of targetting these we just exploit them all
      const externalPeopleIds = utils.determineGenericTargets(message, 'exploitProgram');

      if (externalPeopleIds?.length) {
        externalPeopleIds.forEach((targetId) => {
          action.doBugCard({ ...message, details: { card: { id: +targetId } } });
        });
      } else {
        throw new Error(MSG_INVALID_TARGETS);
      }
    }
  },

  // bugCard external card, if it's a camp, draw a card
  looter(message) {
    if (!onClient) {
      if (action.bugCard(message, 'Select an external card to damage with Looter')) {
        // If we just handled our targets, check if any were a camp and draw
        const opponentCamps = utils.getPlayerDataById(utils.getOppositePlayerId(message.playerId))?.camps;
        const targets = utils.checkSelectedTargets(message);
        if (opponentCamps.some((camp) => String(camp.id) === targets[0])) {
          action.drawCard(message, { fromServerRequest: true });
        }
      }
    }
  },

  // use ability of one of your active programs, or any bugfree enemy
  mimic(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          const target = utils.findCardInGame(message, { id: targetId });
          if (target) {
            /* TODO Mimic issues (global "processingMimic=boolean" flag to handle some of this? Ugly though...):
            Mimic marks the used target as inactive instead of herself
            Mutant self damage hits the target Mutant (even if it's the opponent) instead of Mimic
            */
            // Act as if the user directly used this card
            sendS('useCard', message, {
              card: target.cardObj,
            });
          }
        });
      } else {
        // Mimic can target ANY program that is bugfree and active (and obviously not themselves)
        const validTargets = [...getGS(message).player1.slots, ...getGS(message).player2.slots]
          .filter((slot) =>
            slot.content && slot.content.id !== message.details.card.id && !slot.content.inactive &&
            (!slot.content.damage || slot.content.damage <= 0)
          )
          .map((slot) => String(slot.content.id));

        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select an active and bugfree program to Mimic the subroutine of',
            colorType: 'active',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // damage and/or patch, then damage self
  mutant(message) {
    if (!onClient) {
      message.details.effectName = message.type;
      getGS(message).pendingTargetAction = structuredClone(message);

      sendS('useAbility', message, message.details, message.playerId);
    } else {
      showMutantDialog(message.details?.card?.img);
    }
  },

  doneMutant(message) {
    if (!onClient) {
      // Check if we have a matching pending action and we're not just getting an invalid message
      if (
        !getGS(message).pendingTargetAction?.type ||
        getGS(message).pendingTargetAction.type !== 'mutant'
      ) {
        return;
      }

      const mutantMessage = structuredClone(getGS(message).pendingTargetAction);
      getGS(message).pendingTargetAction = null;

      const choice = message.details.chosenAbilities;
      if (choice === 'Both' || choice === 'Damage') {
        codeQueue.add(
          null,
          () => action.bugCard({ ...mutantMessage, type: 'bugCard' }, 'Select an external card to damage with Mutant'),
        );
      }
      if (choice === 'Both' || choice === 'Patch') {
        codeQueue.add(
          choice === 'Both' ? 'doneTargets' : null,
          () => utils.fireAbilityOrRecycle(mutantMessage, 'patchCard'),
        );
      }
      codeQueue.add(null, () => action.reduceWater(mutantMessage, mutantMessage.details.card.abilities[0].cost));
      codeQueue.add(null, () => action.doBugCard(mutantMessage));
      codeQueue.start();
    } else {
      sendC('doneMutant', message.details);
    }
  },

  // bugCard an external enemy camp
  pyromaniac(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const externalCampIds = utils.getExternalCards(message, { campsOnly: true });
        if (externalCampIds?.length) {
          message.validTargets = externalCampIds;

          action.targetMode(message, {
            help: 'Select an external camp to damage with Pyromaniac',
            cursor: 'bugCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // if you have a prototype, bugCard (second ability)
  rabbleRouser(message) {
    if (!onClient) {
      if (utils.playerHasPrototype(message.playerId)) {
        action.bugCard(message, 'Select an external card to damage with Rabble Rouser');
      } else {
        throw new Error('No Prototype, so cannot use card ability');
      }
    }
  },

  // return one of your people to your hand
  rescueTeam(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          utils.returnCardToHand(message.playerId, targetId);
        });
        action.sync(null, { gsMessage: message });
      } else {
        const validTargets = utils.determineOwnSlotTargets(message);
        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select your program to return to hand (Prototypes are programs too)',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // discard top 3 cards of the deck, MAY use the recycle effect from 1 of them
  scientist(message) {
    if (!onClient) {
      const cardOptions = [];
      for (let i = 0; i < 3; i++) {
        const newCard = utils.drawFromDeck(message);
        if (newCard) {
          cardOptions.push(newCard);
        }
      }

      // Safety check that should never happen - don't think we can run out of cards in a proper game, and if we reshuffle too many times the game is just a draw
      if (cardOptions.length <= 0) {
        action.sendError('Not enough cards for Scientist effect', { gsMessage: message }, message.playerId);
        return false;
      }

      // Reduce our water here, as the normal ability chain relies on targetting
      action.reduceWater(message, message.details.card.abilities[0].cost);

      // Discard the selections right away
      cardOptions.forEach((card) => getGS(message).discard.push(card));

      message.details = {
        effectName: message.type,
        cardOptions: cardOptions,
      };

      getGS(message).pendingTargetAction = structuredClone(message);

      sendS('useAbility', message, message.details, message.playerId);
    } else {
      ui.componentData.scientistChoices = message.details.cardOptions;
      showScientistDialog();
    }
  },

  doneScientist(message) {
    if (!onClient) {
      // If our pending action matches the incoming scientist request we're valid
      if (
        typeof message.details.chosenCardIndex === 'number' &&
        JSON.stringify(getGS(message).pendingTargetAction?.details?.cardOptions) ===
          JSON.stringify(message.details.cardOptions)
      ) {
        getGS(message).pendingTargetAction = null;

        // Do the recycle effect
        const chosenCard = message.details.cardOptions[message.details.chosenCardIndex];
        const returnStatus = action.recycleCard({ ...message, details: { card: chosenCard } });

        if (returnStatus === false) {
          // TODO Convert recycleEffect to readable text for scientist error note
          action.sendError(
            `Drastic misuse of scientific resources (${chosenCard.recycleEffect})`,
            { gsMessage: message },
            message.playerId,
          );
        }

        action.sync(null, { gsMessage: message });
      }
    } else {
      sendC('doneScientist', message.details);
    }
  },

  // bugCard to ANY card
  sniper(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        message.validTargets = [
          ...getGS(message)[opponentNum].slots.filter((slot) => slot.content ? true : false).map((slot) =>
            String(slot.content.id)
          ),
          ...getGS(message)[opponentNum].camps.filter((camp) => !camp.isCrashed).map((camp) => String(camp.id)),
        ];

        action.targetMode(message, {
          help: 'Select a card to damage with Sniper',
          cursor: 'bugCard',
          colorType: 'danger',
        });
      }
    }
  },

  // bugCard, then opponent does bugCard
  vanguard(message) {
    if (!onClient) {
      const opponentMessage = { ...message };
      opponentMessage.playerId = utils.getOppositePlayerId(message.playerId);

      // TODO BUG with Vanguard, a card your opponent damages out of turn can still use their ability - do we need a general check not just on Active state but on damage in action.useCard?
      // TODO For Vanguard when the opponent is doing the damage back we should put a blocking dialog to prevent interaction - in general this would be a handy feature (such as during Virus). Could clear on next sync?
      codeQueue.add(
        null,
        () => action.bugCard({ ...message, type: 'bugCard' }, 'Select an external card to damage with Vanguard'),
      );
      // TODO codeQueue improvement - multiple triggers: for Vanguard we need to also trigger on cancelTarget (for both of these), otherwise the follow up breaks - maybe pass trigger into the added anonymous func as a param and behave accordingly? Also likely for Mutant if you cancel target on bugCard step?
      codeQueue.add(
        'reduceWater',
        () => action.bugCard({ ...opponentMessage, type: 'bugCard' }, "Use your opponent's Vanguard to do damage back"),
      );
      codeQueue.add('reduceWater', () => action.wait());
      codeQueue.start({ skipPreprocess: true }); // Skip our preprocessing to allow the out of turn Vanguard damage
    }
  },

  /*********************** UNIQUE CARDS ***********************/
  // bugCard all cards in one opponent column
  magnusKarv(message) {
    abilities.blowUpColumn(message, { isDamageAbility: true });
  },

  blowUpColumn(message, params) { // params.isDamageAbility: boolean - Used between Magnus Karv (unique program) and Napalm (event). The former has isDamageAbility=true
    if (!onClient) {
      // TODO Do a proxy/raw style for abilities and store a bunch of local convenience variables from our utility functions, like playerNum, opponentNum, etc. so we don't have to do long chains like the next line in each function?
      const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const opponentCamps = utils.getPlayerDataById(utils.getPlayerIdByNum(opponentPlayerNum, message.playerId))?.camps;
      const targets = utils.checkSelectedTargets(message);

      if (targets?.length) {
        const columnCampTargetIndex = opponentCamps.findIndex((camp) => camp.id === +targets[0]);
        if (columnCampTargetIndex !== -1) {
          const slots = utils.getSlotsInColumn(message, columnCampTargetIndex, opponentPlayerNum);
          if (slots?.length) {
            slots.forEach((slot) => {
              if (slot.content !== null) {
                const actionType = params?.isDamageAbility ? action.doBugCard : action.crashCard;
                const details = !params?.isDamageAbility
                  ? { noSlideDown: true, card: { id: String(slot.content.id) } }
                  : { card: { id: String(slot.content.id) } };
                actionType({ ...message, details });
              }
            });
          }
          if (params?.isDamageAbility && !opponentCamps[columnCampTargetIndex].isCrashed) {
            action.doBugCard({ ...message, details: { card: { id: String(opponentCamps[columnCampTargetIndex].id) } } });
          }
        }
      } else {
        message.validTargets = [];
        if (opponentCamps?.length) {
          for (let i = 0; i < opponentCamps.length; i++) {
            if (
              params?.isDamageAbility &&
                (!opponentCamps[i].isCrashed || !utils.isColumnEmpty(message, i, opponentPlayerNum)) ||
              !params?.isDamageAbility && !utils.isColumnEmpty(message, i, opponentPlayerNum)
            ) {
              message.validTargets.push(String(opponentCamps[i].id));
            }
          }
        }
        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: params?.isDamageAbility
              ? 'Select an entire column to damage everything with Magnus Karv'
              : 'Select an entire column to Napalm and destroy all enemy people',
            cursor: params?.isDamageAbility ? 'bugCard' : 'crashCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // crashCard to ANY camp
  molgurStang(message) {
    if (!onClient) {
      if (_needTargets(message, 'crashCard')) {
        const opponentCamps = utils.getPlayerDataById(utils.getOppositePlayerId(message.playerId))?.camps;
        if (opponentCamps?.length) {
          message.validTargets = opponentCamps.filter((camp) => !camp.isCrashed).map((camp) => String(camp.id));
        }

        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: 'Select a camp to destroy with Molgur Stang',
            cursor: 'crashCard',
            colorType: 'danger',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // draw 3 cards, then discard 3 cards (not Archive)
  zetoKhan(message) {
    if (!onClient) {
      for (let i = 0; i < 3; i++) {
        action.drawCard({
          ...message,
          details: {
            ...message.details,
            multiAnimation: true,
          },
        }, { fromServerRequest: true });
      }

      action.reduceWater(message, message.details.card.abilities[0].cost);
      action.sync(message.playerId);

      const abilityMessage = { ...message.details, effectName: 'zetoKhan', expectedDiscards: 3 };
      getGS(message).pendingTargetAction = structuredClone(abilityMessage);
      sendS('useAbility', message, abilityMessage, message.playerId);
    } else {
      showDiscardDialog(message, { allowArchive: false });
    }
  },
};

if (onClient) {
  window.abilities = abilities;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { abilities };
