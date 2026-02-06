# Visual Regression Testing

This repository includes automated visual regression testing using Playwright.

## Overview

The visual regression system monitors specified URLs for visual changes by:
1. Taking screenshots periodically
2. Comparing with baseline images
3. Reporting differences via GitHub Actions

## Configuration

URLs are configured in `urls.yml`:

```yaml
period:
  1h:
    - url: https://example.com/
      name: example-homepage
      excludeSelectors:
        - '.dynamic-content'
  30m:
    - url: https://another-site.com/
      name: another-site
      excludeSelectors:
        - '#timestamp'
```

### Configuration Options

- **period**: Time interval (e.g., `1h`, `30m`)
- **url**: Full URL to monitor
- **name**: Unique identifier for the site
- **excludeSelectors**: CSS selectors for dynamic elements to hide before comparison

## Running Tests

### Locally

```bash
npm install
npm test
```

### Via GitHub Actions

Tests run automatically:
- Every 30 minutes for `30m` period sites
- Every hour for `1h` period sites
- Manual trigger via workflow_dispatch

## Updating Baselines

To update baseline screenshots:
1. Run workflow manually via GitHub Actions UI
2. Baselines are automatically committed when run manually

## Artifacts

GitHub Actions uploads:
- Test results and reports (30 days retention)
- Baseline screenshots (30 days retention)
