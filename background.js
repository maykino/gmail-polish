const DEFAULT_SETTINGS = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4.1',
  customInstructions: ''
};

const PROVIDER_DEFAULTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  local: 'http://localhost:1234/v1/chat/completions'
};

const SYSTEM_PROMPT = [
  'You are an email writing assistant. Your job is to polish and improve emails while preserving the sender\'s intent, meaning, and voice.',
  '',
  'Rules:',
  '- Fix grammar, spelling, and punctuation',
  '- Improve clarity and professional tone',
  '- Keep the same level of formality the sender intended (don\'t make casual emails overly formal)',
  '- Preserve all names, addresses, numbers, dates, and specific details EXACTLY',
  '- Keep the email concise -- don\'t add unnecessary fluff',
  '- Maintain the original structure (greeting, body, sign-off)',
  '- Return ONLY the polished email text, no explanations or commentary',
  '- Do not add a subject line',
  '- Do not add a signature (it\'s handled separately)'
].join('\n');

function onRuntimeMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'polishEmail') {
    handlePolishRequest(message)
      .then((result) => sendResponse({ ok: true, polishedText: result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'testConnection') {
    handleTestRequest(message)
      .then((result) => sendResponse({ ok: true, message: result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
}

async function readSettings(overrides = {}) {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const merged = { ...DEFAULT_SETTINGS, ...stored, ...overrides };

  if (!merged.apiUrl) {
    merged.apiUrl = PROVIDER_DEFAULTS[merged.provider] || DEFAULT_SETTINGS.apiUrl;
  }

  if (!merged.model) {
    merged.model = DEFAULT_SETTINGS.model;
  }

  return merged;
}

async function handlePolishRequest(message) {
  const draftText = (message?.draftText || '').trim();
  if (!draftText) {
    throw new Error('Draft is empty.');
  }

  const settings = await readSettings();

  if (settings.provider === 'openai' && !settings.apiKey.trim()) {
    throw new Error('API key is not configured.');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Polish this email draft while preserving meaning and details:',
        '',
        draftText
      ].join('\n')
    }
  ];

  const customInstructions = settings.customInstructions.trim();
  if (customInstructions) {
    messages.splice(1, 0, {
      role: 'system',
      content: `Additional style guidance from user:\n${customInstructions}`
    });
  }

  return callChatCompletions({
    settings,
    messages
  });
}

async function handleTestRequest(message) {
  const settings = await readSettings(message?.settings || {});

  if (settings.provider === 'openai' && !settings.apiKey.trim()) {
    throw new Error('API key is required for OpenAI API provider.');
  }

  await callChatCompletions({
    settings,
    messages: [
      {
        role: 'system',
        content: 'You are a connectivity checker. Respond with exactly: connection-ok'
      },
      {
        role: 'user',
        content: 'Check connectivity.'
      }
    ],
    maxTokens: 32,
    temperature: 0
  });

  return 'Connection successful.';
}

async function callChatCompletions({ settings, messages, maxTokens = 2048, temperature = 0.3 }) {
  const apiUrl = settings.apiUrl.trim();
  if (!apiUrl) {
    throw new Error('API URL is required.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    let payload;

    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (_error) {
      payload = {};
    }

    if (!response.ok) {
      const apiError = payload?.error?.message || `Request failed (${response.status}).`;
      throw new Error(apiError);
    }

    const rawContent = payload?.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((item) => item?.text || '').join('')
      : rawContent;

    if (!content || typeof content !== 'string') {
      throw new Error('API returned an empty response.');
    }

    return content.trim();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out after 15 seconds.');
    }

    throw error instanceof Error ? error : new Error('Request failed.');
  } finally {
    clearTimeout(timeoutId);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SETTINGS,
    PROVIDER_DEFAULTS,
    SYSTEM_PROMPT,
    onRuntimeMessage,
    readSettings,
    handlePolishRequest,
    handleTestRequest,
    callChatCompletions
  };
}
