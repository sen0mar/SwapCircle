import { expect, type Locator } from '@playwright/test';

// Focus styling can change, but keyboard focus must remain visibly distinct.
export async function expectVisibleKeyboardFocus(
  control: Locator,
  timeout = 5000,
) {
  const indicator = () =>
    control.evaluate((element) => {
      const style = getComputedStyle(element);

      return [
        style.outlineStyle,
        style.outlineWidth,
        style.outlineColor,
        style.boxShadow,
        style.borderColor,
      ].join('|');
    });
  const resting = await indicator();

  await control.page().keyboard.press('Tab');
  await control.focus();
  await expect(control).toBeFocused();
  await expect.poll(indicator, { timeout }).not.toBe(resting);
}

// Accept equivalent identity transforms and negligible accessibility durations.
export async function expectReducedMotion(control: Locator, timeout = 5000) {
  // Let a hover/press style reach a rendered frame before inspecting movement.
  await control.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  await expect
    .poll(
      () =>
        control.evaluate((element) => {
          const style = getComputedStyle(element);
          const durations = [style.transitionDuration, style.animationDuration]
            .flatMap((value) => value.split(','))
            .map((value) => Number.parseFloat(value));

          return (
            (style.transform === 'none' ||
              new DOMMatrixReadOnly(style.transform).isIdentity) &&
            durations.every((seconds) => seconds <= 0.01)
          );
        }),
      { timeout },
    )
    .toBe(true);
}
