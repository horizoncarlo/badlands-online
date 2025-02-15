import { action } from './actions.mjs';
import { getGS } from './gamestate.mjs';
import { codeQueue, utils } from './utils.mjs';

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
        const unprotectedPeopleIds = utils.determineGenericTargets(message, 'injurePerson');

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
      if (getGS(message)[utils.getOpponentNumById(message.playerId)].events.find((event) => event !== undefined)) {
        action.damageCard(message, 'Select an unprotected card to damage with Doomsayer');
      } else {
        throw new Error('No opponent Event, so cannot use card ability');
      }
    }
  },

  // destroyCard to all damaged enemy people
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
      // TODO After Exterminator finishes destroying cards we need to slide down to any empty spaces (will need a new "settleCards" function or similar)
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
      const unprotectedPeopleIds = utils.determineGenericTargets(message, 'injurePerson');

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
        const opponentCamps = utils.getPlayerDataById(utils.getOppositePlayerId(message.playerId))?.camps;
        const targets = utils.checkSelectedTargets(message);
        if (opponentCamps.some((camp) => String(camp.id) === targets[0])) {
          action.drawCard(message, { fromServerRequest: true });
        }
      }
    }
  },

  // use ability of one of your ready people, or any undamaged enemy
  mimic(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          const target = utils.findCardInGame(message, { id: targetId });
          if (target) {
            /* TODO Mimic issues (global "processingMimic=boolean" flag to handle some of this? Ugly though...):
            Mimic marks the used target as unReady instead of herself
            Mutant self damage hits the target Mutant (even if it's the opponent) instead of Mimic
            */
            // Act as if the user directly used this card
            sendS('useCard', message, {
              card: target.cardObj,
            });
          }
        });
      } else {
        // Mimic can target ANY person that is undamaged and ready (and obviously not themselves)
        const validTargets = [...getGS(message).player1.slots, ...getGS(message).player2.slots]
          .filter((slot) =>
            slot.content && slot.content.id !== message.details.card.id && !slot.content.unReady &&
            (!slot.content.damage || slot.content.damage <= 0)
          )
          .map((slot) => String(slot.content.id));

        if (validTargets?.length) {
          message.validTargets = validTargets;

          action.targetMode(message, {
            help: 'Select a ready and undamaged person to Mimic the ability of',
            colorType: 'active',
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // damage and/or restore, then damage self
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
          () =>
            action.damageCard({ ...mutantMessage, type: 'damageCard' }, 'Select an unprotected card to damage with Mutant'),
        );
      }
      if (choice === 'Both' || choice === 'Restore') {
        codeQueue.add(choice === 'Both' ? 'doneTargets' : null, () => utils.fireAbilityOrJunk(mutantMessage, 'restoreCard'));
      }
      codeQueue.add(null, () => action.reduceWater(mutantMessage, mutantMessage.details.card.abilities[0].cost));
      codeQueue.add(null, () => action.doDamageCard(mutantMessage));
      codeQueue.start();
    } else {
      sendC('doneMutant', message.details);
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
        targets.forEach((targetId) => {
          utils.returnCardToHand(message.playerId, targetId);
        });
        action.sync(null, { gsMessage: message });
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

        // Do the junk effect
        const chosenCard = message.details.cardOptions[message.details.chosenCardIndex];
        const returnStatus = action.junkCard({ ...message, details: { card: chosenCard } });

        if (returnStatus === false) {
          // TODO Convert junkEffect to readable text for scientist error note
          action.sendError(
            `Drastic misuse of scientific resources (${chosenCard.junkEffect})`,
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

  // damageCard to ANY card
  sniper(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        message.validTargets = [
          ...getGS(message)[opponentNum].slots.filter((slot) => slot.content ? true : false).map((slot) =>
            String(slot.content.id)
          ),
          ...getGS(message)[opponentNum].camps.filter((camp) => !camp.isDestroyed).map((camp) => String(camp.id)),
        ];

        action.targetMode(message, {
          help: 'Select a card to damage with Sniper',
          cursor: 'damageCard',
          colorType: 'danger',
        });
      }
    }
  },

  // damageCard, then opponent does damageCard
  vanguard(message) {
    if (!onClient) {
      const opponentMessage = { ...message };
      opponentMessage.playerId = utils.getOppositePlayerId(message.playerId);

      // TODO BUG with Vanguard, a card your opponent damages out of turn can still use their ability - do we need a general check not just on Ready state but on damage in action.useCard?
      // TODO For Vanguard when the opponent is doing the damage back we should put a blocking dialog to prevent interaction - in general this would be a handy feature (such as during Raid). Could clear on next sync?
      codeQueue.add(
        null,
        () => action.damageCard({ ...message, type: 'damageCard' }, 'Select an unprotected card to damage with Vanguard'),
      );
      // TODO codeQueue improvement - multiple triggers: for Vanguard we need to also trigger on cancelTarget (for both of these), otherwise the follow up breaks - maybe pass trigger into the added anonymous func as a param and behave accordingly? Also likely for Mutant if you cancel target on damageCard step?
      codeQueue.add(
        'reduceWater',
        () =>
          action.damageCard({ ...opponentMessage, type: 'damageCard' }, "Use your opponent's Vanguard to do damage back"),
      );
      codeQueue.add('reduceWater', () => action.wait());
      codeQueue.start({ skipPreprocess: true }); // Skip our preprocessing to allow the out of turn Vanguard damage
    }
  },

  /*********************** UNIQUE CARDS ***********************/
  // damageCard all cards in one opponent column
  magnusKarv(message) {
    abilities.blowUpColumn(message, { isDamageAbility: true });
  },

  blowUpColumn(message, params) { // params.isDamageAbility: boolean - Used between Magnus Karv (unique person) and Napalm (event). The former has isDamageAbility=true
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
                const actionType = params?.isDamageAbility ? action.doDamageCard : action.destroyCard;
                const details = !params?.isDamageAbility
                  ? { noSlideDown: true, card: { id: String(slot.content.id) } }
                  : { card: { id: String(slot.content.id) } };
                actionType({ ...message, details });
              }
            });
          }
          if (params?.isDamageAbility && !opponentCamps[columnCampTargetIndex].isDestroyed) {
            action.doDamageCard({ ...message, details: { card: { id: String(opponentCamps[columnCampTargetIndex].id) } } });
          }
        }
      } else {
        message.validTargets = [];
        if (opponentCamps?.length) {
          for (let i = 0; i < opponentCamps.length; i++) {
            if (
              params?.isDamageAbility &&
                (!opponentCamps[i].isDestroyed || !utils.isColumnEmpty(message, i, opponentPlayerNum)) ||
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
            cursor: params?.isDamageAbility ? 'damageCard' : 'destroyCard',
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
        const opponentCamps = utils.getPlayerDataById(utils.getOppositePlayerId(message.playerId))?.camps;
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

  // draw 3 cards, then discard 3 cards (not Water Silo)
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
      showDiscardDialog(message, { allowWaterSilo: false });
    }
  },
};

if (onClient) {
  window.abilities = abilities;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { abilities };
