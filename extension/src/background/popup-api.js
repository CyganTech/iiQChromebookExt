import { MESSAGE_TYPE_REQUEST_CONTEXT } from '../shared/messages.js';
import { collectDeviceTelemetry } from './telemetry.js';

const LAST_SYNC_STALE_THRESHOLD_MINUTES = 6 * 60; // 6 hours

function readLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.local?.get) {
      resolve({});
      return;
    }

    try {
      chrome.storage.local.get(keys, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function readManagedStorage() {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.managed?.get) {
      resolve({});
      return;
    }

    try {
      chrome.storage.managed.get(null, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function readSyncStorage() {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.sync?.get) {
      resolve({});
      return;
    }

    try {
      chrome.storage.sync.get(null, (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function coerceIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function minutesBetween(startIso, now = Date.now()) {
  if (!startIso) {
    return null;
  }

  const timestamp = new Date(startIso).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return (now - timestamp) / (60 * 1000);
}

function deriveTenantBaseUrl(managedSettings) {
  const candidateUrls = [
    managedSettings?.iiqHelpdeskUrl,
    managedSettings?.iiqHelpdeskBaseUrl,
    managedSettings?.iiqPortalUrl,
    managedSettings?.iiqTenantUrl,
    managedSettings?.iiqApiBaseUrl,
  ];

  for (const candidate of candidateUrls) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      try {
        const url = new URL(candidate.trim(), 'https://placeholder.invalid');
        if (!url.protocol.startsWith('http')) {
          continue;
        }
        let pathname = url.pathname.replace(/\/?$/, '');
        if (/\/api(\/|$)/i.test(pathname)) {
          const segments = pathname.split('/api')[0];
          pathname = segments.replace(/\/?$/, '');
        }
        return `${url.protocol}//${url.host}${pathname}`;
      } catch (error) {
        continue; // try next candidate
      }
    }
  }

  if (typeof managedSettings?.iiqTenantSubdomain === 'string' && managedSettings.iiqTenantSubdomain.trim().length > 0) {
    const subdomain = managedSettings.iiqTenantSubdomain.trim().replace(/\.$/, '');
    return `https://${subdomain}.incidentiq.com`;
  }

  return null;
}

function buildTicketShortcutUrl(baseUrl, path, params = {}) {
  if (!baseUrl) {
    return null;
  }

  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `${url.toString()}?${query}` : url.toString();
}

function buildTicketShortcuts({ baseUrl, device }) {
  const params = {
    assetTag: device.assetTag ?? undefined,
    serialNumber: device.serialNumber ?? undefined,
    deviceId: device.directoryDeviceId ?? device.deviceId ?? undefined,
    currentUser: device.currentUser ?? undefined,
  };

  const shortcuts = [];

  const submitUrl = buildTicketShortcutUrl(baseUrl, '/app/tickets/new', params);
  if (submitUrl) {
    shortcuts.push({
      id: 'submit-ticket',
      label: 'Submit Ticket',
      description: 'Open an iiQ ticket prefilled with your device details.',
      url: submitUrl,
      featured: true,
    });
  }

  const damageUrl = buildTicketShortcutUrl(baseUrl, '/app/tickets/new', {
    ...params,
    issueType: 'hardware-damage',
  });
  if (damageUrl) {
    shortcuts.push({
      id: 'report-issue',
      label: 'Report Damage',
      description: 'Document physical damage or hardware issues.',
      url: damageUrl,
      featured: false,
    });
  }

  const loanerUrl = buildTicketShortcutUrl(baseUrl, '/app/requests/new', {
    ...params,
    requestType: 'loaner-device',
  });
  if (loanerUrl) {
    shortcuts.push({
      id: 'request-loaner',
      label: 'Request Loaner Device',
      description: 'Ask for a temporary device while yours is serviced.',
      url: loanerUrl,
      featured: false,
    });
  }

  return shortcuts;
}

function summarizeDeviceHealth({ lastResponse, lastError, now = Date.now() }) {
  const responseTimestamp = coerceIsoTimestamp(lastResponse?.timestamp);
  const lastErrorTimestamp = coerceIsoTimestamp(lastError?.timestamp);
  const lastSuccessfulSyncTime = lastResponse?.ok ? responseTimestamp : null;
  const lastAttemptTime = lastErrorTimestamp ?? responseTimestamp;
  const stalenessMinutes = lastSuccessfulSyncTime ? minutesBetween(lastSuccessfulSyncTime, now) : null;

  let health = 'unknown';
  let summary = 'Awaiting first device sync.';
  let healthReason = null;

  if (lastError) {
    health = 'error';
    summary = 'The last sync attempt failed.';
    healthReason = lastError?.message ?? null;
  } else if (lastResponse) {
    if (lastResponse.ok) {
      const stale = Number.isFinite(stalenessMinutes) && stalenessMinutes > LAST_SYNC_STALE_THRESHOLD_MINUTES;
      if (stale) {
        health = 'degraded';
        summary = 'Device sync is stale. A new check-in is recommended.';
        healthReason = `Last successful sync ${Math.round(stalenessMinutes)} minutes ago.`;
      } else {
        health = 'healthy';
        summary = 'Device is syncing normally.';
      }
    } else {
      health = 'error';
      summary = 'The last sync response indicated a problem.';
      healthReason = `Received status ${lastResponse.status ?? 'unknown'}.`;
    }
  }

  return {
    health,
    summary,
    healthReason,
    lastSuccessfulSyncTime,
    lastAttemptTime,
    lastResponse,
    lastError,
  };
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (typeof error === 'object') {
    return { ...error };
  }

  return { message: String(error) };
}

async function buildPopupContext() {
  const [device, localStorage, managedSettings, syncSettings] = await Promise.all([
    collectDeviceTelemetry(),
    readLocalStorage(['lastTelemetryResponse', 'lastTelemetryError']),
    readManagedStorage(),
    readSyncStorage(),
  ]);

  const lastResponse = localStorage.lastTelemetryResponse ?? null;
  const lastError = localStorage.lastTelemetryError ?? null;
  const deviceStatus = summarizeDeviceHealth({ lastResponse, lastError });

  const layeredSettings = { ...syncSettings, ...managedSettings };
  const tenantBaseUrl = deriveTenantBaseUrl(layeredSettings);
  const ticketShortcuts = buildTicketShortcuts({ baseUrl: tenantBaseUrl, device });

  /**
   * @typedef {Object} DeviceStatus
   * @property {('healthy'|'degraded'|'error'|'unknown')} health Overall health classification for telemetry sync.
   * @property {string} summary Human readable summary of the current state.
   * @property {string|null} healthReason Optional additional context on the health state.
   * @property {string|null} lastSuccessfulSyncTime ISO-8601 timestamp for the last successful sync attempt.
   * @property {string|null} lastAttemptTime ISO-8601 timestamp for the most recent sync attempt (success or failure).
   * @property {object|null} lastResponse Raw metadata captured from the most recent sync response.
   * @property {object|null} lastError Serialized error information from the most recent sync failure.
   */

  /**
   * @typedef {Object} TicketShortcut
   * @property {string} id Stable identifier for the shortcut.
   * @property {string} label Display label used in the UI.
   * @property {string} description Accessible description providing extra context.
   * @property {string} url Destination URL that opens in a new tab.
   * @property {boolean} featured Indicates whether the shortcut should be emphasized as the primary action.
   */

  return {
    retrievedAt: new Date().toISOString(),
    tenantBaseUrl,
    deviceStatus,
    deviceContext: {
      assetTag: device.assetTag ?? null,
      serialNumber: device.serialNumber ?? null,
      directoryDeviceId: device.directoryDeviceId ?? null,
      deviceId: device.deviceId ?? null,
      currentUser: device.currentUser ?? null,
      localIpAddress: device.localIpAddress ?? null,
      osVersion: device.osVersion ?? null,
    },
    ticketShortcuts,
  };
}

export function registerPopupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPE_REQUEST_CONTEXT) {
      return false;
    }

    (async () => {
      try {
        const data = await buildPopupContext();
        sendResponse({ ok: true, data });
      } catch (error) {
        console.error('Failed to build popup context', error);
        sendResponse({ ok: false, error: serializeError(error) });
      }
    })();

    return true;
  });
}

