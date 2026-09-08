// Review-only network boundary. The production application is otherwise unchanged.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === 'https://api.openai.com/v1/responses') {
    return original('http://127.0.0.1:55441/mock/openai', init);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('REVIEW_EXTERNAL_NETWORK_BLOCKED');
  }
  return original(input, init);
};
