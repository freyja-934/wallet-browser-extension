import { expect, test } from './fixtures';

test('service worker is the Lumen extension', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
