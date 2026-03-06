describe('background.js', () => {
  function loadBackground() {
    return require('../background.js');
  }

  test('readSettings merges defaults, stored values, and overrides', async () => {
    chrome.__storageData.provider = 'local';
    chrome.__storageData.apiUrl = '';
    chrome.__storageData.model = '';

    const background = loadBackground();
    const settings = await background.readSettings({ apiKey: 'override-key' });

    expect(settings.provider).toBe('local');
    expect(settings.apiUrl).toBe(background.PROVIDER_DEFAULTS.local);
    expect(settings.model).toBe(background.DEFAULT_SETTINGS.model);
    expect(settings.apiKey).toBe('override-key');
  });

  test('handlePolishRequest injects custom instructions into API messages', async () => {
    chrome.__storageData.provider = 'openai';
    chrome.__storageData.apiUrl = 'https://api.openai.com/v1/chat/completions';
    chrome.__storageData.apiKey = 'sk-test';
    chrome.__storageData.model = 'gpt-4.1';
    chrome.__storageData.customInstructions = 'Keep it direct and concise.';

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          choices: [{ message: { content: 'Polished response' } }]
        })
      )
    });

    const background = loadBackground();
    const output = await background.handlePolishRequest({ draftText: 'hello world' });

    expect(output).toEqual({ polishedText: 'Polished response' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [, request] = global.fetch.mock.calls[0];
    const parsed = JSON.parse(request.body);

    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0].role).toBe('system');
    expect(parsed.messages[1].role).toBe('system');
    expect(parsed.messages[1].content).toContain('Additional style guidance from user');
    expect(parsed.messages[1].content).toContain('Keep it direct and concise.');
    expect(parsed.messages[2].role).toBe('user');
    expect(parsed.messages[2].content).toContain('hello world');
  });

  test('onRuntimeMessage handles polishEmail requests', async () => {
    chrome.__storageData.provider = 'openai';
    chrome.__storageData.apiUrl = 'https://api.openai.com/v1/chat/completions';
    chrome.__storageData.apiKey = 'sk-test';
    chrome.__storageData.model = 'gpt-4.1';

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          choices: [{ message: { content: 'Polished email' } }]
        })
      )
    });

    const background = loadBackground();

    await new Promise((resolve) => {
      const returned = background.onRuntimeMessage(
        { type: 'polishEmail', draftText: 'original draft' },
        null,
        (response) => {
          expect(response.ok).toBe(true);
          expect(response.polishedText).toBe('Polished email');
          resolve();
        }
      );

      expect(returned).toBe(true);
    });
  });

  test('onRuntimeMessage handles testConnection requests', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          choices: [{ message: { content: 'connection-ok' } }]
        })
      )
    });

    const background = loadBackground();

    await new Promise((resolve) => {
      const returned = background.onRuntimeMessage(
        {
          type: 'testConnection',
          settings: {
            provider: 'local',
            apiUrl: 'http://localhost:1234/v1/chat/completions',
            model: 'local-model'
          }
        },
        null,
        (response) => {
          expect(response).toEqual({ ok: true, message: 'Connection successful.' });
          resolve();
        }
      );

      expect(returned).toBe(true);
    });
  });

  test('callChatCompletions times out after 15 seconds', async () => {
    jest.useFakeTimers();

    global.fetch.mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const background = loadBackground();

    const promise = background.callChatCompletions({
      settings: {
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        model: 'gpt-4.1'
      },
      messages: [{ role: 'user', content: 'Hello' }]
    });

    jest.advanceTimersByTime(15000);

    await expect(promise).rejects.toThrow('Request timed out after 15 seconds.');
  });

  test('callChatCompletions surfaces API and empty-response errors', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Invalid API key' } }))
    });

    const background = loadBackground();

    await expect(
      background.callChatCompletions({
        settings: {
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'bad-key',
          model: 'gpt-4.1'
        },
        messages: [{ role: 'user', content: 'Hello' }]
      })
    ).rejects.toThrow('Invalid API key');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ choices: [] }))
    });

    await expect(
      background.callChatCompletions({
        settings: {
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'sk-test',
          model: 'gpt-4.1'
        },
        messages: [{ role: 'user', content: 'Hello again' }]
      })
    ).rejects.toThrow('API returned an empty response.');
  });

  test('parsePolishResponse returns JSON subject+body when subject was provided', () => {
    const background = loadBackground();

    const jsonResponse = JSON.stringify({ subject: 'Better Subject', body: 'Better body text' });
    const result = background.parsePolishResponse(jsonResponse, 'Original Subject');

    expect(result.polishedText).toBe('Better body text');
    expect(result.polishedSubject).toBe('Better Subject');
  });

  test('parsePolishResponse returns plain text when no subject was provided', () => {
    const background = loadBackground();

    const result = background.parsePolishResponse('Just polished text', '');

    expect(result.polishedText).toBe('Just polished text');
    expect(result.polishedSubject).toBeUndefined();
  });

  test('parsePolishResponse falls back to raw text when JSON parsing fails', () => {
    const background = loadBackground();

    const result = background.parsePolishResponse('Not valid JSON at all', 'Some subject');

    expect(result.polishedText).toBe('Not valid JSON at all');
    expect(result.polishedSubject).toBeUndefined();
  });

  test('handlePolishRequest includes subject in user message when provided', async () => {
    chrome.__storageData.provider = 'openai';
    chrome.__storageData.apiUrl = 'https://api.openai.com/v1/chat/completions';
    chrome.__storageData.apiKey = 'sk-test';
    chrome.__storageData.model = 'gpt-4.1';
    chrome.__storageData.customInstructions = '';

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          choices: [{ message: { content: '{"subject":"New Subject","body":"New body"}' } }]
        })
      )
    });

    const background = loadBackground();
    const output = await background.handlePolishRequest({
      draftText: 'hello',
      subject: 'Old Subject'
    });

    expect(output.polishedText).toBe('New body');
    expect(output.polishedSubject).toBe('New Subject');

    const [, request] = global.fetch.mock.calls[0];
    const parsed = JSON.parse(request.body);
    const userMsg = parsed.messages.find((m) => m.role === 'user');
    expect(userMsg.content).toContain('Subject: Old Subject');
  });
});
