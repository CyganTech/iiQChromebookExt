# iiQ Chromebook Companion

A Chrome extension tailored for managed ChromeOS environments that integrates with incidentIQ (iiQ) to keep device records current and streamline ticket submission.

## Project Structure

```
├── docs/
│   └── PLAN.md             # Product vision, milestones, and architectural overview
├── extension/
│   ├── assets/             # Icons and static assets used by the extension
│   ├── manifest.json       # Chrome extension manifest (MV3)
│   └── src/
│       ├── background/     # Background service worker scripts
│       ├── content/        # (Reserved) Content scripts injected into iiQ pages
│       ├── options/        # Options page for admin configuration
│       └── popup/          # Popup UI surfaced from the browser toolbar
└── LICENSE
```

## High-Level Goals
- Keep Chromebook device metadata in sync with incidentIQ automatically.
- Provide staff and students with a fast path to submit tickets that are prefilled with device and user context.
- Respect district privacy and security policies for managed ChromeOS devices.

## Getting Started
1. Clone this repository and open it in your preferred editor.
2. Load the extension in Chrome:
   - Navigate to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `extension/` directory
3. The popup currently contains placeholder UI; use it to validate the scaffold loads correctly.

## Next Steps
- Flesh out the background service worker with authentication and scheduled sync logic.
- Design the popup and options UI flows for submitting iiQ tickets and configuring tenant details.
- Document iiQ API integration requirements in `docs/PLAN.md` and iterate on the architecture.

## Contributing
Contributions are welcome! Please open issues with ideas or feedback and submit pull requests for enhancements.
