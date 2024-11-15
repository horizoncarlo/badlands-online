import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { gs } from './sharedjs/gamestate.mjs';

const DEFAULT_PORT = 2000;
const DEFAULT_HOSTNAME = 'localhost'; // Or 0.0.0.0 for public
const PRIVATE_FILE_LIST = ['deno.jsonc', 'deno.lock', 'main.ts'];

const handler = async (req: Request) => {
  const url = new URL(req.url);
  const filePath = url.pathname;

  if (filePath === '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 });

    socket.addEventListener('open', () => {
      // TODO Unlike Bun, we'll need to do our own group sub/unsub management to broadcast to each Websocket we're managing that matches some session/game ID we setup. See https://bun.sh/guides/websocket/pubsub
      // console.log("WS client connected!");
    });
    socket.addEventListener('message', (event) => {
      try {
        const dataJSON = JSON.parse(event.data);
        if (dataJSON.field === 'ping') {
          socket.send(JSON.stringify({
            'field': 'pong',
          }));
        }
      } catch (err) {
        console.error('Websocket Message error', err); // TODO Probably can just silently ignore these as it'd just be bad/junk data coming in
      }
    });
    return response;
  } else if (filePath === '/' || filePath === '/game.html') {
    // Get our main HTML to return, but replace any templating variables first
    let html = await Deno.readTextFile('./game.html');

    html = html.replace('${PLAYER_ID}', uuidv4());
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Block access to any restricted files
  if (PRIVATE_FILE_LIST.find((item) => filePath.toLowerCase().indexOf(item) !== -1)) {
    console.error('Requested a private file, aborting', filePath);
    return new Response(null, { status: 401 });
  }

  return serveFile(req, '.' + filePath);
};

console.log('TODO shared code test (Deno side)', gs.basicTestCall());

/* TODO HTTPS support
  port: 443,
  cert: Deno.readTextFileSync("./cert.pem"),
  key: Deno.readTextFileSync("./key.pem"),
*/
Deno.serve({ port: DEFAULT_PORT, hostname: DEFAULT_HOSTNAME }, handler);
