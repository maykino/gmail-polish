describe('options.js', () => {
  function setOptionsDom() {
    document.body.innerHTML = `
      <select id="provider">
        <option value="openai">OpenAI API</option>
        <option value="local">Local Server</option>
      </select>
      <input id="apiUrl" type="text" />
      <input id="apiKey" type="password" />
      <input id="model" type="text" />
      <textarea id="customInstructions"></textarea>
      <button id="save" type="button">Save</button>
      <button id="test" type="button">Test</button>
      <div id="status"></div>
    `;
  }

  function loadOptions() {
    return require('../options.js');
  }

  beforeEach(() => {
    setOptionsDom();
  });

  test('loadSettings populates UI from storage', async () => {
    chrome.__storageData.provider = 'local';
    chrome.__storageData.apiUrl = 'http://localhost:1234/v1/chat/completions';
    chrome.__storageData.apiKey = 'local-key';
    chrome.__storageData.model = 'local-model';
    chrome.__storageData.customInstructions = 'Keep concise';

    const options = loadOptions();
    await options.loadSettings();

    expect(document.getElementById('provider').value).toBe('local');
    expect(document.getElementById('apiUrl').value).toBe('http://localhost:1234/v1/chat/completions');
    expect(document.getElementById('apiKey').value).toBe('local-key');
    expect(document.getElementById('model').value).toBe('local-model');
    expect(document.getElementById('customInstructions').value).toBe('Keep concise');
  });

  test('onProviderChange applies provider URL presets', () => {
    const options = loadOptions();

    const provider = document.getElementById('provider');
    provider.value = 'local';

    options.onProviderChange();

    expect(document.getElementById('apiUrl').value).toBe('http://localhost:1234/v1/chat/completions');
  });

  test('onSave validates required fields and persists settings', async () => {
    const options = loadOptions();

    document.getElementById('provider').value = 'openai';
    document.getElementById('apiUrl').value = '';
    document.getElementById('apiKey').value = 'sk-test';
    document.getElementById('model').value = 'gpt-4.1';

    await options.onSave();

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(document.getElementById('status').textContent).toBe('API URL is required.');

    document.getElementById('apiUrl').value = 'https://api.openai.com/v1/chat/completions';
    document.getElementById('model').value = '';

    await options.onSave();

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(document.getElementById('status').textContent).toBe('Model is required.');

    document.getElementById('apiKey').value = 'sk-test';
    document.getElementById('model').value = 'gpt-4.1';
    document.getElementById('customInstructions').value = 'Stay polite';

    await options.onSave();

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      customInstructions: 'Stay polite'
    });
    expect(document.getElementById('status').textContent).toBe('Settings saved.');
    expect(document.getElementById('status').className).toBe('success');
  });

  test('onTestConnection validates and sends runtime message', async () => {
    const options = loadOptions();

    document.getElementById('provider').value = 'openai';
    document.getElementById('apiUrl').value = 'https://api.openai.com/v1/chat/completions';
    document.getElementById('apiKey').value = '';
    document.getElementById('model').value = 'gpt-4.1';

    await options.onTestConnection();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('status').textContent).toBe(
      'API key is required for OpenAI API provider.'
    );

    document.getElementById('apiKey').value = 'sk-test';

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({ ok: true, message: 'Connection successful.' });
    });

    await options.onTestConnection();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'testConnection',
        settings: {
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'sk-test',
          model: 'gpt-4.1',
          customInstructions: ''
        }
      },
      expect.any(Function)
    );
    expect(document.getElementById('status').textContent).toBe('Connection successful.');
    expect(document.getElementById('status').className).toBe('success');
    expect(document.getElementById('save').disabled).toBe(false);
    expect(document.getElementById('test').disabled).toBe(false);
  });
});
