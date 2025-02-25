import { utils } from '../sharedjs/utils.mjs';

let currentCardId = 10; // Start with some breathing room for special case cards like Archive

const createCampDeck = (): Array<any> => { // TODO Camp typing
  return _shuffleNewDeck([
    { img: 'adrenaline_lab', drawCount: 1 },
    { img: 'arcade', drawCount: 1 },
    { img: 'atomic_garden', drawCount: 1 },
    { img: 'bonfire', drawCount: 1 },
    { img: 'blood_bank', drawCount: 1 },
    { img: 'cannon', drawCount: 1 },
    { img: 'cache', drawCount: 1 },
    { img: 'catapult', drawCount: 0 },
    { img: 'command_post', drawCount: 2 },
    { img: 'construction_yard', drawCount: 2 },
    { img: 'garage', drawCount: 0 },
    { img: 'juggernaut', drawCount: 0 },
    { img: 'labor_camp', drawCount: 1 },
    { img: 'mercenary_camp', drawCount: 0 },
    { img: 'mulcher', drawCount: 0 },
    { img: 'nest_of_spies', drawCount: 1 },
    { img: 'oasis', drawCount: 1 },
    { img: 'obelisk', drawCount: 3 },
    { img: 'omen_clock', drawCount: 1 },
    { img: 'outpost', drawCount: 1 },
    { img: 'parachute_base', drawCount: 1 },
    { img: 'pillbox', drawCount: 1 },
    { img: 'railgun', drawCount: 0 },
    { img: 'reactor', drawCount: 1 },
    { img: 'resonator', drawCount: 1 },
    { img: 'scavenger_camp', drawCount: 1 },
    { img: 'scud_launcher', drawCount: 0 },
    { img: 'supply_depot', drawCount: 2 },
    { img: 'the_octagon', drawCount: 0 },
    { img: 'training_camp', drawCount: 1 },
    { img: 'transplant_lab', drawCount: 2 },
    { img: 'victory_totem', drawCount: 1 },
    { img: 'warehouse', drawCount: 1 },
    { img: 'watchtower', drawCount: 0 },
  ]);
};

const createDemoDeck = (): Array<any> => {
  return createNewDeck({ isDemo: true });
};

const createNewDeck = (params?: { isDemo?: boolean }): Array<any> => { // TODO Card typing
  const dupePeople = [
    { img: 'assassin', cost: 1, recycleEffect: 'virus', abilities: [{ cost: 2, abilityEffect: 'assassin' }] },
    { img: 'cult_leader', cost: 1, recycleEffect: 'drawCard', abilities: [{ cost: 0, abilityEffect: 'cultLeader' }] },
    { img: 'doomsayer', cost: 1, recycleEffect: 'drawCard', abilities: [{ cost: 1, abilityEffect: 'doomsayer' }] },
    { img: 'exterminator', cost: 1, recycleEffect: 'drawCard', abilities: [{ cost: 1, abilityEffect: 'exterminator' }] },
    { img: 'gunner', cost: 1, recycleEffect: 'patchCard', abilities: [{ cost: 2, abilityEffect: 'gunner' }] },
    { img: 'holdout', cost: 2, recycleEffect: 'virus', abilities: [{ cost: 1, abilityEffect: 'bugCard' }] },
    { img: 'looter', cost: 1, recycleEffect: 'gainMemory', abilities: [{ cost: 2, abilityEffect: 'looter' }] },
    { img: 'mimic', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 0, abilityEffect: 'mimic' }] },
    { img: 'muse', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 0, abilityEffect: 'gainMemory' }] },
    { img: 'mutant', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 0, abilityEffect: 'mutant' }] },
    { img: 'pyromaniac', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 1, abilityEffect: 'pyromaniac' }] },
    {
      img: 'rabble_rouser',
      cost: 1,
      recycleEffect: 'virus',
      abilities: [{ cost: 1, abilityEffect: 'gainPrototype' }, { cost: 1, abilityEffect: 'rabbleRouser' }],
    },
    { img: 'repair_bot', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 2, abilityEffect: 'patchCard' }] },
    { img: 'rescue_team', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 0, abilityEffect: 'rescueTeam' }] },
    { img: 'scientist', cost: 1, recycleEffect: 'virus', abilities: [{ cost: 1, abilityEffect: 'scientist' }] },
    { img: 'scout', cost: 1, recycleEffect: 'gainMemory', abilities: [{ cost: 1, abilityEffect: 'virus' }] },
    { img: 'sniper', cost: 1, recycleEffect: 'patchCard', abilities: [{ cost: 2, abilityEffect: 'sniper' }] },
    { img: 'vanguard', cost: 1, recycleEffect: 'virus', abilities: [{ cost: 1, abilityEffect: 'vanguard' }] },
    { img: 'vigilante', cost: 1, recycleEffect: 'virus', abilities: [{ cost: 1, abilityEffect: 'exploitProgram' }] },
    { img: 'wounded_soldier', cost: 1, recycleEffect: 'exploitProgram', abilities: [{ cost: 1, abilityEffect: 'bugCard' }] },
  ];
  const uniqPeople = [
    { img: 'argo_yesky', cost: 3, abilities: [{ cost: 1, abilityEffect: 'bugCard' }] },
    { img: 'karli_blaze', cost: 3, abilities: [{ cost: 1, abilityEffect: 'bugCard' }] },
    { img: 'magnus_karv', cost: 3, abilities: [{ cost: 2, abilityEffect: 'magnusKarv' }] },
    { img: 'molgur_stang', cost: 4, abilities: [{ cost: 1, abilityEffect: 'molgurStang' }] },
    { img: 'vera_vosh', cost: 3, abilities: [{ cost: 1, abilityEffect: 'exploitProgram' }] },
    { img: 'zeto_khan', cost: 3, abilities: [{ cost: 1, abilityEffect: 'zetoKhan' }] },
  ].map((uniq) => {
    uniq['recycleEffect'] = 'gainPrototype';
    return uniq;
  });
  const dupeEvents = [
    { img: 'banish', cost: 1, startSpace: 1, recycleEffect: 'virus', abilityEffect: 'banish' },
    { img: 'bombardment', cost: 4, startSpace: 3, recycleEffect: 'patchCard', abilityEffect: 'bombardment' },
    { img: 'famine', cost: 1, startSpace: 1, recycleEffect: 'exploitProgram', abilityEffect: 'famine' },
    { img: 'high_ground', cost: 0, startSpace: 1, recycleEffect: 'gainMemory', abilityEffect: 'highGround' },
    { img: 'interrogate', cost: 1, startSpace: 0, recycleEffect: 'gainMemory', abilityEffect: 'interrogate' },
    { img: 'napalm', cost: 2, startSpace: 1, recycleEffect: 'patchCard', abilityEffect: 'napalm' },
    { img: 'radiation', cost: 2, startSpace: 1, recycleEffect: 'virus', abilityEffect: 'radiation' },
    { img: 'strafe', cost: 2, startSpace: 0, recycleEffect: 'drawCard', abilityEffect: 'strafe' },
    { img: 'truce', cost: 2, startSpace: 0, recycleEffect: 'exploitProgram', abilityEffect: 'truce' },
    { img: 'uprising', cost: 1, startSpace: 2, recycleEffect: 'exploitProgram', abilityEffect: 'uprising' },
  ];

  let deck = [];
  if (params?.isDemo) {
    deck = _shuffleNewDeck([
      ...uniqPeople,
      ...structuredClone(dupePeople),
      ...structuredClone(dupeEvents),
    ]);
    deck = deck.concat(createCampDeck());
  } else {
    deck = _shuffleNewDeck([
      ...uniqPeople,
      ...structuredClone(dupePeople),
      ...structuredClone(dupePeople),
      ...structuredClone(dupeEvents),
      ...structuredClone(dupeEvents),
    ]);
  }

  return deck;
};

const _shuffleNewDeck = (array) => {
  array = utils.shuffleDeck(array);

  // Assign image extensions to every item and a sequential ID
  array.forEach((card) => {
    currentCardId++;
    card.id = currentCardId;
    card.img += DECK_IMAGE_EXTENSION;
  });
  return array;
};

export { createCampDeck, createDemoDeck, createNewDeck };
