## DREAM LIST

- Lobby system
  - Public games, private games w/ password, observers or not
- Different card backs
- Chat
- Observers / watching games
  - Can choose which side to view from, to get all card knowledge or not (depending on observer settings)
- How to play or link/embed to an existing video
- Fancy card highlighting and arrows
- Action log
  - Integrate with chat?
- Timer option
- Sound effects
- Scalable visually
- Mobile friendly?
  - Probably way too tight to realistically fit everything in
- Expandable for card additions and fixes
- Clickable silly things on the board like Hearthstone
- Undo, revert to start of turn, etc.
- Save replay
- Session timeout from idleness

## TECH

- Websockets for communication entirely - pushing obviously, but also instead of endpoints for player interactions
- Instead of thinking like HTTP where we need to send everything in a single response, can instead send multiple simple
  messages that the client reacts to
  - ie: add a chat message, destroy a camp, do 1 damage to card XYZ, etc.
- So the Websocket response would be more like an instruction set of what to do to the client state

- Deno on the server
  - Could consider deploying with Deno Deploy? https://deno.com/deploy/pricing

- Prototype a basic board, no events, no raiders, no water tower
- Scrape a basic set of 5 cards and 3 camps
- Camps, 3 columns each, get a hand of cards, can drag onto the board
- PAIN POINTS: Components?
