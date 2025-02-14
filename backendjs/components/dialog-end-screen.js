function showEndScreenDialog(message) {
  ui.componentData.gameOverType = message.details.type;

  setInterval(() => {
    if (ui.componentData.gameOverCountdown > 0) {
      ui.componentData.gameOverCountdown -= 1;
    }
  }, 999);

  document.getElementById('endScreenDialog')?.showModal();
}

function isWin() {
  return ui.componentData.gameOverType && ui.componentData.gameOverType === 'win';
}

function isLose() {
  return ui.componentData.gameOverType && ui.componentData.gameOverType === 'lose';
}

function isTie() {
  return ui.componentData.gameOverType && ui.componentData.gameOverType === 'tie';
}
