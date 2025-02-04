function showAbilityChooserDialog(forCard) {
  if (forCard) {
    ui.componentData.abilityCard = forCard;
    document.getElementById('abilityChooserDialog')?.showModal();
  }
}

function hideAbilityChooserDialog() {
  document.getElementById('abilityChooserDialog')?.close();
  ui.componentData.abilityCard = null;
}

function chooseAbilityOnCard(abilityIndex) {
  action.useCard({ details: { card: ui.componentData.abilityCard } }, abilityIndex);
  hideAbilityChooserDialog();
}

function handleKeyup(event) {
  const asNum = parseInt(event?.key);
  if (
    typeof asNum === 'number' && !isNaN(asNum) &&
    asNum >= 1 && asNum <= ui.componentData.abilityCard.abilities.length
  ) {
    chooseAbilityOnCard(asNum - 1); // Go back to zero based
  }
}
