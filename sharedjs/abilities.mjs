globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// TTODO Flesh out card and camp and event abilities
const abilities = {};

if (onClient) {
  window.abilities = abilities;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { abilities };
