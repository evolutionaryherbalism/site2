# Visual Regression Testing

Automated visual regression monitoring using Playwright and GitHub Actions.

## How It Works

1. **Schedule**: Runs every 15 minutes via GitHub Actions
2. **Period Matching**: Tests only URLs whose period matches current time
3. **Comparison**: Compares screenshots against static baselines
4. **Notification**: Sends webhook on visual differences
5. **Baselines**: Updated only via manual workflow trigger

## Configuration

### Local Development
Edit `urls.yml`:

```yaml
sites:
  - url: https://example.com/
    name: example
    period: 15m
    excludeSelectors:
      - '.dynamic-content'
      - '#timestamp'
    hideSelectors:
      - '.cookie-banner'
      - '#consent-popup'
```

### Production (GitHub Actions)
Set repository variables:
- `URLS_CONFIG`: YAML string (same format as urls.yml)
- `WEBHOOK_URL`: Endpoint for failure notifications (optional)
- `WEBHOOK_URL_ALWAYS`: Endpoint for all test results, success or failure (optional)
- `R2_ACCOUNT_ID`: Cloudflare R2 account ID (optional, for screenshot uploads)
- `R2_BUCKET_NAME`: R2 bucket name (optional)
- `R2_PUBLIC_URL`: Public URL for R2 bucket (e.g., `https://screenshots.domain.com`)

Set repository secrets:
- `R2_ACCESS_KEY_ID`: R2 access key
- `R2_SECRET_ACCESS_KEY`: R2 secret key

## Period Format

- `15m` - Every 15 minutes
- `30m` - Every 30 minutes
- `1h` - Every hour
- `2h` - Every 2 hours
- `3d` - Every 3 days

Period must be multiple of 15 minutes.

## Configuration Options

- **url**: Full URL to monitor
- **name**: Unique identifier (alphanumeric, hyphens)
- **period**: Test frequency (15m, 30m, 1h, 2h, 3d, etc.)
- **excludeSelectors**: CSS selectors to hide with `visibility: hidden` (keeps layout space)
- **hideSelectors**: CSS selectors to hide with `display: none` (removes from layout, use for cookie banners)

## Running Tests

### Local
```bash
npm install
npm test                    # Test all sites
npm test -- --update-snapshots  # Update baselines
```

### GitHub Actions
- **Automatic**: Every 15 minutes (schedule)
- **Manual Test**: Actions → Visual Regression Tests → Run workflow
- **Update Baselines**: Actions → Update Visual Baselines → Run workflow

## Webhook Payload

**WEBHOOK_URL** (failures only):
```json
{
  "status": "failed",
  "name": "site-name",
  "url": "https://example.com",
  "report_url": "https://github.com/org/repo/actions/runs/123",
  "screenshot_url": "https://screenshots.domain.com/123456/site-name/diff.png"
}
```

**WEBHOOK_URL_ALWAYS** (all results):
```json
{
  "status": "success",
  "name": "site-name",
  "url": "https://example.com",
  "report_url": "https://github.com/org/repo/actions/runs/123",
  "screenshot_url": null
}
```

**Slack Image Embedding:**
For Slack to embed images, send to a Slack Incoming Webhook with Block Kit:
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Visual Regression Failed*\n<https://example.com|site-name>"
      }
    },
    {
      "type": "image",
      "image_url": "https://screenshots.domain.com/123456/site-name/diff.png",
      "alt_text": "Visual diff"
    }
  ]
}
```

## Baseline Management

- **Storage**: GitHub Actions Cache (not in git)
- **Cache key**: `visual-baselines-v1`
- **Update**: Run "Update Visual Baselines" workflow
- **Clear**:
  - Settings → Actions → Caches → Delete `visual-baselines-v1`
  - Or increment version in workflows: `v1` → `v2`
- **Retention**: 7 days if unused, up to 10GB total

## File Structure

```
tests/
  visual-regression.spec.js           # Test implementation
  visual-regression.spec.js-snapshots/ # Baseline screenshots (cached, not in git)
    chromium/
      sitename.png
urls.yml                              # Local URL configuration
.github/workflows/
  visual-regression.yml               # Test workflow
  update-baselines.yml                # Baseline update workflow
```
