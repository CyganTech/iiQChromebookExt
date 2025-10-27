const CURRENT_SCHEMA_VERSION = 1;
export const SETTINGS_STORAGE_KEY = 'iiqSettings';
export const MIN_SYNC_INTERVAL = 5;
export const MAX_SYNC_INTERVAL = 720;

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  tenantUrl: '',
  authMethod: 'apiKey',
  apiKey: '',
  oauthClientId: '',
  syncIntervalMinutes: 60,
  updatedAt: null,
  lastMigratedFrom: null,
});

function cloneDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

function getChromeStorageArea(areaName) {
  if (typeof chrome === 'undefined' || !chrome?.storage) {
    return null;
  }

  return chrome.storage[areaName] ?? null;
}

function storageGet(area, key) {
  return new Promise((resolve, reject) => {
    if (!area || typeof area.get !== 'function') {
      resolve(null);
      return;
    }

    try {
      area.get(key, (items) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items ?? null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(area, entries) {
  return new Promise((resolve, reject) => {
    if (!area || typeof area.set !== 'function') {
      reject(new Error('Storage area does not support writes.'));
      return;
    }

    try {
      area.set(entries, () => {
        if (chrome.runtime?.lastError) {
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

async function readSettingsFromArea(areaName) {
  const area = getChromeStorageArea(areaName);
  if (!area) {
    return { area: null, raw: null };
  }

  try {
    const items = await storageGet(area, SETTINGS_STORAGE_KEY);
    if (items && typeof items === 'object' && SETTINGS_STORAGE_KEY in items) {
      return { area: areaName, raw: items[SETTINGS_STORAGE_KEY] };
    }
  } catch (error) {
    console.warn(`Unable to read settings from chrome.storage.${areaName}:`, error);
  }

  return { area: null, raw: null };
}

function normalizeTenantUrl(input) {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) {
    return '';
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (candidate.toLowerCase().startsWith('http://')) {
    candidate = `https://${candidate.slice('http://'.length)}`;
  }

  try {
    const url = new URL(candidate);
    return url.origin;
  } catch (error) {
    return candidate;
  }
}

function normalizeSettings(partial = {}) {
  const normalized = cloneDefaultSettings();

  normalized.tenantUrl = normalizeTenantUrl(partial.tenantUrl);

  const authMethod = typeof partial.authMethod === 'string' ? partial.authMethod.trim() : '';
  normalized.authMethod = authMethod === 'oauth' ? 'oauth' : 'apiKey';

  if (typeof partial.apiKey === 'string') {
    normalized.apiKey = partial.apiKey.trim();
  }

  if (typeof partial.oauthClientId === 'string') {
    normalized.oauthClientId = partial.oauthClientId.trim();
  }

  const intervalCandidate = Number.parseInt(partial.syncIntervalMinutes, 10);
  if (Number.isFinite(intervalCandidate)) {
    normalized.syncIntervalMinutes = Math.min(
      Math.max(intervalCandidate, MIN_SYNC_INTERVAL),
      MAX_SYNC_INTERVAL,
    );
  }

  if (typeof partial.updatedAt === 'string' && partial.updatedAt.trim().length > 0) {
    normalized.updatedAt = partial.updatedAt;
  }

  if (typeof partial.lastMigratedFrom === 'number' && Number.isFinite(partial.lastMigratedFrom)) {
    normalized.lastMigratedFrom = partial.lastMigratedFrom;
  }

  return normalized;
}

export function validateSettings(partial = {}) {
  const normalized = normalizeSettings(partial);
  const errors = {};

  if (!normalized.tenantUrl) {
    errors.tenantUrl = 'Tenant URL is required.';
  } else {
    try {
      const url = new URL(normalized.tenantUrl);
      if (url.protocol !== 'https:') {
        errors.tenantUrl = 'Tenant URL must use the https:// protocol.';
      }
    } catch (error) {
      errors.tenantUrl = 'Enter a valid https:// URL for your incidentIQ tenant.';
    }
  }

  if (normalized.authMethod === 'apiKey') {
    if (!normalized.apiKey) {
      errors.apiKey = 'Provide an API key to authenticate requests.';
    }
  } else if (normalized.authMethod === 'oauth') {
    if (!normalized.oauthClientId) {
      errors.oauthClientId = 'Provide an OAuth client ID to use OAuth authentication.';
    }
  } else {
    errors.authMethod = 'Choose an authentication method.';
  }

  if (
    !Number.isFinite(normalized.syncIntervalMinutes) ||
    normalized.syncIntervalMinutes < MIN_SYNC_INTERVAL ||
    normalized.syncIntervalMinutes > MAX_SYNC_INTERVAL
  ) {
    errors.syncIntervalMinutes = `Sync interval must be between ${MIN_SYNC_INTERVAL} and ${MAX_SYNC_INTERVAL} minutes.`;
  }

  const isValid = Object.keys(errors).length === 0;
  return { isValid, errors, settings: normalized };
}

export function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    return { settings: cloneDefaultSettings(), migrated: false };
  }

  const working = { ...raw };
  let migrated = false;
  let sourceSchemaVersion = null;

  const previousVersion = Number.isFinite(working.schemaVersion) ? working.schemaVersion : null;
  if (!previousVersion || previousVersion < CURRENT_SCHEMA_VERSION) {
    migrated = true;
    sourceSchemaVersion = previousVersion;
  }

  if (!working.tenantUrl && typeof working.tenantSubdomain === 'string' && working.tenantSubdomain.trim()) {
    const sanitizedSubdomain = working.tenantSubdomain.trim().replace(/^https?:\/\//i, '');
    working.tenantUrl = `https://${sanitizedSubdomain}.incidentiq.com`;
    migrated = true;
  }

  if (
    working.syncIntervalMinutes === undefined &&
    typeof working.syncInterval === 'number' &&
    Number.isFinite(working.syncInterval)
  ) {
    working.syncIntervalMinutes = working.syncInterval;
    migrated = true;
  }

  const normalized = normalizeSettings(working);
  normalized.schemaVersion = CURRENT_SCHEMA_VERSION;
  normalized.lastMigratedFrom = migrated ? sourceSchemaVersion ?? normalized.lastMigratedFrom : normalized.lastMigratedFrom;

  if (typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0) {
    normalized.updatedAt = raw.updatedAt;
  }

  return { settings: normalized, migrated };
}

async function writeSettingsWithFallback(entries, preferredArea = null) {
  const attempts = [];
  if (preferredArea) {
    attempts.push(preferredArea);
  }
  if (!attempts.includes('managed')) {
    attempts.push('managed');
  }
  if (!attempts.includes('sync')) {
    attempts.push('sync');
  }

  let lastError = null;

  for (const areaName of attempts) {
    const area = getChromeStorageArea(areaName);
    if (!area || typeof area.set !== 'function') {
      continue;
    }

    try {
      await storageSet(area, entries);
      return areaName;
    } catch (error) {
      lastError = error;
      if (areaName === 'sync') {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('No writable storage area available.');
}

export async function saveSettings(partial, { targetArea = null, skipValidation = false, preserveUpdatedAt = false } = {}) {
  let prepared;
  if (skipValidation) {
    prepared = normalizeSettings(partial);
  } else {
    const validation = validateSettings(partial);
    if (!validation.isValid) {
      const error = new Error('Settings validation failed.');
      error.validationErrors = validation.errors;
      throw error;
    }
    prepared = validation.settings;
  }

  prepared.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (typeof partial.lastMigratedFrom === 'number' && Number.isFinite(partial.lastMigratedFrom)) {
    prepared.lastMigratedFrom = partial.lastMigratedFrom;
  } else if (!prepared.lastMigratedFrom) {
    prepared.lastMigratedFrom = null;
  }

  if (preserveUpdatedAt) {
    if (!prepared.updatedAt) {
      prepared.updatedAt = new Date().toISOString();
    }
  } else {
    prepared.updatedAt = new Date().toISOString();
  }

  const entries = { [SETTINGS_STORAGE_KEY]: prepared };
  const areaName = await writeSettingsWithFallback(entries, targetArea);
  return { area: areaName, settings: prepared };
}

export async function loadSettings({ migrate = true } = {}) {
  const managedResult = await readSettingsFromArea('managed');
  if (managedResult.raw) {
    const { settings, migrated } = migrateSettings(managedResult.raw);
    if (migrate && migrated) {
      try {
        await saveSettings(settings, { targetArea: 'managed', skipValidation: true, preserveUpdatedAt: true });
      } catch (error) {
        console.warn('Unable to persist migrated managed settings; falling back to sync.', error);
        await saveSettings(settings, { targetArea: 'sync', skipValidation: true, preserveUpdatedAt: true });
      }
    }

    return { area: 'managed', settings, migrated };
  }

  const syncResult = await readSettingsFromArea('sync');
  if (syncResult.raw) {
    const { settings, migrated } = migrateSettings(syncResult.raw);
    if (migrate && migrated) {
      await saveSettings(settings, { targetArea: 'sync', skipValidation: true, preserveUpdatedAt: true });
    }

    return { area: 'sync', settings, migrated };
  }

  return { area: null, settings: cloneDefaultSettings(), migrated: false };
}

function getFormElement(form, selector) {
  const element = form.querySelector(selector);
  if (!element) {
    throw new Error(`Missing form control: ${selector}`);
  }
  return element;
}

function updateAuthVisibility(form, method) {
  const sections = form.querySelectorAll('[data-auth-section]');
  sections.forEach((section) => {
    const sectionMethod = section.getAttribute('data-auth-section');
    const shouldShow = sectionMethod === method;
    section.hidden = !shouldShow;
  });
}

function setFieldError(form, fieldName, message) {
  const errorElement = form.querySelector(`[data-error-for="${fieldName}"]`);
  if (!errorElement) {
    return;
  }

  if (message) {
    errorElement.textContent = message;
    errorElement.hidden = false;
  } else {
    errorElement.textContent = '';
    errorElement.hidden = true;
  }
}

function clearAllErrors(form) {
  const errors = form.querySelectorAll('[data-error-for]');
  errors.forEach((error) => {
    error.textContent = '';
    error.hidden = true;
  });
}

function displayFeedback(feedbackElement, { type, message }) {
  if (!feedbackElement) {
    return;
  }

  feedbackElement.textContent = message;
  feedbackElement.hidden = false;
  feedbackElement.classList.remove('success', 'error');
  feedbackElement.classList.add(type === 'error' ? 'error' : 'success');
}

function clearFeedback(feedbackElement) {
  if (!feedbackElement) {
    return;
  }

  feedbackElement.textContent = '';
  feedbackElement.hidden = true;
  feedbackElement.classList.remove('success', 'error');
}

function readFormValues(form) {
  const tenantUrl = getFormElement(form, 'input[name="tenantUrl"]').value;
  const authMethodInput = form.querySelector('input[name="authMethod"]:checked');
  const authMethod = authMethodInput ? authMethodInput.value : '';
  const apiKey = getFormElement(form, 'input[name="apiKey"]').value;
  const oauthClientId = getFormElement(form, 'input[name="oauthClientId"]').value;
  const syncIntervalRaw = getFormElement(form, 'input[name="syncIntervalMinutes"]').value;

  return {
    tenantUrl,
    authMethod,
    apiKey,
    oauthClientId,
    syncIntervalMinutes: syncIntervalRaw,
  };
}

function applySettingsToForm(form, settings) {
  getFormElement(form, 'input[name="tenantUrl"]').value = settings.tenantUrl ?? '';

  const authMethod = settings.authMethod ?? 'apiKey';
  const methodInput = form.querySelector(`input[name="authMethod"][value="${authMethod}"]`);
  if (methodInput) {
    methodInput.checked = true;
  }

  getFormElement(form, 'input[name="apiKey"]').value = settings.apiKey ?? '';
  getFormElement(form, 'input[name="oauthClientId"]').value = settings.oauthClientId ?? '';
  getFormElement(form, 'input[name="syncIntervalMinutes"]').value = settings.syncIntervalMinutes ?? DEFAULT_SETTINGS.syncIntervalMinutes;

  updateAuthVisibility(form, authMethod);
}

export async function initializeOptionsPage() {
  if (typeof document === 'undefined') {
    return;
  }

  const form = document.querySelector('#settings-form');
  const feedback = document.querySelector('#form-feedback');
  if (!form) {
    console.warn('Settings form was not found on the page.');
    return;
  }

  clearFeedback(feedback);
  clearAllErrors(form);

  try {
    const { settings } = await loadSettings();
    applySettingsToForm(form, settings);
  } catch (error) {
    console.error('Failed to load settings for the options page:', error);
    displayFeedback(feedback, {
      type: 'error',
      message: 'Unable to load saved settings. Changes may not persist.',
    });
  }

  form.addEventListener('change', (event) => {
    if (event.target?.name === 'authMethod') {
      updateAuthVisibility(form, event.target.value);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback(feedback);

    const values = readFormValues(form);
    const { isValid, errors, settings } = validateSettings(values);
    clearAllErrors(form);

    Object.entries(errors).forEach(([field, message]) => {
      setFieldError(form, field, message);
    });

    if (!isValid) {
      displayFeedback(feedback, {
        type: 'error',
        message: 'Fix the highlighted fields before saving.',
      });
      return;
    }

    try {
      const { area, settings: persisted } = await saveSettings(settings, {
        skipValidation: true,
      });

      displayFeedback(feedback, {
        type: 'success',
        message: `Settings saved to chrome.storage.${area ?? 'sync'} at ${new Date(
          persisted.updatedAt,
        ).toLocaleString()}.`,
      });
    } catch (error) {
      console.error('Failed to save iiQ settings:', error);
      displayFeedback(feedback, {
        type: 'error',
        message: error?.message ?? 'Unable to save settings. Try again.',
      });
    }
  });
}

if (typeof document !== 'undefined') {
  initializeOptionsPage().catch((error) => {
    console.error('Unable to initialize options page:', error);
  });
}

export async function getEffectiveSettings() {
  const { settings } = await loadSettings({ migrate: true });
  return settings;
}

