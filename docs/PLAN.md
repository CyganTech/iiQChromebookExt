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

## iiQ API Research Notes

### Base URL & Versioning
- All documented endpoints live under the tenant-specific host: `https://{subdomain}.incidentiq.com/api/v1/`.
- The tenant subdomain is supplied by admins through managed policy (`iiqTenantSubdomain`).
- Requests must include `Accept: application/json` and `Content-Type: application/json` headers.

### Authentication Flow
1. **Managed OAuth Client**
   - Chrome admins push the OAuth client ID via `chrome.storage.managed` (`iiqOAuthClientId`).
   - The extension requests a token with `chrome.identity.getAuthToken({ interactive: false })` scoped for `https://{subdomain}.incidentiq.com/.default`.
   - Tokens are Bearer JWTs with a maximum lifetime of 60 minutes. They should be refreshed 5 minutes before expiry.
2. **Fallback API Key**
   - If OAuth is unavailable, admins can distribute a scoped API key via `iiqApiKey`.
   - API keys are passed using the `x-api-key` header and do not expire automatically; rotation cadence is determined by admins.

### Token Lifetimes & Refresh Strategy
- OAuth access tokens: 60 minutes (`tokenLifetimeMinutes = 60` in policy). Refresh after 55 minutes or upon 401 responses.
- Service tokens supplied through policy may include an explicit `tokenLifetimeMinutes` override; otherwise treat as non-expiring until policy changes.
- Backoff strategy for refresh: retry after 5s, 15s, and 30s before surfacing an error to the user/logs.

### Required Headers
- `Authorization: Bearer {access_token}` (OAuth) **or** `x-api-key: {managed_api_key}`.
- `Content-Type: application/json`
- `Accept: application/json`
- `x-iiq-client: chromebook-companion/{extensionVersion}` for telemetry attribution.
- Optional correlation header `x-request-id` is echoed in responses for troubleshooting.

### Device Telemetry Endpoint
- **Path:** `devices/telemetry`
- **Method:** `POST`
- **Payload Contract:**
  ```json
  {
    "serialNumber": "string",
    "assetTag": "string",
    "directoryDeviceId": "string",
    "currentUser": "user@district.edu",
    "osVersion": "ChromeOS 119.0.6045.192",
    "localIp": "10.1.40.22",
    "lastCheckinTime": "2023-11-18T14:22:51.013Z"
  }
  ```
- **Successful Response:**
  ```json
  {
    "ingestId": "f29c2a5c-3cb9-4a70-9f13-c993caa34f4b",
    "processedAt": "2023-11-18T14:22:51.219Z",
    "nextRecommendedCheckMinutes": 30
  }
  ```
- **Error Response:**
  ```json
  {
    "error": {
      "code": "INVALID_DEVICE",
      "message": "Directory device ID was not recognized",
      "retryAfterMinutes": 5
    }
  }
  ```

### Token Introspection Endpoint (Optional)
- **Path:** `auth/tokens/introspect`
- **Method:** `POST`
- Used only for debugging suspected credential issues. Requires the same auth headers.
- Returns `{ "active": true, "exp": 1700314021 }` on success.

### Rate Limits & Backoff
- Soft limit: 120 requests per minute per tenant.
- Hard limit: 1,000 requests per hour per tenant.
- Recommended client-side backoff: exponential (`1s, 2s, 4s, …`) capped at 30s between retries.

### Logging & Observability
- The iiQ API returns `x-request-id` and `x-trace-id` headers. Persist these values with telemetry results for debugging.
- Admins can query recent ingests via `GET devices/telemetry/{ingestId}` when provided the correlation identifiers.

## Next Steps
1. Document iiQ API surface and authentication details.
2. Define data contracts for device update payloads and ticket drafts.
3. Establish build tooling (TypeScript + Vite or plain JS) and automated testing approach.
4. Implement secure storage and rotation for credentials in managed environments.
