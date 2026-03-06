// Load gitignored config (API key) — safe to skip if file doesn't exist
try { importScripts('config.local.js'); } catch (_e) { /* no local config */ }

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
  '- Do not add a signature (it\'s handled separately)',
  '',
  'Response format:',
  '- If a subject line is provided, return valid JSON: {"subject": "polished subject", "body": "polished email body"}',
  '- If no subject line is provided, return ONLY the polished email text with no JSON wrapping',
  '- Never include explanations or commentary outside the JSON or polished text'
].join('\n');

function onRuntimeMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'polishEmail') {
    handlePolishRequest(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
    return false;
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

// Auto-seed API key from gitignored config.local.js on install/reload
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    if (typeof LOCAL_CONFIG !== 'undefined' && LOCAL_CONFIG.apiKey && LOCAL_CONFIG.apiKey !== 'YOUR_API_KEY_HERE') {
      await chrome.storage.local.set({ apiKey: LOCAL_CONFIG.apiKey });
    }
  });
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

  const subject = (message?.subject || '').trim();
  const settings = await readSettings();

  if (settings.provider === 'openai' && !settings.apiKey.trim()) {
    throw new Error('API key is not configured.');
  }

  const userParts = ['Polish this email draft while preserving meaning and details:'];

  if (subject) {
    userParts.push('', `Subject: ${subject}`);
  }

  userParts.push('', draftText);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n') }
  ];

  const customInstructions = settings.customInstructions.trim();
  if (customInstructions) {
    messages.splice(1, 0, {
      role: 'system',
      content: `Additional style guidance from user:\n${customInstructions}`
    });
  }

  const raw = await callChatCompletions({
    settings,
    messages,
    responseFormat: subject ? { type: 'json_object' } : undefined
  });

  return parsePolishResponse(raw, subject);
}

function parsePolishResponse(raw, hasSubject) {
  if (!hasSubject) {
    return { polishedText: raw };
  }

  // Try parsing the full response as JSON first
  const candidates = [
    raw.trim(),
    raw.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim()
  ];

  // Also try extracting a JSON object from anywhere in the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed.body === 'string') {
        return {
          polishedText: parsed.body.trim(),
          polishedSubject: typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
        };
      }
    } catch (_error) {
      // Try next candidate
    }
  }

  return { polishedText: raw };
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

async function callChatCompletions({ settings, messages, maxTokens = 2048, temperature = 0.3, responseFormat } = {}) {
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
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {})
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
    parsePolishResponse,
    handleTestRequest,
    callChatCompletions
  };
}
