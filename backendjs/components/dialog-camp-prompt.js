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

  getPlayerData().camps = getMyCamps().filter((camp) => camp.selected);
  getPlayerData().doneCamps = true;

  action.doneCamps({ camps: getPlayerData().camps });

  hideCampPromptDialog();
}
