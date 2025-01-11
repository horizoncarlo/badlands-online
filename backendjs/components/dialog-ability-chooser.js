function showAbilityChooserDialog(forCard) {
  if (forCard) {
    ui.cardData.abilityCard = forCard;
    document.getElementById('abilityChooserDialog')?.showModal();
  }
}

function hideAbilityChooserDialog() {
  document.getElementById('abilityChooserDialog')?.close();
  ui.cardData.abilityCard = null;
}

function chooseAbilityOnCard(abilityIndex) {
  action.useCard({ card: ui.cardData.abilityCard }, abilityIndex);
  hideAbilityChooserDialog();
}

function handleKeyup(event) {
  const asNum = parseInt(event?.key);
  if (
    typeof asNum === 'number' && !isNaN(asNum) &&
    asNum >= 1 && asNum <= ui.cardData.abilityCard.abilities.length
  ) {
    chooseAbilityOnCard(asNum - 1); // Go back to zero based
  }
}
