let doneDiscard = false;

function showDiscardDialog(message, params) { // params.allowWaterSilo: boolean to let Water Silo be discarded or not
  doneDiscard = false;
  ui.cardData.expectedDiscards = message.details.expectedDiscards ?? 1;
  ui.cardData.myCards = message.details.cardChoices ?? getMyCards();

  // Filter out the Water Silo as an option if requested
  if (!params || !params.allowWaterSilo) {
    ui.cardData.myCards = ui.cardData.myCards.filter((card) => !card.isWaterSilo);
  }

  document.getElementById('discardDialog')?.showModal();
}

function hideDiscardDialog() {
  document.getElementById('discardDialog')?.close();
}

function doneChooseDiscards(selectedDiscards) {
  if (selectedDiscards?.length === ui.cardData.expectedDiscards) {
    selectedDiscards.forEach((card) => {
      sendC('discardCard', { card: card });
    });
    selectedDiscards.length = 0; // Clear our discard selections

    // Clear after a bit of a delay to match the server throttling
    setTimeout(() => {
      doneDiscard = true;
      hideDiscardDialog();
    }, 100);
  }
}

function chooseDiscardCard(card, selectedDiscards) {
  if (isSelectedDiscard(card, selectedDiscards)) {
    selectedDiscards?.splice(selectedDiscards?.indexOf(card), 1);
  } else {
    selectedDiscards?.push(card);
  }

  // If we only had a single select just auto-submit it
  if (ui.cardData.expectedDiscards === 1 && selectedDiscards?.length === 1) {
    doneChooseDiscards();
  }
}

function isSelectedDiscard(card, selectedDiscards) {
  return selectedDiscards?.includes(card);
}
