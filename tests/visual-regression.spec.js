const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load URL configuration from env var (CI) or file (local)
function loadConfig() {
  if (process.env.URLS_CONFIG) {
    return yaml.load(process.env.URLS_CONFIG);
  }
  const configPath = path.join(__dirname, '..', 'urls.yml');
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

// Wait for page height to stabilize
async function waitForStableHeight(page, timeout = 5000) {
  const startTime = Date.now();
  let previousHeight = 0;
  let stableCount = 0;

  while (Date.now() - startTime < timeout) {
    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    if (currentHeight === previousHeight) {
      stableCount++;
      if (stableCount >= 3) return; // Stable for 3 consecutive checks
    } else {
      stableCount = 0;
    }

    previousHeight = currentHeight;
    await page.waitForTimeout(200);
  }
}

// Parse period string (15m, 2h, 3d) to minutes
function periodToMinutes(period) {
  const match = period.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid period format: ${period}`);

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 'm': return num;
    case 'h': return num * 60;
    case 'd': return num * 60 * 24;
    default: throw new Error(`Invalid period unit: ${unit}`);
  }
}

// Check if current time matches period (within 15-minute window)
function shouldRunNow(period) {
  const minutes = periodToMinutes(period);
  const now = new Date();
  const minutesSinceEpoch = Math.floor(now.getTime() / 60000);

  // Check if we're within 15 minutes of when test should run
  // This accounts for cron schedule not aligning perfectly
  const remainder = minutesSinceEpoch % minutes;
  return remainder < 15;
}

// Determine which URLs to test
function getUrlsForCurrentRun() {
  const config = loadConfig();

  // Manual runs or local: test all sites
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.CI) {
    return config.sites;
  }

  // Scheduled runs: filter by period
  return config.sites.filter(site => shouldRunNow(site.period));
}

const urlsToTest = getUrlsForCurrentRun();

// Create a test for each URL
for (const site of urlsToTest) {
  test(`${site.name} (${site.period})`, async ({ page }, testInfo) => {
    // Navigate to the page
    await page.goto(site.url, { waitUntil: 'load' });

    // Hide elements with visibility:hidden (keeps layout space)
    if (site.excludeSelectors && site.excludeSelectors.length > 0) {
      for (const selector of site.excludeSelectors) {
        try {
          await page.locator(selector).evaluateAll(elements =>
            elements.forEach(el => el.style.visibility = 'hidden')
          );
        } catch (e) {
          console.log(`excludeSelector ${selector} not found on ${site.name}`);
        }
      }
    }

    // Hide elements with display:none (removes from layout)
    if (site.hideSelectors && site.hideSelectors.length > 0) {
      for (const selector of site.hideSelectors) {
        try {
          await page.locator(selector).evaluateAll(elements =>
            elements.forEach(el => el.style.display = 'none')
          );
        } catch (e) {
          console.log(`hideSelector ${selector} not found on ${site.name}`);
        }
      }
    }

    // Wait for page height to stabilize (handles lazy loading, animations)
    await waitForStableHeight(page);

    // Check if baseline exists
    const snapshotPath = testInfo.snapshotPath(`${site.name}.png`);
    const baselineExists = fs.existsSync(snapshotPath);

    if (!baselineExists) {
      // No baseline: take screenshot and skip comparison
      const dir = path.dirname(snapshotPath);
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: snapshotPath,
        fullPage: true
      });
      console.log(`Created baseline for ${site.name} at ${snapshotPath}`);
      return;
    }

    // Save current screenshot to test-results (for R2 upload)
    const currentScreenshotPath = path.join(testInfo.outputDir, `${site.name}-current.png`);
    await page.screenshot({
      path: currentScreenshotPath,
      fullPage: true
    });

    // Visual comparison using Playwright's built-in snapshot
    await expect(page).toHaveScreenshot(`${site.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      timeout: 10000,
    });
  });
}
