const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load URL configuration
const configPath = path.join(__dirname, '..', 'urls.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Determine which URLs to test based on schedule
function getUrlsForCurrentRun() {
  const allUrls = [];
  const now = new Date();
  const minutes = now.getMinutes();
  
  // 30m period sites run every 30 minutes
  if (config.period['30m']) {
    allUrls.push(...config.period['30m'].map(site => ({ ...site, period: '30m' })));
  }
  
  // 1h period sites run only on the hour
  if (minutes === 0 && config.period['1h']) {
    allUrls.push(...config.period['1h'].map(site => ({ ...site, period: '1h' })));
  }
  
  // For manual runs or testing, run all sites
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.CI) {
    const all = [];
    for (const period in config.period) {
      all.push(...config.period[period].map(site => ({ ...site, period })));
    }
    return all;
  }
  
  return allUrls;
}

const urlsToTest = getUrlsForCurrentRun();

// Create a test for each URL
for (const site of urlsToTest) {
  test(`Visual regression: ${site.name} (${site.period})`, async ({ page }) => {
    const screenshotDir = path.join(__dirname, '..', 'screenshots', site.period);
    const baselinePath = path.join(screenshotDir, `${site.name}-baseline.png`);
    const currentPath = path.join(screenshotDir, `${site.name}-current.png`);
    
    // Ensure directory exists
    fs.mkdirSync(screenshotDir, { recursive: true });
    
    // Navigate to the page
    await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Hide dynamic elements if specified
    if (site.excludeSelectors && site.excludeSelectors.length > 0) {
      for (const selector of site.excludeSelectors) {
        try {
          await page.locator(selector).evaluateAll(elements => 
            elements.forEach(el => el.style.visibility = 'hidden')
          );
        } catch (e) {
          // Selector might not exist on the page, continue
          console.log(`Selector ${selector} not found on ${site.name}`);
        }
      }
    }
    
    // Take screenshot
    await page.screenshot({ path: currentPath, fullPage: true });
    
    // If baseline doesn't exist, create it
    if (!fs.existsSync(baselinePath)) {
      fs.copyFileSync(currentPath, baselinePath);
      console.log(`Created baseline for ${site.name}`);
      return; // Skip comparison on first run
    }
    
    // Compare with baseline
    const baseline = fs.readFileSync(baselinePath);
    const current = fs.readFileSync(currentPath);
    
    // Use Playwright's built-in visual comparison
    expect(await page.screenshot({ fullPage: true })).toMatchSnapshot(`${site.name}-baseline.png`, {
      maxDiffPixels: 100, // Allow small differences
      threshold: 0.2
    });
    
    // Update current as new baseline for next run
    fs.copyFileSync(currentPath, baselinePath);
  });
}
