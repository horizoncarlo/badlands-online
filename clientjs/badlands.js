globalThis.ui = { // Local state
  inGame: false,
  drawAnimationCount: 0,
  draggedCard: false,
  repositionOffsetX: 0,
  repositionOffsetY: 0,
  repositionZIndex: 0,
  waterTokenEles: [],
  cardScale: 70, // Percent of card and board size
  chatMax: 50, // As a view height property
  trayIsCamps: false,
  trayIsCards: true,
  currentChat: '',
  targetModePrefix: 'target_',
  targetMode: {
    enabled: false,
    type: '',
    help: '', // Friendly message to show the user
    cursor: '', // target-mode-section-* cursor class
    colorType: '',
    expectedTargetCount: 1,
    validTargets: [],
  },
  currentTargetIds: [],
  cardData: {
    scientistChoices: [],
    abilityCard: null, // card obj for multiple choice abilities
  },
};
const LOCAL_STORAGE = {
  cardScale: 'cardScale',
  repositionable: 'repositionable',
};

function init() {
  let alpineReady = false;
  let sharedReady = false;

  // Listen for Alpine to be done setting up
  document.addEventListener('alpine:initialized', () => {
    alpineReady = true;
    checkInit(alpineReady && sharedReady);
  });

  document.addEventListener('sharedReady', (e) => {
    sharedReady = true;
    checkInit(alpineReady && sharedReady);
  });
}
init();

function checkInit(status) {
  if (status) {
    alpineInit();
    applyChatMax();
    setupHotkeys();
  }
}

function alpineInit() {
  ui = Alpine.reactive(ui);
  gs = Alpine.reactive(gs);
  gs.bodyReady = true;

  try {
    if (localStorage.getItem(LOCAL_STORAGE.cardScale)) {
      ui.cardScale = localStorage.getItem(LOCAL_STORAGE.cardScale);
    }
  } catch (ls) {
    ui.cardScale = 70;
  }
  applyCardScale();

  Alpine.effect(() => {
    // Marginally less readable variables (wHy TWo flAgS?!) here but easy concise state in the UI
    ui.trayIsCamps = !ui.trayIsCards;
    ui.trayIsCards = !ui.trayIsCamps;
  });

  Alpine.effect(() => {
    localStorage.setItem(LOCAL_STORAGE.cardScale, ui.cardScale);
  });
}

function repositionStart(event) {
  ui.repositionOffsetX = event.offsetX;
  ui.repositionOffsetY = event.offsetY;
}

function repositionEnd(event, ele, coords) {
  if (!ele) {
    return;
  }
  if (!coords || !Array.isArray(coords) || coords.length < 2) {
    coords = [0, 0];
  }

  // Long winded one liner, but basically limit our left and top to within the window dimensions
  // Also account for where the mouse was on the draggable element when we started (that's coords)
  // And if we're scrolled on the page
  ele.style.left = Math.min(
    document.documentElement.scrollWidth - ele.offsetWidth,
    Math.max(0, event.clientX - coords[0] + window.scrollX),
  ) + 'px';
  ele.style.top = Math.min(
    document.documentElement.scrollHeight - ele.offsetHeight,
    Math.max(0, event.clientY - coords[1] + window.scrollY),
  ) + 'px';
  ele.style.bottom = 'auto';
  ele.style.right = 'auto';
  ele.style.zIndex = ++ui.repositionZIndex;

  if (ele.id) {
    try {
      const toStore = JSON.parse(localStorage.getItem(LOCAL_STORAGE.repositionable) || '{}');
      toStore[ele.id] = {
        left: ele.style.left,
        top: ele.style.top,
        zIndex: ele.style.zIndex,
      };
      localStorage.setItem(LOCAL_STORAGE.repositionable, JSON.stringify(toStore));
    } catch (ls) {}
  }
}

function repositionFromStorage(id) {
  try {
    const repositionable = JSON.parse(localStorage.getItem(LOCAL_STORAGE.repositionable) || '{}');

    if (
      repositionable[id] &&
      repositionable[id].left &&
      repositionable[id].top
    ) {
      const ele = document.getElementById(id);
      if (ele) {
        ele.style.zIndex = repositionable[id].zIndex ?? ++ui.repositionZIndex;
        ele.style.left = repositionable[id].left;
        ele.style.top = repositionable[id].top;
        ele.style.bottom = 'auto';
        ele.style.right = 'auto';
      }
    }
  } catch (ls) {}
}

function getTrayLegend() {
  if (ui.trayIsCards) {
    return `Your Hand (${getMyCards().length})`;
  } else {
    return 'Your Camps';
  }
}

function getMyCards() {
  return getPlayerData()?.cards || [];
}

function getMyCamps() {
  return getPlayerData()?.camps || [];
}

function getCampImage(camp) {
  // TODO Preload the DESTROYED image so it doesn't flicker when first being shown. Argument could be made to preload every card image in the background?
  return `images/cards/camps/${camp.isDestroyed ? 'DESTROYED.png' : camp.img}`;
}

function getOpponentCardCount() {
  if (gs.opponentPlayerNum) {
    return gs[gs.opponentPlayerNum]?.cards?.length || 0;
  }
  return 0;
}

function getOpponentCamps() {
  if (gs.opponentPlayerNum) {
    return gs[gs.opponentPlayerNum]?.camps || [];
  }
  return [];
}

function getOpponentSlots() {
  return gs.slots[gs.opponentPlayerNum];
}

function getSlots() {
  // Split our slots up into the opponent (index 0) and our player slots (index 1)
  // This allows us to share the same loop in the UI but easily differentiate which set of slots we're on
  return {
    [utils.getOppositePlayerNum(gs.myPlayerNum)]: getOpponentSlots(),
    [gs.myPlayerNum]: getMySlots(),
  };
}

function getMySlots() {
  return gs.slots[gs.myPlayerNum];
}

function getPlayerData() {
  if (gs.myPlayerNum) {
    return gs[gs.myPlayerNum];
  }
  return null;
}

function applyCardScale() {
  document.documentElement.style.setProperty('--card-scale', ui.cardScale / 100);
}

function applyChatMax(params) {
  if (params?.alsoUpdate) {
    // Reduce our max height to a minimum, then cycle back and start over
    ui.chatMax = ui.chatMax - 10 <= 0 ? 90 : ui.chatMax - 10;
  }
  document.documentElement.style.setProperty('--chat-max-height', ui.chatMax + 'vh');
}

function setupHotkeys() {
  window.addEventListener('keyup', (event) => {
    if (!event || document.activeElement?.tagName === 'INPUT') { // Skip hotkeys if we're typing in an input field
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'f') flipTray();
    else if (key === 't') focusChatIn();
    else if (key === 'd') userDrawCard();
    else if (key === 'w') userTakeWaterSilo(); // TODO Have this as a toggle so 'W' will junk the water silo if we already have it
    else if (key === 'u') userUndo(); // TODO Also have Ctrl+Z as an Undo hotkey?
    else if (key === 'e') userEndTurn();
  });
}

function flipTray() {
  ui.trayIsCards = !ui.trayIsCards;

  // Gimmick
  if (ui.$refs?.flipTray) {
    ui.$refs?.flipTray.classList.add('flip-tray-click');
    setTimeout(() => {
      ui.$refs?.flipTray.classList.remove('flip-tray-click');
    }, 305);
  }
}

function userTakeWaterSilo() {
  if (!getPlayerData().hasWaterSilo) {
    action.takeWaterSilo();
  }
}

function userDrawCard() {
  if (getPlayerData().waterCount >= 2) {
    action.drawCard({ fromWater: true });
  }
}

function userUndo() {
  action.undo();
}

function userEndTurn() {
  action.endTurn();
}

function focusChatIn() {
  if (ui.$refs?.chatIn) {
    ui.$refs.chatIn.focus();
  }
}

function scrollChatToBottom(ele) {
  Alpine.nextTick(() => {
    if (ele) {
      ele.scrollTop = ele.scrollHeight;
    }
  });
}

function showWaterCost(cost) {
  if (cost > getPlayerData().waterCount) {
    console.error('Not enough Water for desired action');
    return;
  }

  for (let i = 0; i < cost; i++) {
    ui.waterTokenEles[i]?.classList.add('water-token-cost');
  }
}

function hideWaterCost() {
  ui.waterTokenEles.forEach((water) => {
    water?.classList.remove('water-token-cost');
  });
}

function getCheapestAbility(card) {
  if (card && card.abilities?.length) {
    return Math.min(card.abilities.map((ability) => ability.cost || 0));
  }
  return 0;
}

function dragOverSlot(slot, ele) {
  // TODO Could determine if we have enough water to play the card and reject based on that (can't just disallow drag as we can still junk the card for no water)

  const isValid = utils.determineValidDropSlot(slot, getMySlots());
  if (!isValid) {
    return false;
  }

  dragOverHighlight(ele);
}

function dragOverHighlight(ele, overrideHighlight) {
  ele.classList.add(overrideHighlight ?? 'slot-highlight');
}

function dragLeaveHighlight(ele, overrideHighlight) {
  ele.classList.remove(overrideHighlight ?? 'slot-highlight');
}

function dropCardInJunk(ele) {
  dragLeaveHighlight(ele, 'fg-attention');

  action.junkCard({
    card: ui.draggedCard,
  });
}

function dropCardInSlot(slot, ele) {
  dragLeaveHighlight(ele);

  action.playCard({
    card: ui.draggedCard,
    slot: slot,
  });
}

function getDroppedCard(event) {
  let droppedCardId = event?.dataTransfer?.getData('text/plain');
  if (droppedCardId) {
    // Cast our droppedCardId from string to int
    droppedCardId = Number(droppedCardId);

    return getMyCards().find((card) => card.id === droppedCardId);
  }
}

function submitChat(ele) {
  action.chat({
    text: ui.currentChat,
  });
  ele.value = '';
}

function handleTargetClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (event?.target?.id) {
    const targetId = event.target.id.substring(ui.targetModePrefix.length);
    ui.currentTargetIds.push(targetId);

    if (ui.currentTargetIds.length >= ui.targetMode.expectedTargetCount) {
      disableTargetMode();

      action.doneTargets({ targets: ui.currentTargetIds });
    } else {
      event.target.classList.add('valid-target-selected');
    }
  }
}

function enableTargetMode(targetModeObj) {
  ui.targetMode = targetModeObj;
  ui.targetMode.enabled = true;
  setValidTargetsFromIds(ui.targetMode.validTargets);
}

function disableTargetMode() {
  ui.targetMode.enabled = false;
  setValidTargetsFromIds(ui.targetMode.validTargets, { removeInstead: true });
}

// Pass a list of card/camp/whatever IDs and we'll search the board and get the related elements and set them up as valid/invalid targets
// Optionally pass params.removeInstead to do similar but remove any targetting (such as when targetting is disabled)
function setValidTargetsFromIds(validTargets, params) { // params.removeInstead: boolean
  // Remove is a bit simpler, just do it by class - bit of hardcoding here, but that's okay
  if (params?.removeInstead) {
    const eles = [
      ...document.getElementsByClassName('valid-target'),
      ...document.getElementsByClassName('valid-target-selected'),
      ...document.getElementsByClassName('invalid-target'),
    ];
    eles.forEach((ele) => {
      ele.classList.remove('valid-target');
      ele.classList.remove('valid-target-selected');
      ele.classList.remove('invalid-target');
      ele.removeEventListener('click', handleTargetClick, true);
    });

    return;
  }

  // Determine if we're targetting our slots or all possible cards/camps
  let checkList = [];
  if (validTargets.some((target) => typeof target === 'string' && target.startsWith(SLOT_ID_PREFIX))) {
    checkList = [
      ...gs.slots[gs.myPlayerNum]
        .filter((slot) => {
          return validTargets.includes(SLOT_ID_PREFIX + slot.index);
        })
        .map((slot) => {
          return { id: SLOT_ID_PREFIX + slot.index };
        }),
      ...utils.getContentFromSlots(gs.slots.player1),
      ...utils.getContentFromSlots(gs.slots.player2),
    ];
  } else {
    checkList = [
      ...gs.player1.camps,
      ...utils.getContentFromSlots(gs.slots.player1),
      ...gs.player2.camps,
      ...utils.getContentFromSlots(gs.slots.player2),
      ...gs[gs.myPlayerNum].cards,
    ];
  }

  ui.currentTargetIds = [];

  checkList.forEach((thing) => {
    if (thing?.id) {
      const ele = document.getElementById(`${ui.targetModePrefix}${thing.id}`);
      if (ele) {
        if (validTargets.includes(String(thing.id))) {
          ele.classList.add('valid-target');
          ele.addEventListener('click', handleTargetClick, true); // useCapture flag to prevent default click action on the thing
        } else {
          ele.classList.add('invalid-target');
        }
      }
    }
  });
}
