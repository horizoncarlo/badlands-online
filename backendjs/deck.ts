const DECK_IMAGE_EXTENSION = '.png'; // In case we want smaller filesize JPGs in the future

let maxCardId = 0;

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

const createNewDeck = (): Array<any> => { // TODO Card typing
  // TODO Loose card structure?
  // {
  //   id: 1,
  //   name: "Wounded Soldier",
  //   img: "Wounded-Soldier.png",
  //   cost: 1,
  //   abilities: [
  //     {
  //       cost: 1,
  //       symbol: "Damage",
  //     }
  //   ],
  //   traits: [
  //     {
  //       text: "When this card enters play, [draw]. Then, damage [damage] this card"
  //     }
  //   ]
  // }
  // TODO Populate the deck properly
  const dupePeople = [
    { img: 'assassin', cost: 1, junkEffect: 'raid' },
    { img: 'cult_leader', cost: 1, junkEffect: 'draw' },
    { img: 'doomsayer', cost: 1, junkEffect: 'draw' },
    { img: 'exterminator', cost: 1, junkEffect: 'draw' },
    { img: 'gunner', cost: 1, junkEffect: 'restore' },
    { img: 'holdout', cost: 2, junkEffect: 'raid' },
    { img: 'looter', cost: 1, junkEffect: 'water' },
    { img: 'mimic', cost: 1, junkEffect: 'injure' },
    { img: 'muse', cost: 1, junkEffect: 'water' },
    { img: 'mutant', cost: 1, junkEffect: 'injure' },
    { img: 'pyromaniac', cost: 1, junkEffect: 'injure' },
    { img: 'rabble_rouser', cost: 1, junkEffect: 'raid' },
    { img: 'repair_bot', cost: 1, junkEffect: 'injure' },
    { img: 'rescue_team', cost: 1, junkEffect: 'injure' },
    { img: 'scientist', cost: 1, junkEffect: 'raid' },
    { img: 'scout', cost: 1, junkEffect: 'water' },
    { img: 'sniper', cost: 1, junkEffect: 'restore' },
    { img: 'vanguard', cost: 1, junkEffect: 'raid' },
    { img: 'vigilante', cost: 1, junkEffect: 'raid' },
    { img: 'wounded_soldier', cost: 1, junkEffect: 'injure' },
  ];
  const uniqPeople = [
    { img: 'argo_yesky', cost: 3 },
    { img: 'karli_blaze', cost: 3 },
    { img: 'magnus_karv', cost: 3 },
    { img: 'molgur_stang', cost: 4 },
    { img: 'vera_vosh', cost: 3 },
    { img: 'zeto_khan', cost: 3 },
  ].map((uniq) => {
    uniq['junkEffect'] = 'gainPunk';
    return uniq;
  });
  // TODO For now keep events out for simplicity
  const dupeEvents = [];
  // const dupeEvents = [
  //   { img: 'banish', cost: 1 },
  //   { img: 'bombardment', cost: 4 },
  //   { img: 'famine', cost: 1 },
  //   { img: 'high_ground', cost: 0 },
  //   { img: 'interrogate', cost: 1 },
  //   { img: 'napalm', cost: 2 },
  //   { img: 'radiation', cost: 2 },
  //   { img: 'strafe', cost: 2 },
  //   { img: 'truce', cost: 2 },
  //   { img: 'uprising', cost: 1 },
  // ];

  const deck = _shuffleNewDeck([
    ...uniqPeople,
    ...structuredClone(dupePeople),
    ...structuredClone(dupePeople),
    ...structuredClone(dupeEvents),
    ...structuredClone(dupeEvents),
  ]);

  return deck;
};

const _shuffleNewDeck = (array) => {
  array = shuffleDeck(array);

  // Assign image extensions to every item and a random ID
  array.forEach((card, index) => {
    maxCardId++;
    card.img += DECK_IMAGE_EXTENSION;
    card.id = maxCardId + index + 1;
  });
  return array;
};

const shuffleDeck = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

export { createCampDeck, createNewDeck, shuffleDeck };
