import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOTS_ENABLED = process.env.STAR_MAP_SCREENSHOTS === "1";
const SCREENSHOT_DIRECTORY = resolve(".scratch/playwright/star-map-macbook");
const OVERLAY_SELECTORS = [
  ".immersive-map .explorer-heading",
  ".immersive-map .map-hud-intro",
  ".immersive-map .map-route-status",
  ".immersive-map .explorer-toolbar",
  ".immersive-map .map-hud-inspector",
  ".immersive-map .explorer-legend",
  ".immersive-map .camera-help",
  ".app-hud-controls",
  ".app-hud-results",
  ".masthead",
  ".app-footer",
] as const;

type OverlayBox = {
  readonly selector: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

test.beforeAll(async () => {
  if (SCREENSHOTS_ENABLED) {
    await rm(SCREENSHOT_DIRECTORY, { recursive: true, force: true });
  }
});

async function captureStage(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS_ENABLED) {
    return;
  }
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
      }),
  );
  await page.waitForTimeout(150);
  await page.screenshot({
    path: resolve(SCREENSHOT_DIRECTORY, `${name}.png`),
    fullPage: false,
  });
}

async function visibleOverlayBoxes(page: Page): Promise<readonly OverlayBox[]> {
  return page.evaluate((selectors) => {
    return selectors.flatMap((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        return [];
      }
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        bounds.width === 0 ||
        bounds.height === 0
      ) {
        return [];
      }
      return [
        {
          selector,
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        },
      ];
    });
  }, OVERLAY_SELECTORS);
}

function overlappingPairs(boxes: readonly OverlayBox[]): readonly string[] {
  return boxes.flatMap((box, index) =>
    boxes.slice(index + 1).flatMap((candidate) => {
      const overlaps =
        box.left < candidate.right - 1 &&
        box.right > candidate.left + 1 &&
        box.top < candidate.bottom - 1 &&
        box.bottom > candidate.top + 1;
      return overlaps ? [`${box.selector} overlaps ${candidate.selector}`] : [];
    }),
  );
}

async function expectMacBookLayout(page: Page): Promise<void> {
  await expect(page.locator(".webgpu-failure")).toHaveCount(0);
  await expect(page.locator(".immersive-map > .notice-warning")).toHaveCount(0);

  const viewport = page.viewportSize();
  expect(viewport).toEqual({ width: 1440, height: 900 });

  const documentSize = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(documentSize.scrollHeight).toBe(documentSize.clientHeight);
  expect(documentSize.scrollWidth).toBe(documentSize.clientWidth);

  const boxes = await visibleOverlayBoxes(page);
  for (const box of boxes) {
    expect(box.left, `${box.selector} extends left of the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.top, `${box.selector} extends above the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.selector} extends right of the viewport`).toBeLessThanOrEqual(1440);
    expect(box.bottom, `${box.selector} extends below the viewport`).toBeLessThanOrEqual(900);
  }
  expect(overlappingPairs(boxes)).toEqual([]);
}

async function expectScrollableContentReachable(
  page: Page,
  contentSelector: string,
): Promise<void> {
  const content = page.locator(contentSelector);
  await expect(content).toBeVisible();
  const horizontalSize = await content.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    horizontalSize.scrollWidth,
    `${contentSelector} requires horizontal scrolling`,
  ).toBeLessThanOrEqual(horizontalSize.clientWidth + 1);
  const firstChild = content.locator(":scope > *").first();
  const lastChild = content.locator(":scope > *").last();
  await content.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(firstChild).toBeVisible();
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastChild).toBeVisible();
}

test("the complete Journey calculator remains a non-overlapping MacBook HUD", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".immersive-map")).toBeVisible();
  await expect(page.locator(".webgpu-failure")).toHaveCount(0);
  await expect(page.locator(".canvas-overlay")).toHaveCount(0);

  await expectMacBookLayout(page);
  await captureStage(page, "01-initial-map");

  const setupDrawer = page.locator(".app-hud-controls");
  await setupDrawer.locator(":scope > summary").click();
  await expect(setupDrawer).toHaveAttribute("open", "");
  await expectMacBookLayout(page);
  await captureStage(page, "02-setup-open-top");
  await expectScrollableContentReachable(page, ".app-hud-controls .sidebar");
  await captureStage(page, "03-setup-open-bottom");
  await page.locator(".app-hud-controls .sidebar").evaluate((element) => {
    element.scrollTop = 0;
  });

  const planButton = page.locator(".plan-button");
  await planButton.click();
  await expect(planButton).toHaveText("Planning…");
  const progressBlock = page.locator(".progress-block");
  await expect(progressBlock).toBeVisible();
  await progressBlock.scrollIntoViewIfNeeded();
  await expectMacBookLayout(page);
  await captureStage(page, "04-planning");

  await expect(page.locator(".map-route-status")).toContainText("Route plan active");
  await expect(page.locator(".app-hud-results > summary")).toContainText("Route ready");
  await expectMacBookLayout(page);
  await captureStage(page, "05-route-ready");

  const timelineDrawer = page.locator(".app-hud-results");
  await timelineDrawer.locator(":scope > summary").click();
  await expect(timelineDrawer).toHaveAttribute("open", "");
  await expect(setupDrawer).not.toHaveAttribute("open", "");
  await expect(page.locator(".journey-playback-card")).toBeVisible();
  await expectMacBookLayout(page);
  await captureStage(page, "06-timeline-open-top");
  await expectScrollableContentReachable(page, ".app-hud-results .results");
  await captureStage(page, "07-timeline-open-bottom");
  await page.locator(".app-hud-results .results").evaluate((element) => {
    element.scrollTop = 0;
  });

  const journeySample = page.locator(".cluster-journey-inspection");
  await expect(journeySample).toContainText("T+0.00 s");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const pauseButton = page.getByRole("button", { name: "Pause", exact: true });
  await expect(pauseButton).toBeVisible();
  await expect(journeySample).not.toContainText("T+0.00 s");
  await pauseButton.click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expectMacBookLayout(page);
  await captureStage(page, "08-playback-advanced");

  await timelineDrawer.locator(":scope > summary").click();
  await expect(timelineDrawer).not.toHaveAttribute("open", "");
  await expectMacBookLayout(page);
  await captureStage(page, "09-route-map");
});
