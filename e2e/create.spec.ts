import { expect, test } from './fixtures';
import { openPopup, TEST_PASSWORD } from './popup';

test('create new wallet through reveal, quiz, and password', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const page = await openPopup(context, extensionId);

  await page.getByTestId('create-new-wallet').click();
  await page.getByTestId('reveal-seed').click();
  const words = await page.getByTestId('seed-word').allTextContents();
  expect(words).toHaveLength(12);
  await expect(page.getByTestId('seed-continue')).toBeEnabled();
  await page.getByTestId('seed-continue').click();
  await expect(page.getByTestId('seed-verify-input')).toBeVisible();

  const fields = page.locator('input[placeholder^="Word "]');
  const count = await fields.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i += 1) {
    const placeholder = await fields.nth(i).getAttribute('placeholder');
    const index = Number(placeholder?.replace('Word ', '')) - 1;
    expect(words[index]).toBeTruthy();
    await fields.nth(i).fill(words[index]);
  }
  await expect(page.getByTestId('seed-verify-submit')).toBeEnabled();
  await page.getByTestId('seed-verify-submit').click();

  await page.getByTestId('password-input').fill(TEST_PASSWORD);
  await page.getByTestId('password-confirm').fill(TEST_PASSWORD);
  await expect(page.getByTestId('password-submit')).toBeEnabled();
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('open-receive')).toBeVisible({ timeout: 30_000 });
});
