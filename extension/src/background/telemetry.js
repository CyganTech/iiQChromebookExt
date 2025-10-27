import { getEffectiveSettings } from '../options/options.js';

const TELEMETRY_ALARM_NAME = 'iiq-telemetry-sync';
const DEFAULT_TELEMETRY_PUSH_INTERVAL_MINUTES = 60;
const RETRY_DELAY_MINUTES = 5;
const MIN_DELAY_MINUTES = 1;
const MAX_API_RETRY_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const INITIAL_BACKOFF_DELAY_MS = 1000;
const MAX_BACKOFF_DELAY_MS = 30000;
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

let pipelineInitialized = false;

const deviceAttributes = chrome?.enterprise?.deviceAttributes;

let cachedIdentityToken = null;
let cachedIdentityTokenExpiry = 0;
let cachedIdentityTokenSource = null;

function deriveApiBaseUrlFromTenant(tenantUrl) {
  if (typeof tenantUrl !== 'string' || tenantUrl.trim().length === 0) {
    return null;
  }

  const trimmed = tenantUrl.replace(/\/+$/, '');
  return `${trimmed}/api/v1/`;
}

function getExtensionVersion() {
  try {
    return chrome?.runtime?.getManifest?.()?.version ?? '0.0.0';
  } catch (error) {
    console.warn('Unable to determine extension version for telemetry header:', error);
    return '0.0.0';
  }
}

function generateRequestId() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return { ...error };
  }

  return { message: String(error) };
}

async function callManagedStorageGet(keys) {
  if (!chrome?.storage?.managed?.get) {
    return {};
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.storage.managed.get(keys, (items) => {
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

async function setLocalStorageEntries(entries) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(entries, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function getTelemetrySettings() {
  const defaults = {
    apiBaseUrl: null,
    telemetryEndpoint: 'devices/telemetry',
    intervalMinutes: DEFAULT_TELEMETRY_PUSH_INTERVAL_MINUTES,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    apiKey: null,
    staticBearerToken: null,
    tokenLifetimeMinutes: 60,
    oauthScopes: [],
    oauthClientId: null,
    authMethod: 'apiKey',
  };

  const composed = { ...defaults };

  try {
    const optionSettings = await getEffectiveSettings();
    if (optionSettings) {
      const apiBase = deriveApiBaseUrlFromTenant(optionSettings.tenantUrl);
      if (apiBase) {
        composed.apiBaseUrl = apiBase;
      }

      if (Number.isFinite(optionSettings.syncIntervalMinutes) && optionSettings.syncIntervalMinutes > 0) {
        composed.intervalMinutes = optionSettings.syncIntervalMinutes;
      }

      if (optionSettings.authMethod === 'apiKey' && optionSettings.apiKey) {
        composed.apiKey = optionSettings.apiKey;
      }

      if (optionSettings.authMethod) {
        composed.authMethod = optionSettings.authMethod;
      }

      if (optionSettings.oauthClientId) {
        composed.oauthClientId = optionSettings.oauthClientId;
      }
    }
  } catch (error) {
    console.warn('Unable to load saved iiQ settings; continuing with defaults.', error);
  }

  try {
    const managed = await callManagedStorageGet(null);
    const baseUrlFromTenant = managed?.iiqTenantSubdomain
      ? `https://${managed.iiqTenantSubdomain}.incidentiq.com/api/v1/`
      : null;

    const timeoutMs = Number.parseInt(managed?.iiqTelemetryTimeoutMs, 10);
    const intervalMinutes = Number.parseInt(managed?.iiqTelemetryIntervalMinutes, 10);
    const tokenLifetimeMinutes = Number.parseInt(managed?.iiqTokenLifetimeMinutes, 10);
    let oauthScopes = [];

    if (Array.isArray(managed?.iiqOAuthScopes)) {
      oauthScopes = managed.iiqOAuthScopes.filter((scope) => typeof scope === 'string' && scope.trim().length > 0);
    } else if (typeof managed?.iiqOAuthScopes === 'string') {
      oauthScopes = managed.iiqOAuthScopes
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
    }

    return {
      ...composed,
      apiBaseUrl: managed?.iiqApiBaseUrl ?? baseUrlFromTenant ?? composed.apiBaseUrl,
      telemetryEndpoint: managed?.iiqTelemetryEndpoint ?? composed.telemetryEndpoint,
      intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : composed.intervalMinutes,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : composed.timeoutMs,
      apiKey:
        typeof managed?.iiqApiKey === 'string' && managed.iiqApiKey.trim().length > 0
          ? managed.iiqApiKey
          : composed.apiKey,
      staticBearerToken:
        typeof managed?.iiqServiceToken === 'string' && managed.iiqServiceToken.trim().length > 0
          ? managed.iiqServiceToken
          : composed.staticBearerToken,
      tokenLifetimeMinutes:
        Number.isFinite(tokenLifetimeMinutes) && tokenLifetimeMinutes > 0
          ? tokenLifetimeMinutes
          : composed.tokenLifetimeMinutes,
      oauthScopes,
    };
  } catch (error) {
    console.warn('Unable to read managed telemetry settings; falling back to saved configuration:', error);
    return composed;
  }
}

async function getTelemetryIntervalMinutes() {
  const settings = await getTelemetrySettings();
  return settings.intervalMinutes;
}

async function acquireIdentityToken({ forceRefresh = false, scopes = [] } = {}) {
  if (!chrome?.identity?.getAuthToken) {
    return null;
  }

  if (forceRefresh && cachedIdentityToken && chrome?.identity?.removeCachedAuthToken) {
    try {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: cachedIdentityToken }, () => {
          resolve();
        });
      });
    } catch (error) {
      console.warn('Failed to clear cached OAuth token before refresh:', error);
    }
  }

  return new Promise((resolve) => {
    try {
      chrome.identity.getAuthToken({ interactive: false, scopes }, (token) => {
        if (chrome.runtime.lastError) {
          console.warn('Unable to obtain iiQ OAuth token:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }

        resolve(token ?? null);
      });
    } catch (error) {
      console.warn('Unexpected error while requesting iiQ OAuth token:', error);
      resolve(null);
    }
  });
}

async function resolveAuthHeaders({ forceRefresh = false } = {}) {
  const settings = await getTelemetrySettings();

  if (settings.apiKey) {
    return { headers: { 'x-api-key': settings.apiKey }, settings };
  }

  if (settings.staticBearerToken) {
    cachedIdentityToken = settings.staticBearerToken;
    cachedIdentityTokenSource = 'managed';
    cachedIdentityTokenExpiry = settings.tokenLifetimeMinutes
      ? Date.now() + settings.tokenLifetimeMinutes * 60 * 1000 - TOKEN_SAFETY_WINDOW_MS
      : Number.POSITIVE_INFINITY;
    return { headers: { Authorization: `Bearer ${cachedIdentityToken}` }, settings };
  }

  const now = Date.now();
  if (!forceRefresh && cachedIdentityToken && cachedIdentityTokenSource === 'identity' && now < cachedIdentityTokenExpiry) {
    return { headers: { Authorization: `Bearer ${cachedIdentityToken}` }, settings };
  }

  const token = await acquireIdentityToken({ forceRefresh, scopes: settings.oauthScopes });
  if (!token) {
    throw new Error('Unable to resolve iiQ credentials');
  }

  cachedIdentityToken = token;
  cachedIdentityTokenSource = 'identity';
  cachedIdentityTokenExpiry = now + settings.tokenLifetimeMinutes * 60 * 1000 - TOKEN_SAFETY_WINDOW_MS;

  return { headers: { Authorization: `Bearer ${cachedIdentityToken}` }, settings };
}

async function invalidateCredentials() {
  if (cachedIdentityTokenSource === 'identity' && cachedIdentityToken && chrome?.identity?.removeCachedAuthToken) {
    try {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: cachedIdentityToken }, () => {
          resolve();
        });
      });
    } catch (error) {
      console.warn('Failed to remove cached OAuth token:', error);
    }
  }

  cachedIdentityToken = null;
  cachedIdentityTokenExpiry = 0;
  cachedIdentityTokenSource = null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestOptions = { ...options, signal: controller.signal };

  try {
    const response = await fetch(url, requestOptions);
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function readResponseBody(response) {
  const clone = response.clone();
  const contentType = clone.headers.get('content-type');

  try {
    if (contentType && contentType.includes('application/json')) {
      return await clone.json();
    }
    return await clone.text();
  } catch (error) {
    console.warn('Unable to parse iiQ response body:', error);
    return null;
  }
}

async function persistTelemetryResponse(summary) {
  try {
    await setLocalStorageEntries({ lastTelemetryResponse: summary, lastTelemetryError: null });
  } catch (error) {
    console.warn('Unable to persist telemetry response snapshot:', error);
  }
}

async function persistTelemetryError(errorSummary) {
  try {
    await setLocalStorageEntries({ lastTelemetryError: errorSummary });
  } catch (error) {
    console.warn('Unable to persist telemetry error snapshot:', error);
  }
}

async function sendTelemetryToIiq(telemetry) {
  const { headers: authHeaders, settings } = await resolveAuthHeaders();

  if (!settings.apiBaseUrl) {
    throw new Error('iiQ API base URL is not configured. Provide `iiqApiBaseUrl` or `iiqTenantSubdomain` via policy.');
  }

  const endpoint = settings.telemetryEndpoint || 'devices/telemetry';
  const url = new URL(endpoint, settings.apiBaseUrl).toString();
  const requestId = generateRequestId();
  const baseHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-iiq-client': `chromebook-companion/${getExtensionVersion()}`,
    'x-request-id': requestId,
  };

  let attempts = 0;
  let backoffMs = INITIAL_BACKOFF_DELAY_MS;
  let lastError = null;
  let currentAuthHeaders = { ...authHeaders };

  while (attempts < MAX_API_RETRY_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { ...baseHeaders, ...currentAuthHeaders },
          body: JSON.stringify(telemetry),
        },
        settings.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      );

      const responseBody = await readResponseBody(response);

      if (response.status === 401) {
        lastError = new Error('iiQ rejected credentials with 401');
        await invalidateCredentials();
        if (attempts >= MAX_API_RETRY_ATTEMPTS) {
          throw lastError;
        }
        ({ headers: currentAuthHeaders } = await resolveAuthHeaders({ forceRefresh: true }));
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_DELAY_MS);
        continue;
      }

      if (isRetryableStatus(response.status) && attempts < MAX_API_RETRY_ATTEMPTS) {
        lastError = new Error(`Retryable iiQ status ${response.status}`);
        const retryAfterHeader = response.headers.get('retry-after');
        if (retryAfterHeader) {
          const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
          if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            backoffMs = Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_DELAY_MS);
          }
        }
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_DELAY_MS);
        continue;
      }

      return {
        status: response.status,
        ok: response.ok,
        body: responseBody,
        requestId: response.headers.get('x-request-id') ?? requestId,
        traceId: response.headers.get('x-trace-id') ?? null,
        attempts,
        recommendedDelayMinutes:
          typeof responseBody?.nextRecommendedCheckMinutes === 'number'
            ? responseBody.nextRecommendedCheckMinutes
            : null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await invalidateCredentials();
      if (attempts >= MAX_API_RETRY_ATTEMPTS) {
        throw lastError;
      }

      try {
        ({ headers: currentAuthHeaders } = await resolveAuthHeaders({ forceRefresh: true }));
      } catch (authError) {
        throw authError;
      }

      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_DELAY_MS);
    }
  }

  throw lastError ?? new Error('Unknown error transmitting telemetry to iiQ');
}

function isDeviceAttributesAvailable() {
  return Boolean(deviceAttributes);
}

function promisifyDeviceAttribute(methodName) {
  if (!isDeviceAttributesAvailable() || typeof deviceAttributes[methodName] !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      deviceAttributes[methodName]((value) => {
        resolve(value ?? null);
      });
    } catch (error) {
      console.warn(`Failed to call chrome.enterprise.deviceAttributes.${methodName}:`, error);
      resolve(null);
    }
  });
}

async function getAssetTag() {
  return promisifyDeviceAttribute('getDeviceAssetId');
}

async function getSerialNumber() {
  return promisifyDeviceAttribute('getDeviceSerialNumber');
}

async function getDirectoryDeviceId() {
  return promisifyDeviceAttribute('getDirectoryDeviceId');
}

async function getDeviceUser() {
  return promisifyDeviceAttribute('getDeviceUser');
}

async function getOsVersionFromDeviceAttributes() {
  return promisifyDeviceAttribute('getOsVersion');
}

async function getOsVersionFromUserAgent() {
  const userAgent = globalThis.navigator?.userAgent || '';
  const match = userAgent.match(/CrOS [^\s]+ ([^\s]+)/i);
  return match ? match[1] : null;
}

function getPlatformInfo() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => resolve(info));
  });
}

async function getOsVersion() {
  const deviceAttributesVersion = await getOsVersionFromDeviceAttributes();
  if (deviceAttributesVersion) {
    return deviceAttributesVersion;
  }

  const platformInfo = await getPlatformInfo();
  if (platformInfo && platformInfo.os) {
    const userAgentVersion = await getOsVersionFromUserAgent();
    if (userAgentVersion) {
      return `${platformInfo.os} ${userAgentVersion}`;
    }
    return platformInfo.os;
  }

  return null;
}

function getNetworkInterfaces() {
  return new Promise((resolve, reject) => {
    if (!chrome?.system?.network?.getNetworkInterfaces) {
      resolve([]);
      return;
    }

    try {
      chrome.system.network.getNetworkInterfaces((interfaces) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(interfaces || []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function getLocalIpAddress() {
  if (!chrome?.system?.network?.getNetworkInterfaces) {
    return null;
  }

  try {
    const interfaces = await getNetworkInterfaces();
    const prioritized = interfaces.find((iface) => Boolean(iface.address) && !iface.address.startsWith('127.'));
    return prioritized ? prioritized.address : interfaces[0]?.address ?? null;
  } catch (error) {
    console.warn('Failed to read network interfaces:', error);
    return null;
  }
}

async function getLastTelemetryCheckin() {
  try {
    const lastTelemetryCheckin = await new Promise((resolve, reject) => {
      chrome.storage.local.get('lastTelemetryCheckin', (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items.lastTelemetryCheckin ?? null);
      });
    });

    return lastTelemetryCheckin;
  } catch (error) {
    console.warn('Unable to read last telemetry check-in from storage:', error);
    return null;
  }
}

async function setLastTelemetryCheckin(timestamp) {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ lastTelemetryCheckin: timestamp }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  } catch (error) {
    console.warn('Unable to persist telemetry check-in timestamp:', error);
  }
}

export async function collectDeviceTelemetry() {
  const [assetTag, serialNumber, directoryDeviceId, currentUser, osVersion, localIpAddress, lastCheckinTime] =
    await Promise.all([
      getAssetTag(),
      getSerialNumber(),
      getDirectoryDeviceId(),
      getDeviceUser(),
      getOsVersion(),
      getLocalIpAddress(),
      getLastTelemetryCheckin(),
    ]);

  return {
    assetTag,
    serialNumber,
    deviceId: directoryDeviceId,
    directoryDeviceId,
    currentUser,
    localIpAddress,
    osVersion,
    lastCheckinTime,
  };
}

export async function pushDeviceTelemetry() {
  const telemetry = await collectDeviceTelemetry();
  const timestamp = new Date().toISOString();
  telemetry.lastCheckinTime = timestamp;

  try {
    const responseSummary = await sendTelemetryToIiq({
      serialNumber: telemetry.serialNumber,
      assetTag: telemetry.assetTag,
      directoryDeviceId: telemetry.directoryDeviceId ?? telemetry.deviceId,
      currentUser: telemetry.currentUser,
      osVersion: telemetry.osVersion,
      localIp: telemetry.localIpAddress,
      lastCheckinTime: telemetry.lastCheckinTime,
    });

    await setLastTelemetryCheckin(timestamp);
    await persistTelemetryResponse({
      ...responseSummary,
      timestamp,
    });

    console.info('iiQ telemetry push completed', {
      event: 'telemetry_push',
      level: 'info',
      status: responseSummary.status,
      ok: responseSummary.ok,
      attempts: responseSummary.attempts,
      requestId: responseSummary.requestId,
      traceId: responseSummary.traceId,
      timestamp,
    });

    return responseSummary;
  } catch (error) {
    const serialized = { ...serializeError(error), timestamp };
    console.error('iiQ telemetry push failed', {
      event: 'telemetry_push',
      level: 'error',
      error: serialized,
    });
    await persistTelemetryError(serialized);
    throw error;
  }
}

async function scheduleNextTelemetryPush({ recommendedDelayMinutes = null, retry = false } = {}) {
  try {
    const managedInterval = await getTelemetryIntervalMinutes();
    let delayMinutes = recommendedDelayMinutes ?? managedInterval ?? DEFAULT_TELEMETRY_PUSH_INTERVAL_MINUTES;

    if (retry) {
      delayMinutes = Math.min(delayMinutes, RETRY_DELAY_MINUTES);
    }

    if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
      delayMinutes = DEFAULT_TELEMETRY_PUSH_INTERVAL_MINUTES;
    }

    delayMinutes = Math.max(delayMinutes, MIN_DELAY_MINUTES);

    chrome.alarms.create(TELEMETRY_ALARM_NAME, { delayInMinutes: delayMinutes });
  } catch (error) {
    console.error('Failed to schedule next telemetry push:', error);
  }
}

export function scheduleRecurringTelemetryPush() {
  scheduleNextTelemetryPush().catch((error) => {
    console.error('Unable to prime telemetry schedule:', error);
  });
}

export function handleTelemetryAlarms(alarm) {
  if (alarm.name !== TELEMETRY_ALARM_NAME) {
    return;
  }

  pushDeviceTelemetry()
    .then((responseSummary) => {
      scheduleNextTelemetryPush({ recommendedDelayMinutes: responseSummary?.recommendedDelayMinutes });
    })
    .catch((error) => {
      console.error('Device telemetry push failed:', error);
      scheduleNextTelemetryPush({ retry: true });
    });
}

export function initializeTelemetryPipeline() {
  if (pipelineInitialized) {
    return;
  }

  pipelineInitialized = true;
  pushDeviceTelemetry()
    .then((responseSummary) => {
      scheduleNextTelemetryPush({ recommendedDelayMinutes: responseSummary?.recommendedDelayMinutes });
    })
    .catch((error) => {
      console.error('Initial telemetry push failed:', error);
      scheduleNextTelemetryPush({ retry: true });
    });
}

function clearTelemetryAlarm() {
  return new Promise((resolve) => {
    if (!chrome?.alarms?.clear) {
      resolve(false);
      return;
    }

    try {
      chrome.alarms.clear(TELEMETRY_ALARM_NAME, (cleared) => {
        resolve(Boolean(cleared));
      });
    } catch (error) {
      console.warn('Unable to clear telemetry alarm:', error);
      resolve(false);
    }
  });
}

export async function refreshTelemetryConfiguration() {
  cachedIdentityToken = null;
  cachedIdentityTokenExpiry = 0;
  cachedIdentityTokenSource = null;

  await clearTelemetryAlarm();

  return pushDeviceTelemetry()
    .then((responseSummary) => {
      scheduleNextTelemetryPush({ recommendedDelayMinutes: responseSummary?.recommendedDelayMinutes });
      return responseSummary;
    })
    .catch((error) => {
      console.error('Telemetry push failed after configuration refresh:', error);
      scheduleNextTelemetryPush({ retry: true });
      throw error;
    });
}
