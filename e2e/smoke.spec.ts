import { expect, test } from './fixtures';

test('service worker is the Cinder Wallet extension', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
