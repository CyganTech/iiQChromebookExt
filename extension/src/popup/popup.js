import { MESSAGE_TYPE_REQUEST_CONTEXT } from '../shared/messages.js';

export const AUTO_INIT_FLAG = '__IIQ_DISABLE_POPUP_AUTO_INIT__';

function formatRelativeTime(isoString, now = Date.now()) {
  if (!isoString) {
    return 'No successful sync yet';
  }

  const value = new Date(isoString);
  if (Number.isNaN(value.getTime())) {
    return 'Last sync time unavailable';
  }

  const diffMs = now - value.getTime();
  if (diffMs < 0) {
    return 'Last sync time unavailable';
  }

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function describeHealthReason(status) {
  if (!status?.healthReason) {
    return '';
  }
  return status.healthReason;
}

function getPrimaryShortcut(shortcuts = []) {
  if (!Array.isArray(shortcuts)) {
    return null;
  }

  return shortcuts.find((shortcut) => shortcut?.featured) ?? shortcuts[0] ?? null;
}

function createShortcutListItem(documentRef, shortcut) {
  const item = documentRef.createElement('li');
  item.className = 'shortcut-card__item';

  const link = documentRef.createElement('a');
  link.className = 'shortcut-card__link';
  link.href = shortcut.url;
  link.textContent = shortcut.label;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  const description = documentRef.createElement('p');
  description.className = 'shortcut-card__description';
  description.textContent = shortcut.description;

  item.appendChild(link);
  item.appendChild(description);

  return item;
}

function requestMessage(runtime, payload) {
  return new Promise((resolve, reject) => {
    if (!runtime?.sendMessage) {
      reject(new Error('Chrome runtime messaging is unavailable.'));
      return;
    }

    try {
      runtime.sendMessage(payload, (response) => {
        const lastError =
          (typeof chrome !== 'undefined' && chrome?.runtime?.lastError) || runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function createPopupController({
  document: documentRef = typeof document !== 'undefined' ? document : null,
  runtime = typeof chrome !== 'undefined' ? chrome.runtime : null,
  tabs = typeof chrome !== 'undefined' ? chrome.tabs : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  now = () => Date.now(),
} = {}) {
  if (!documentRef) {
    throw new Error('A document instance is required to bootstrap the popup.');
  }

  const refs = {
    app: documentRef.querySelector('[data-role="app"]'),
    statusCard: documentRef.querySelector('[data-role="status-card"]'),
    statusMessage: documentRef.querySelector('[data-role="status-message"]'),
    statusMeta: documentRef.querySelector('[data-role="status-meta"]'),
    ticketDescription: documentRef.querySelector('[data-role="ticket-description"]'),
    primaryAction: documentRef.querySelector('[data-role="primary-action"]'),
    shortcutSection: documentRef.querySelector('[data-role="shortcut-section"]'),
    shortcutList: documentRef.querySelector('[data-role="shortcut-list"]'),
    feedback: documentRef.querySelector('[data-role="feedback"]'),
    feedbackMessage: documentRef.querySelector('[data-role="feedback-message"]'),
    retryButton: documentRef.querySelector('[data-role="retry-button"]'),
  };

  const state = {
    loading: false,
    data: null,
    primaryShortcut: null,
  };

  function setHealthState(status) {
    if (!refs.statusCard) {
      return;
    }

    const health = status?.health ?? 'unknown';
    refs.statusCard.dataset.health = health;

    if (refs.statusMessage) {
      refs.statusMessage.textContent = status?.summary ?? 'Device status unavailable.';
    }

    if (refs.statusMeta) {
      const reason = describeHealthReason(status);
      const relative = formatRelativeTime(status?.lastSuccessfulSyncTime, now());
      const pieces = [relative];
      if (reason) {
        pieces.push(reason);
      }
      refs.statusMeta.textContent = pieces.filter(Boolean).join(' • ');
    }
  }

  function renderTicketState(shortcuts = []) {
    if (!refs.primaryAction) {
      return;
    }

    const primaryShortcut = getPrimaryShortcut(shortcuts);
    state.primaryShortcut = primaryShortcut;

    refs.primaryAction.textContent = primaryShortcut?.label ?? 'Submit Ticket';
    refs.primaryAction.disabled = !primaryShortcut?.url;

    if (refs.ticketDescription) {
      refs.ticketDescription.textContent = primaryShortcut?.description
        ? primaryShortcut.description
        : 'Open an iiQ ticket with your device details.';
    }

    if (refs.shortcutList && refs.shortcutSection) {
      refs.shortcutList.innerHTML = '';
      const secondaryShortcuts = shortcuts.filter((shortcut) => shortcut && shortcut !== primaryShortcut);

      if (secondaryShortcuts.length === 0) {
        refs.shortcutSection.hidden = true;
      } else {
        refs.shortcutSection.hidden = false;
        secondaryShortcuts.forEach((shortcut) => {
          refs.shortcutList.appendChild(createShortcutListItem(documentRef, shortcut));
        });
      }
    }
  }

  function setFeedback(message, type = 'error') {
    if (!refs.feedback || !refs.feedbackMessage) {
      return;
    }

    if (!message) {
      refs.feedback.hidden = true;
      refs.feedbackMessage.textContent = '';
      return;
    }

    refs.feedback.hidden = false;
    refs.feedback.dataset.type = type;
    refs.feedbackMessage.textContent = message;
  }

  function setLoading(isLoading) {
    state.loading = Boolean(isLoading);
    if (refs.primaryAction) {
      refs.primaryAction.setAttribute('aria-busy', String(state.loading));
    }
  }

  async function loadContext() {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await requestMessage(runtime, { type: MESSAGE_TYPE_REQUEST_CONTEXT });
      if (!response?.ok) {
        throw new Error(response?.error?.message ?? 'Failed to load device telemetry.');
      }

      state.data = response.data;
      setHealthState(response.data.deviceStatus);
      renderTicketState(response.data.ticketShortcuts);
    } catch (error) {
      console.error('Unable to load popup context', error);
      setFeedback(error.message || 'Unable to load device telemetry. Please try again.');
      if (refs.statusMessage) {
        refs.statusMessage.textContent = 'Device status unavailable.';
      }
      if (refs.statusMeta) {
        refs.statusMeta.textContent = 'Last sync —';
      }
      renderTicketState([]);
    } finally {
      setLoading(false);
    }
  }

  function openShortcut(shortcut) {
    if (!shortcut?.url) {
      return;
    }

    if (tabs?.create) {
      tabs.create({ url: shortcut.url });
    } else if (windowRef?.open) {
      windowRef.open(shortcut.url, '_blank', 'noopener,noreferrer');
    }
  }

  function handlePrimaryAction(event) {
    event.preventDefault();
    if (state.loading) {
      return;
    }

    if (!state.primaryShortcut) {
      setFeedback('No ticket routes are configured yet. Ask your administrator to configure iiQ links.');
      return;
    }

    openShortcut(state.primaryShortcut);
  }

  function bindEvents() {
    if (refs.primaryAction) {
      refs.primaryAction.addEventListener('click', handlePrimaryAction);
    }

    if (refs.retryButton) {
      refs.retryButton.addEventListener('click', () => {
        loadContext();
      });
    }
  }

  return {
    init() {
      bindEvents();
      loadContext();
    },
    refresh: loadContext,
    get state() {
      return state;
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (!window[AUTO_INIT_FLAG]) {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        createPopupController().init();
      } catch (error) {
        console.error('Failed to initialize iiQ popup UI', error);
      }
    });
  }
}
