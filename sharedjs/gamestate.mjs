const gs = {
  // TODO Define some other common functions
  basicTestCall() {
    return Date.now();
  },
};

if (typeof window !== 'undefined') {
  window.gs = gs;
}
export { gs };
