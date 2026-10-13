import { expect, test } from '@playwright/test';
import {
  expectReducedMotion,
  expectVisibleKeyboardFocus,
} from './ui-assertions';

test('focus checks accept different ring designs and reject a removed indicator', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      button { outline: none; border: 0; box-shadow: none; }
      button:focus-visible { box-shadow: 0 0 0 3px blue; }
    </style>
    <button>Example action</button>
  `);
  const button = page.getByRole('button');

  await expectVisibleKeyboardFocus(button);
  await button.blur();
  await page.addStyleTag({
    content: 'button:focus-visible { box-shadow: none; }',
  });
  await expect(expectVisibleKeyboardFocus(button, 250)).rejects.toThrow();
});

test('reduced-motion checks accept equivalent styling and reject movement', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      button { transform: matrix(1, 0, 0, 1, 0, 0); transition-duration: 0.001s; }
    </style>
    <button>Example action</button>
  `);
  const button = page.getByRole('button');

  await expectReducedMotion(button);
  await page.addStyleTag({
    content: 'button { transform: translateY(-2px); }',
  });
  await expect(expectReducedMotion(button, 250)).rejects.toThrow();
  await page.addStyleTag({
    content: 'button { transform: none; transition-duration: 0.5s; }',
  });
  await expect(expectReducedMotion(button, 250)).rejects.toThrow();
});
