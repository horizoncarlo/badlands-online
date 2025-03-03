globalThis.ui = { // Local state
  inGame: false,
  bodyReady: false,
  drawAnimationCount: 0,
  draggedCard: false,
  repositionOffsetX: 0,
  repositionOffsetY: 0,
  repositionZIndex: 0,
  waterTokenEles: [],
  cardScale: 70, // Percent of card and board size
  waterScale: 100, // Percent of water disc size
  hoverScale: 125, // Percent for hovering any card to zoom in
  chatMax: 50, // As a view height property
  trayIsCamps: false,
  trayIsCards: true,
  targetModePrefix: 'target_',
  currentTimeLimit: null, // In milliseconds
  targetMode: {
    enabled: false,
    type: '',
    help: '', // Friendly message to show the user
    cursor: '', // target-mode-section-* cursor class
    colorType: '',
    expectedTargetCount: 1,
    hideCancel: false,
    validTargets: [],
  },
  currentTargetIds: [],
  componentData: {
    scientistChoices: [],
    mutantCardImg: null,
    mutantChoice: null, // See MUTANT_CHOICES for options
    abilityCard: null, // card obj for multiple choice abilities
    expectedDiscards: 1,
    myCards: [],
    gameOverType: null,
    gameOverCountdown: 10,
  },
};

function init(funcOnReady) {
  let alpineReady = false;
  let sharedReady = false;
  let websocketReady = false;

  // Listen for Alpine to be done setting up
  document.addEventListener('alpine:initialized', () => {
    alpineReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });

  document.addEventListener('sharedReady', (e) => {
    sharedReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });

  document.addEventListener('websocketReady', (e) => {
    websocketReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });
}
init(initGame);

function initGame(status) {
  if (status) {
    alpineInit();
    applyChatMax();
    setupHotkeys();

    sendC('lobby', {
      subtype: 'gamePageLoaded',
    });
  }
}

function alpineInit() {
  ui = Alpine.reactive(ui);
  gs = Alpine.reactive(gs);
  gs.bodyReady = true;

  preloadImages();

  try {
    if (localStorage.getItem(LOCAL_STORAGE.cardScale)) {
      ui.cardScale = localStorage.getItem(LOCAL_STORAGE.cardScale);
    }
  } catch (ls) {
    ui.cardScale = 70;
  }
  try {
    if (localStorage.getItem(LOCAL_STORAGE.waterScale)) {
      ui.waterScale = localStorage.getItem(LOCAL_STORAGE.waterScale);
    }
  } catch (ls) {
    ui.waterScale = 100;
  }
  try {
    if (localStorage.getItem(LOCAL_STORAGE.hoverScale)) {
      ui.hoverScale = localStorage.getItem(LOCAL_STORAGE.hoverScale);
    }
  } catch (ls) {
    ui.hoverScale = 125;
  }
  applyCardScale();
  applyWaterScale();
  applyHoverScale();

  Alpine.effect(() => {
    // Marginally less readable variables (wHy TWo flAgS?!) here but easy concise state in the UI
    ui.trayIsCamps = !ui.trayIsCards;
    ui.trayIsCards = !ui.trayIsCamps;
  });

  Alpine.effect(() => {
    localStorage.setItem(LOCAL_STORAGE.cardScale, ui.cardScale);
  });
  Alpine.effect(() => {
    localStorage.setItem(LOCAL_STORAGE.waterScale, ui.waterScale);
  });
  Alpine.effect(() => {
    localStorage.setItem(LOCAL_STORAGE.hoverScale, ui.hoverScale);
  });
}

function preloadImages() {
  new Image().src = getCampImage({ isDestroyed: true });
}

function leaveGame() {
  if (window.confirm('Are you sure you want to leave the game?')) {
    action.leaveGame();
  }
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
  return utils.fullCardPath(camp.isDestroyed ? { img: 'DESTROYED.png', drawCount: 0 } : camp);
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
  return gs[gs.opponentPlayerNum].slots;
}

function getSlots() {
  // Split our slots up into the opponent (index 0) and our player slots (index 1)
  // This allows us to share the same loop in the UI but easily differentiate which set of slots we're on
  return {
    [gs.opponentPlayerNum]: getOpponentSlots(),
    [gs.myPlayerNum]: getMySlots(),
  };
}

function getEvents() {
  // Split our events up in a similar way to slots
  return {
    [gs.opponentPlayerNum]: gs[gs.opponentPlayerNum].events,
    [gs.myPlayerNum]: gs[gs.myPlayerNum].events,
  };
}

function getMySlots() {
  return gs[gs.myPlayerNum].slots;
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

function applyWaterScale() {
  document.documentElement.style.setProperty('--water-scale', ui.waterScale / 100);
}

function applyHoverScale() {
  document.documentElement.style.setProperty('--hover-scale', ui.hoverScale / 100);
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

    if (ui.inGame) {
      if (key === 'f') flipTray();
      else if (key === 'd') userDrawCard();
      else if (key === 'w') {
        // Junk our Water Silo if we have it in hand, otherwise take it
        const hasWaterSilo = getMyCards()?.find((card) => card.isWaterSilo);
        if (hasWaterSilo) {
          action.junkCard({
            card: hasWaterSilo,
          });
        } else {
          userTakeWaterSilo();
        }
      } else if (key === 'u') userUndo(); // TODO Also have Ctrl+Z as an Undo hotkey?
      else if (key === 'e') userEndTurn();
    }
  });
}

function flipTray() {
  ui.trayIsCards = !ui.trayIsCards;

  if (ui.$refs?.flipTray) {
    ui.$refs?.flipTray.classList.add('flip-tray-click');
    setTimeout(() => { // Gimmick for style points
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
  if (utils.cardIsEvent(ui.draggedCard)) {
    return false;
  }

  const isValid = utils.determineValidDropSlot(slot, getMySlots());
  if (!isValid) {
    return false;
  }

  dragOverHighlight(ele);
}

function dragOverEvent(event, ele) {
  if (utils.cardIsEvent(ui.draggedCard)) {
    dragOverHighlight(ele);
  }
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

function dropCardInGame(target, ele) {
  dragLeaveHighlight(ele);

  const playMessage = {
    card: ui.draggedCard,
  };

  // Pass along our slot if we're playing a non-event onto the board
  if (!utils.cardIsEvent(ui.draggedCard)) {
    playMessage['slot'] = target;
  }

  action.playCard(playMessage);
}

function getDroppedCard(event) {
  let droppedCardId = event?.dataTransfer?.getData('text/plain');
  if (droppedCardId) {
    // Cast our droppedCardId from string to int
    droppedCardId = Number(droppedCardId);

    return getMyCards().find((card) => card.id === droppedCardId);
  }
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

  // If our targets are ALL camps then flip our tray as needed
  if (!ui.trayIsCamps) {
    const idSet = new Set(getMyCamps().map((camp) => camp.id));
    const onlyCamps = ui.targetMode.validTargets.every((campId) => idSet.has(parseInt(campId)));
    if (onlyCamps) {
      flipTray();
    }
  }

  // Apply our colors
  const root = document.querySelector(':root');
  if (root) {
    root.style.setProperty('--target-mode', `var(--${ui.targetMode.colorType})`);
    root.style.setProperty('--target-mode-fg', `var(--fg-${ui.targetMode.colorType})`);
    root.style.setProperty('--target-mode-bg', `var(--bg-${ui.targetMode.colorType})`);
  }

  setValidTargetsFromIds(ui.targetMode.validTargets);
}

function formatTimer(toFormat) {
  function pad(val) {
    return val >= 10 ? val : ('0' + val);
  }

  const ms = toFormat % 1000;
  toFormat = (toFormat - ms) / 1000;
  const secs = toFormat % 60;
  toFormat = (toFormat - secs) / 60;
  const mins = toFormat % 60;

  // Output Minutes only if found, otherwise Seconds
  return `${mins > 0 ? (pad(mins) + 'm : ') : ''}${pad(secs)}s`;
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
      ...gs[gs.myPlayerNum].slots
        .filter((slot) => {
          return validTargets.includes(SLOT_ID_PREFIX + slot.index);
        })
        .map((slot) => {
          return { id: SLOT_ID_PREFIX + slot.index };
        }),
      ...utils.getContentFromSlots(gs.player1.slots),
      ...utils.getContentFromSlots(gs.player2.slots),
    ];
  } else {
    checkList = [
      ...gs.player1.camps,
      ...utils.getContentFromSlots(gs.player1.slots),
      ...gs.player2.camps,
      ...utils.getContentFromSlots(gs.player2.slots),
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
