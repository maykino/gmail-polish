function resolveStorageGet(keys, storage) {
  if (Array.isArray(keys)) {
    return keys.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(storage, key)) {
        result[key] = storage[key];
      }
      return result;
    }, {});
  }

  if (typeof keys === 'string') {
    return Object.prototype.hasOwnProperty.call(storage, keys) ? { [keys]: storage[keys] } : {};
  }

  if (keys && typeof keys === 'object') {
    return Object.keys(keys).reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(storage, key)) {
        result[key] = storage[key];
      } else {
        result[key] = keys[key];
      }
      return result;
    }, {});
  }

  return { ...storage };
}

function createChromeMock(initialStorage = {}) {
  const storageData = { ...initialStorage };

  const local = {
    get: jest.fn((keys, callback) => {
      const result = resolveStorageGet(keys, storageData);
      if (typeof callback === 'function') {
        callback(result);
        return;
      }
      return Promise.resolve(result);
    }),
    set: jest.fn((values, callback) => {
      Object.assign(storageData, values || {});
      if (typeof callback === 'function') {
        callback();
        return;
      }
      return Promise.resolve();
    })
  };

  const runtime = {
    lastError: null,
    sendMessage: jest.fn((_message, callback) => {
      if (typeof callback === 'function') {
        callback({ ok: true });
      }
    }),
    openOptionsPage: jest.fn(),
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  };

  return {
    storage: { local },
    runtime,
    __storageData: storageData
  };
}

global.createChromeMock = createChromeMock;
global.flushPromises = () => Promise.resolve();

beforeEach(() => {
  jest.resetModules();
  jest.useRealTimers();

  global.chrome = createChromeMock();
  global.fetch = jest.fn();
  global.__GMAIL_POLISH_DISABLE_AUTO_INIT__ = true;

  if (typeof InputEvent === 'undefined') {
    class InputEventPolyfill extends Event {
      constructor(type, options = {}) {
        super(type, options);
        this.inputType = options.inputType || '';
        this.data = options.data || null;
      }
    }

    global.InputEvent = InputEventPolyfill;
    if (typeof window !== 'undefined') {
      window.InputEvent = InputEventPolyfill;
    }
  }
});

afterEach(() => {
  delete global.__GMAIL_POLISH_DISABLE_AUTO_INIT__;
});
