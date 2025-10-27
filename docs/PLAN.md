# iiQ Chromebook Companion Plan

## Vision
Create a ChromeOS extension that keeps managed Chromebooks in sync with incidentIQ (iiQ) and offers a streamlined ticket submission experience with prefilled asset and user data.

## Milestones
1. **Research & Foundations**
   - Validate incidentIQ API capabilities and authentication flows for device updates.
   - Identify ChromeOS admin policies and APIs available in managed environments.
   - Outline data model for device records, tickets, and cached state.

2. **MVP Extension**
   - Implement Chrome extension scaffold with background service worker, popup UI, and options page.
   - Authenticate with iiQ using service account or OAuth flow supported for managed domains.
   - Schedule periodic device sync (e.g., every 15 minutes) to push status updates to iiQ.
   - Provide popup UI showing current device status, sync health, and quick ticket button prefilled with device/user info.

3. **Admin & User Experience Enhancements**
   - Add onboarding wizard to options page for administrators to configure tenant URL and API keys.
   - Support diagnostics collection (logs, recent tickets) accessible in the popup.
   - Implement offline queue for updates when network connectivity is limited.

4. **Enterprise Hardening**
   - Integrate with Chrome enterprise policies for preconfiguring settings.
   - Add analytics/telemetry controls compliant with district privacy requirements.
   - Provide automated tests and CI workflows for build & lint.

## Technical Architecture
- **Background Service Worker**: Schedules sync jobs, handles authentication, communicates with iiQ APIs, maintains local storage.
- **Popup UI**: Displays current device context, sync status, and shortcuts to create/view tickets.
- **Content Scripts (Future)**: Inject helpers into iiQ pages if needed for context-aware actions.
- **Options Page**: Admin configuration, authentication status, and log export tools.
- **Storage**: Chrome `storage.managed` for admin-controlled defaults, `storage.sync` for per-user overrides, and `storage.local` for transient cache.

## Open Questions
- Which iiQ API endpoints support device metadata updates and ticket prefilling?
- What authentication mechanism (API key, OAuth client, service account) is supported in managed ChromeOS contexts?
- How should the extension handle multiple users per device (shared carts vs 1:1)?

## Next Steps
1. Document iiQ API surface and authentication details.
2. Define data contracts for device update payloads and ticket drafts.
3. Establish build tooling (TypeScript + Vite or plain JS) and automated testing approach.
4. Implement secure storage and rotation for credentials in managed environments.
