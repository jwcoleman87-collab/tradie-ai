// Review-only network boundary. The production application is otherwise unchanged.
const gateway = new URL(
  process.env.E2E_GATEWAY_ORIGIN || 'http://127.0.0.1:55441',
);
if (
  gateway.protocol !== 'http:' ||
  gateway.hostname !== '127.0.0.1' ||
  gateway.username ||
  gateway.password
)
  throw new Error('REVIEW_REQUIRES_LOOPBACK_GATEWAY');
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === 'https://api.openai.com/v1/responses') {
    return original(new URL('/mock/openai', gateway), init);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('REVIEW_EXTERNAL_NETWORK_BLOCKED');
  }
  return original(input, init);
};
