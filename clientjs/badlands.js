let ui = { // Local state
  inGame: false,
  drawAnimationCount: 0,
  draggedCard: false,
  repositionOffsetX: 0,
  repositionOffsetY: 0,
  waterTokenEles: [],
  cardScale: 70, // Percent of card and board size
  chatMax: 50, // As a view height property
  trayIsCamps: false,
  trayIsCards: true,
  currentChat: '',
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
    applyCardScale();
    applyChatMax();
    setupHotkeys();
  }
}

function alpineInit() {
  ui = Alpine.reactive(ui);
  gs = Alpine.reactive(gs);
  gs.bodyReady = true;

  Alpine.effect(() => {
    // Marginally less readable variables (wHy TWo flAgS?!) here but easy concise state in the UI
    ui.trayIsCamps = !ui.trayIsCards;
    ui.trayIsCards = !ui.trayIsCamps;
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
  // TODO Should use a global `ui` var for z-index that increases and applies to the dragged element, so we can nautrally layer them with last dragged on top
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

function getSlots() {
  return {
    [utils.getOppositePlayerNum(gs.myPlayerNum)]: getOpponentSlots(),
    [gs.myPlayerNum]: getMySlots(),
  };
}

function getMySlots() {
  return gs.slots[gs.myPlayerNum];
}

function getOpponentSlots() {
  return gs.slots[utils.getOppositePlayerNum(gs.myPlayerNum)];
}

function getPlayerData() {
  if (gs.myPlayerNum) {
    return gs[gs.myPlayerNum];
  }
  return null;
}

function showCampPromptDialog() {
  document.getElementById('campPromptDialog')?.showModal();
}

function hideCampPromptDialog() {
  document.getElementById('campPromptDialog')?.close();
}

function selectedCampCount() {
  return getMyCamps().filter((camp) => camp.selected).length;
}

function selectedCampDrawCount() {
  return getMyCamps().reduce((total, camp) => total + (camp.selected ? camp.drawCount : 0), 0);
}

function chooseCamp(camp) {
  if (camp.selected || selectedCampCount() < 3) {
    camp.selected = !camp.selected;
  }
}

function doneChooseCamps() {
  if (selectedCampCount() !== 3) {
    return;
  }

  // TODO Need to better decide where we handle UI updates - probably should be moved to the action itself instead of split here and in the action
  //      For example should update our player data in a single place. Similar to the validation and finding logic in dropCardInSlot
  //      I think some of the confusion comes from having to pass a message, when really we should pass state and build a message on the client for the action.*
  //      But that works less great for the idea of a consistent function both client and server can call. So maybe all the pre-logic SHOULD be here before the action
  //      In either case it's client JS - just need to know where it should be and stick to it
  //      action.joinGame is another example of a slightly inconsistent approach as it takes state instead of a message like the approach just mentioned
  getPlayerData().camps = getMyCamps().filter((camp) => camp.selected);

  action.doneCamps({ camps: getPlayerData().camps });

  hideCampPromptDialog();
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
  });
}

function flipTray() {
  ui.trayIsCards = !ui.trayIsCards;
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
    console.error('Not enough water for desired action');
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

function dragOverSlot(slot, playerNum, ele) {
  if (gs.myPlayerNum !== playerNum || slot.content || !ui.draggedCard) {
    return false;
  }

  dragOverHighlight(playerNum, ele);
}

function dragOverHighlight(playerNum, ele, overrideHighlight) {
  if (gs.myPlayerNum !== playerNum || !ui.draggedCard) {
    return false;
  }

  ele.classList.add(overrideHighlight ?? 'slot-highlight');
}

function dragLeaveHighlight(ele) {
  ele.classList.remove('slot-highlight');
}

function dropCardInJunk(ele) {
  dragLeaveHighlight(ele);

  action.junkCard({
    card: ui.draggedCard,
  });
}

function dropCardInSlot(slot, playerNum, ele) {
  dragLeaveHighlight(ele);

  if (slot.content) {
    console.error('Card already here');
    return false;
  }

  if (ui.draggedCard.cost > getPlayerData().waterCount) {
    // TODO Proper error component or logging - maybe shake the water token wrapper panel
    console.error('Not enough water to play that card');
    return;
  }

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
