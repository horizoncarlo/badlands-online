import { gs } from './gamestate.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;
globalThis.DEBUG_AUTO_SELECT_CAMPS_START_TURN = true; // Debugging flag to automatically choose camps and start the turn for easier refresh -> test behaviour
globalThis.DEBUG_DRAW_SO_MANY_CARDS = true; // Debugging flag to draw 5x initial hand cards, to better test junk effects
globalThis.DEBUG_TESTING_PLAYERS = true; // Debugging flag to avoid a few checks to make it easier to test the main game logic. Such as can start your turn without an opponent present

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
        slots.push(params?.idOnly ? s.content.id : s.content);
      }
      return slots;
    }, []);
  },

  determineValidTargets() {
    // TODO This should only get the actual valid targets based on the action
    // TTODO Bug with massive draw - sometimes when you do a junk effect a few cards in the hand are valid? Clicking them then a valid target on the board makes those cards disabled too? Really weird state
    return utils.getContentFromSlots([...gs.slots.player1, ...gs.slots.player2], { idOnly: true });
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

  findCardInSlots(card) {
    function findCardInPlayerBoard(card, playerNum) {
      const foundIndex = gs.slots[playerNum].findIndex((loopSlot) => {
        return loopSlot?.content?.id === (typeof card.id === 'number' ? card.id : +card.id); // TODO Better consistent number typing throughout the whole app
      });
      if (foundIndex !== -1) {
        return gs.slots[playerNum][foundIndex].content;
      }
    }

    return findCardInPlayerBoard(card, 'player1') || findCardInPlayerBoard(card, 'player2');
  },

  junkEffectRequiresTarget(junkEffect) {
    return ['injurePerson', 'restoreCard', 'gainPunk'].includes(junkEffect);
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
};

if (onClient) {
  window.utils = utils;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { utils };
