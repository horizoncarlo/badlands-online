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
  if (selectedCampCount() !== CORRECT_CAMP_NUM) {
    return;
  }

  // TODO Need to better decide where we handle UI updates - probably should be moved to the action itself instead of split here and in the action
  //      For example should update our player data in a single place. Similar to the validation and finding logic in dropCardInSlot
  //      I think some of the confusion comes from having to pass a message, when really we should pass state and build a message on the client for the action.*
  //      But that works less great for the idea of a consistent function both client and server can call. So maybe all the pre-logic SHOULD be here before the action
  //      In either case it's client JS - just need to know where it should be and stick to it
  //      action.joinGame is another example of a slightly inconsistent approach as it takes state instead of a message like the approach just mentioned
  getPlayerData().camps = getMyCamps().filter((camp) => camp.selected);
  getPlayerData().doneCamps = true;

  action.doneCamps({ camps: getPlayerData().camps });

  hideCampPromptDialog();
}
