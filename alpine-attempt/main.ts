import { serveFile } from 'jsr:@std/http/file-server';

const DEFAULT_PORT = 2000;
const DEFAULT_HOSTNAME = 'localhost'; // Or 0.0.0.0 for public

const handler = (req: Request) => {
  const url = new URL(req.url);
  let filePath = url.pathname;

  if (filePath === '/') {
    filePath += 'game.html';
  }

  return serveFile(req, '.' + filePath);
};

/* TODO HTTPS support
  port: 443,
  cert: Deno.readTextFileSync("./cert.pem"),
  key: Deno.readTextFileSync("./key.pem"),
*/
Deno.serve({ port: DEFAULT_PORT, hostname: DEFAULT_HOSTNAME }, handler);
