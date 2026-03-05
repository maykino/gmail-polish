const DEFAULTS = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4.1',
  customInstructions: ''
};

const PROVIDER_PRESETS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  local: 'http://localhost:1234/v1/chat/completions'
};

const providerEl = document.getElementById('provider');
const apiUrlEl = document.getElementById('apiUrl');
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const customInstructionsEl = document.getElementById('customInstructions');
const saveButton = document.getElementById('save');
const testButton = document.getElementById('test');
const statusEl = document.getElementById('status');

const hasRequiredElements = Boolean(
  providerEl &&
  apiUrlEl &&
  apiKeyEl &&
  modelEl &&
  customInstructionsEl &&
  saveButton &&
  testButton &&
  statusEl
);

if (hasRequiredElements) {
  init();
}

function init() {
  providerEl.addEventListener('change', onProviderChange);
  saveButton.addEventListener('click', onSave);
  testButton.addEventListener('click', onTestConnection);

  loadSettings();
}

function onProviderChange() {
  const provider = providerEl.value;
  apiUrlEl.value = PROVIDER_PRESETS[provider] || DEFAULTS.apiUrl;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...saved };

  providerEl.value = settings.provider;
  apiUrlEl.value = settings.apiUrl || PROVIDER_PRESETS[settings.provider] || DEFAULTS.apiUrl;
  apiKeyEl.value = settings.apiKey;
  modelEl.value = settings.model;
  customInstructionsEl.value = settings.customInstructions;
}

async function onSave() {
  clearStatus();

  const settings = collectSettings();

  if (!settings.apiUrl) {
    setStatus('API URL is required.', 'error');
    return;
  }

  if (!settings.model) {
    setStatus('Model is required.', 'error');
    return;
  }

  await chrome.storage.local.set(settings);
  setStatus('Settings saved.', 'success');
}

async function onTestConnection() {
  clearStatus();

  const settings = collectSettings();

  if (!settings.apiUrl) {
    setStatus('API URL is required before testing.', 'error');
    return;
  }

  if (settings.provider === 'openai' && !settings.apiKey.trim()) {
    setStatus('API key is required for OpenAI API provider.', 'error');
    return;
  }

  setButtonsDisabled(true);
  setStatus('Testing connection...', '');

  try {
    const response = await sendMessage({
      type: 'testConnection',
      settings
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Connection test failed.');
    }

    setStatus(response.message || 'Connection successful.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed.';
    setStatus(message, 'error');
  } finally {
    setButtonsDisabled(false);
  }
}

function collectSettings() {
  return {
    provider: providerEl.value,
    apiUrl: apiUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim(),
    customInstructions: customInstructionsEl.value.trim()
  };
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function setButtonsDisabled(disabled) {
  if (!saveButton || !testButton) {
    return;
  }

  saveButton.disabled = disabled;
  testButton.disabled = disabled;
}

function setStatus(message, kind) {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.className = kind;
}

function clearStatus() {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = '';
  statusEl.className = '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULTS,
    PROVIDER_PRESETS,
    init,
    onProviderChange,
    loadSettings,
    onSave,
    onTestConnection,
    collectSettings,
    sendMessage,
    setButtonsDisabled,
    setStatus,
    clearStatus
  };
}
