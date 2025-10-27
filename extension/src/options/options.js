const STORAGE_KEYS = [
  'iiqTenantUrl',
  'iiqTenantSubdomain',
  'iiqHelpdeskUrl',
  'iiqHelpdeskBaseUrl',
  'iiqPortalUrl',
  'iiqApiBaseUrl',
  'iiqTelemetryIntervalMinutes',
  'iiqAuthMode',
  'iiqApiKey',
  'iiqOAuthClientId',
];

const DEFAULT_SETTINGS = Object.freeze({
  tenantUrl: '',
  authMode: 'apiKey',
  apiKey: '',
  oauthClientId: '',
  syncIntervalMinutes: 60,
});

const MANAGED_LOCK_FLAGS = {
  tenantUrl: ['iiqTenantUrl', 'iiqTenantSubdomain', 'iiqHelpdeskUrl', 'iiqHelpdeskBaseUrl', 'iiqPortalUrl', 'iiqApiBaseUrl'],
  syncIntervalMinutes: ['iiqTelemetryIntervalMinutes'],
  authMode: ['iiqAuthMode', 'iiqApiKey', 'iiqOAuthClientId'],
  apiKey: ['iiqApiKey'],
  oauthClientId: ['iiqOAuthClientId'],
};

let cachedLocks = {
  tenantUrl: false,
  authMode: false,
  apiKey: false,
  oauthClientId: false,
  syncIntervalMinutes: false,
};

function storageAreaAvailable(areaName) {
  const area = chrome?.storage?.[areaName];
  return Boolean(area && typeof area.get === 'function');
}

function storageAreaWritable(areaName) {
  const area = chrome?.storage?.[areaName];
  return Boolean(area && typeof area.set === 'function');
}

function readStorage(areaName, keys = null) {
  if (!storageAreaAvailable(areaName)) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.storage[areaName].get(keys, (items) => {
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

function normalizeTenantUrl(candidate) {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(candidate.trim(), 'https://placeholder.invalid');
    if (!url.protocol.startsWith('http')) {
      return null;
    }

    const normalized = `${url.protocol}//${url.host}${url.pathname.replace(/\/?$/, '')}`;
    if (!normalized.startsWith('http')) {
      return null;
    }

    return normalized;
  } catch (error) {
    return null;
  }
}

function normalizeSubdomain(subdomain) {
  if (typeof subdomain !== 'string' || subdomain.trim().length === 0) {
    return null;
  }

  return `https://${subdomain.trim().replace(/\.$/, '')}.incidentiq.com`;
}

function deriveTenantUrl(source) {
  const candidates = [
    source?.iiqTenantUrl,
    source?.iiqHelpdeskUrl,
    source?.iiqHelpdeskBaseUrl,
    source?.iiqPortalUrl,
    source?.iiqApiBaseUrl,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTenantUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const fromSubdomain = normalizeSubdomain(source?.iiqTenantSubdomain);
  if (fromSubdomain) {
    return fromSubdomain;
  }

  return null;
}

function deriveAuthMode(source) {
  if (typeof source?.iiqAuthMode === 'string') {
    const candidate = source.iiqAuthMode.trim();
    if (candidate === 'apiKey' || candidate === 'oauth') {
      return candidate;
    }
  }

  if (typeof source?.iiqApiKey === 'string' && source.iiqApiKey.trim().length > 0) {
    return 'apiKey';
  }

  if (typeof source?.iiqOAuthClientId === 'string' && source.iiqOAuthClientId.trim().length > 0) {
    return 'oauth';
  }

  return DEFAULT_SETTINGS.authMode;
}

function parseInterval(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.syncIntervalMinutes;
  }
  return Math.min(Math.max(parsed, 5), 1440);
}

function computeLocks(managedValues) {
  const locks = { ...cachedLocks };
  for (const [field, keys] of Object.entries(MANAGED_LOCK_FLAGS)) {
    locks[field] = keys.some((key) => Object.prototype.hasOwnProperty.call(managedValues, key));
  }
  cachedLocks = locks;
  return locks;
}

export async function migrateLegacySettings(targetArea = 'sync') {
  if (!storageAreaAvailable(targetArea) || !storageAreaWritable(targetArea)) {
    return false;
  }

  const currentValues = await readStorage(targetArea, null);
  const updates = {};

  if (!currentValues.iiqTenantUrl) {
    const derived = deriveTenantUrl(currentValues);
    if (derived) {
      updates.iiqTenantUrl = derived;
    }
  }

  if (!currentValues.iiqAuthMode) {
    const authMode = deriveAuthMode(currentValues);
    if (authMode) {
      updates.iiqAuthMode = authMode;
    }
  }

  if (Object.keys(updates).length === 0) {
    return false;
  }

  await new Promise((resolve, reject) => {
    chrome.storage[targetArea].set(updates, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });

  return true;
}

async function loadRawSettings() {
  const [managed, sync] = await Promise.all([
    readStorage('managed', null),
    readStorage('sync', null),
  ]);

  const combined = { ...sync, ...managed };
  const tenantUrl = deriveTenantUrl(combined) ?? DEFAULT_SETTINGS.tenantUrl;
  const authMode = deriveAuthMode(combined);
  const syncIntervalMinutes = parseInterval(combined.iiqTelemetryIntervalMinutes ?? DEFAULT_SETTINGS.syncIntervalMinutes);
  const apiKey = typeof combined.iiqApiKey === 'string' ? combined.iiqApiKey.trim() : '';
  const oauthClientId = typeof combined.iiqOAuthClientId === 'string' ? combined.iiqOAuthClientId.trim() : '';

  const locks = computeLocks(managed);

  return {
    settings: {
      tenantUrl,
      authMode,
      apiKey,
      oauthClientId,
      syncIntervalMinutes,
    },
    locks,
  };
}

export async function loadSettings() {
  await migrateLegacySettings('sync');
  return loadRawSettings();
}

function buildStoragePayload(settings) {
  const payload = {};

  if (!cachedLocks.tenantUrl && settings.tenantUrl) {
    payload.iiqTenantUrl = settings.tenantUrl;
  }

  if (!cachedLocks.syncIntervalMinutes) {
    payload.iiqTelemetryIntervalMinutes = settings.syncIntervalMinutes;
  }

  if (!cachedLocks.authMode) {
    payload.iiqAuthMode = settings.authMode;
  }

  if (!cachedLocks.apiKey) {
    payload.iiqApiKey = settings.authMode === 'apiKey' ? settings.apiKey : '';
  }

  if (!cachedLocks.oauthClientId) {
    payload.iiqOAuthClientId = settings.authMode === 'oauth' ? settings.oauthClientId : '';
  }

  return payload;
}

export async function saveSettings(settings) {
  const payload = buildStoragePayload(settings);
  const preferredArea = storageAreaWritable('managed') ? 'managed' : 'sync';

  if (Object.keys(payload).length === 0) {
    return { area: preferredArea, empty: true };
  }

  let areaUsed = preferredArea;
  await new Promise((resolve, reject) => {
    chrome.storage[preferredArea].set(payload, () => {
      if (chrome.runtime.lastError) {
        if (preferredArea === 'managed' && storageAreaWritable('sync')) {
          areaUsed = 'sync';
          chrome.storage.sync.set(payload, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          });
          return;
        }

        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });

  return { area: areaUsed, empty: false };
}

function showBanner(message, type = 'info') {
  const banner = document.getElementById('status-banner');
  if (!banner) {
    return;
  }

  banner.textContent = message;
  banner.className = `status-banner visible ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`.trim();
}

function hideBanner() {
  const banner = document.getElementById('status-banner');
  if (!banner) {
    return;
  }
  banner.textContent = '';
  banner.className = 'status-banner';
}

function toggleAuthGroups(mode) {
  const apiGroup = document.getElementById('api-key-group');
  const oauthGroup = document.getElementById('oauth-group');

  if (apiGroup) {
    apiGroup.classList.toggle('visible', mode === 'apiKey');
  }
  if (oauthGroup) {
    oauthGroup.classList.toggle('visible', mode === 'oauth');
  }
}

function setManagedIndicator(id, enabled) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.classList.toggle('visible', enabled);
}

function applyLocks(locks) {
  const tenantInput = document.getElementById('tenant-url');
  const apiKeyInput = document.getElementById('api-key');
  const oauthInput = document.getElementById('oauth-client-id');
  const intervalInput = document.getElementById('sync-interval');

  if (tenantInput) {
    tenantInput.disabled = locks.tenantUrl;
    setManagedIndicator('tenant-managed', locks.tenantUrl);
  }
  if (apiKeyInput) {
    apiKeyInput.disabled = locks.apiKey;
    setManagedIndicator('api-key-managed', locks.apiKey);
  }
  if (oauthInput) {
    oauthInput.disabled = locks.oauthClientId;
    setManagedIndicator('oauth-managed', locks.oauthClientId);
  }
  if (intervalInput) {
    intervalInput.disabled = locks.syncIntervalMinutes;
    setManagedIndicator('interval-managed', locks.syncIntervalMinutes);
  }

  setManagedIndicator('auth-managed', locks.authMode);
}

function sanitizeSettings({ tenantUrl, authMode, apiKey, oauthClientId, syncIntervalMinutes }) {
  const sanitized = {
    tenantUrl: tenantUrl.trim(),
    authMode,
    apiKey: apiKey.trim(),
    oauthClientId: oauthClientId.trim(),
    syncIntervalMinutes: Number.parseInt(syncIntervalMinutes, 10),
  };

  sanitized.syncIntervalMinutes = Number.isFinite(sanitized.syncIntervalMinutes)
    ? Math.min(Math.max(sanitized.syncIntervalMinutes, 5), 1440)
    : DEFAULT_SETTINGS.syncIntervalMinutes;

  return sanitized;
}

function validateSettings(settings) {
  const issues = [];

  if (!settings.tenantUrl) {
    issues.push('Tenant URL is required.');
  } else if (!/^https:\/\//i.test(settings.tenantUrl)) {
    issues.push('Tenant URL must begin with https://.');
  } else {
    try {
      new URL(settings.tenantUrl);
    } catch (error) {
      issues.push('Tenant URL is not a valid URL.');
    }
  }

  if (!Number.isFinite(settings.syncIntervalMinutes) || settings.syncIntervalMinutes < 5) {
    issues.push('Sync interval must be at least 5 minutes.');
  }

  if (settings.authMode === 'apiKey' && !settings.apiKey) {
    issues.push('API key is required when API key mode is selected.');
  }

  if (settings.authMode === 'oauth' && !settings.oauthClientId) {
    issues.push('OAuth client ID is required when OAuth mode is selected.');
  }

  return issues;
}

async function initializeForm() {
  const form = document.getElementById('settings-form');
  const tenantInput = document.getElementById('tenant-url');
  const apiKeyInput = document.getElementById('api-key');
  const oauthInput = document.getElementById('oauth-client-id');
  const intervalInput = document.getElementById('sync-interval');
  const saveButton = document.getElementById('save-button');
  const authRadios = Array.from(document.querySelectorAll('input[name="auth-mode"]'));

  try {
    const { settings, locks } = await loadSettings();

    if (tenantInput) {
      tenantInput.value = settings.tenantUrl;
    }
    if (apiKeyInput) {
      apiKeyInput.value = settings.apiKey;
    }
    if (oauthInput) {
      oauthInput.value = settings.oauthClientId;
    }
    if (intervalInput) {
      intervalInput.value = settings.syncIntervalMinutes;
    }

    authRadios.forEach((radio) => {
      radio.checked = radio.value === settings.authMode;
      radio.disabled = locks.authMode;
    });

    toggleAuthGroups(settings.authMode);
    applyLocks(locks);
    hideBanner();
  } catch (error) {
    console.error('Failed to load settings', error);
    showBanner('Unable to load saved settings. Check the console for details.', 'error');
  }

  authRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      toggleAuthGroups(event.target.value);
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideBanner();

    if (!tenantInput || !intervalInput || authRadios.length === 0) {
      showBanner('Form is missing required elements.', 'error');
      return;
    }

    const activeMode = authRadios.find((radio) => radio.checked)?.value ?? DEFAULT_SETTINGS.authMode;

    const rawSettings = {
      tenantUrl: tenantInput.value,
      authMode: activeMode,
      apiKey: apiKeyInput?.value ?? '',
      oauthClientId: oauthInput?.value ?? '',
      syncIntervalMinutes: intervalInput.value,
    };

    const sanitized = sanitizeSettings(rawSettings);
    const errors = validateSettings(sanitized);

    if (errors.length > 0) {
      showBanner(errors.join(' '), 'error');
      return;
    }

    try {
      saveButton.disabled = true;
      const result = await saveSettings(sanitized);
      if (!result.empty) {
        showBanner(`Settings saved to ${result.area === 'managed' ? 'managed policy storage' : 'sync storage'}.`, 'success');
      } else {
        showBanner('No changes to save.', 'info');
      }
    } catch (error) {
      console.error('Failed to persist settings', error);
      showBanner('Unable to save settings. Check the console for details.', 'error');
    } finally {
      saveButton.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeForm().catch((error) => {
      console.error('Failed to initialize options page', error);
      showBanner('Failed to initialize options page. See console for details.', 'error');
    });
  });
} else {
  initializeForm().catch((error) => {
    console.error('Failed to initialize options page', error);
    showBanner('Failed to initialize options page. See console for details.', 'error');
  });
}

export const __TESTING__ = {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  deriveTenantUrl,
  deriveAuthMode,
  normalizeTenantUrl,
  normalizeSubdomain,
  parseInterval,
  sanitizeSettings,
  validateSettings,
};
