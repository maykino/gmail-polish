describe('content.js', () => {
  function loadContent() {
    return require('../content.js');
  }

  function createComposeDom({ html = 'Draft text', attrs = {} } = {}) {
    const root = document.createElement('div');
    root.setAttribute('role', 'dialog');

    const toolbar = document.createElement('div');
    toolbar.className = 'aDh';
    root.appendChild(toolbar);

    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('contenteditable', 'true');
    body.setAttribute('g_editable', 'true');
    body.setAttribute('aria-label', 'Message Body');

    Object.entries(attrs).forEach(([key, value]) => {
      body.setAttribute(key, value);
    });

    body.innerHTML = html;
    root.appendChild(body);
    document.body.appendChild(root);

    return { root, toolbar, body };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('isComposeBody detects Gmail compose bodies', () => {
    const content = loadContent();

    const byEditable = document.createElement('div');
    byEditable.setAttribute('g_editable', 'true');

    const byLabel = document.createElement('div');
    byLabel.setAttribute('aria-label', 'Message Body');

    const notCompose = document.createElement('div');
    notCompose.setAttribute('aria-label', 'Search Mail');

    expect(content.isComposeBody(byEditable)).toBe(true);
    expect(content.isComposeBody(byLabel)).toBe(true);
    expect(content.isComposeBody(notCompose)).toBe(false);
  });

  test('extractDraftText removes signatures and quote blocks using layered selectors', () => {
    const content = loadContent();
    const { body } = createComposeDom({
      html: [
        'Hello team,<br>Here is the update.',
        '<div data-smartmail="gmail_signature">Best,<br>Sender</div>',
        '<blockquote type="cite">Prior thread quote</blockquote>'
      ].join('')
    });

    const extracted = content.extractDraftText(body);

    expect(extracted).toContain('Hello team');
    expect(extracted).toContain('Here is the update.');
    expect(extracted).not.toContain('Best,');
    expect(extracted).not.toContain('Prior thread quote');
  });

  test('extractDraftText removes gmail_quote and plain text signature delimiter', () => {
    const content = loadContent();
    const { body: quoteBody } = createComposeDom({
      html: 'Current note<div class="gmail_quote">Old quoted content</div>'
    });

    expect(content.extractDraftText(quoteBody)).toBe('Current note');

    const { body: plainBody } = createComposeDom({
      html: 'Hello there\n-- \nSignature block'
    });

    expect(content.extractDraftText(plainBody)).toBe('Hello there');
  });

  test('containsRichFormatting detects rich content markers', () => {
    const content = loadContent();
    const { body: plainBody } = createComposeDom({ html: 'Plain text only' });
    const { body: richBody } = createComposeDom({ html: 'See <b>bold</b> and <a href="#">link</a>' });

    expect(content.containsRichFormatting(plainBody)).toBe(false);
    expect(content.containsRichFormatting(richBody)).toBe(true);
  });

  test('replaceComposeText uses execCommand insertText when supported', () => {
    const content = loadContent();
    const { body } = createComposeDom({ html: 'Old draft' });

    const inputEvents = [];
    const changeEvents = [];
    body.addEventListener('input', (event) => inputEvents.push(event));
    body.addEventListener('change', (event) => changeEvents.push(event));

    document.execCommand = jest.fn(() => true);

    content.replaceComposeText(body, 'Polished draft');

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'Polished draft');
    expect(inputEvents.length).toBeGreaterThan(0);
    expect(changeEvents.length).toBe(1);
  });

  test('replaceComposeText falls back to InputEvent when execCommand fails', () => {
    const content = loadContent();
    const { body } = createComposeDom({ html: 'Old draft' });

    const observedInputEvents = [];
    body.addEventListener('input', (event) => {
      observedInputEvents.push(event);
    });

    document.execCommand = jest.fn(() => false);

    content.replaceComposeText(body, 'Fallback polished text');

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'Fallback polished text');
    expect(body.textContent).toBe('Fallback polished text');
    expect(
      observedInputEvents.some(
        (event) => event instanceof InputEvent && event.inputType === 'insertText'
      )
    ).toBe(true);
  });

  test('undo entry lifecycle stores, restores, clears, and expires entries after 30s', () => {
    jest.useFakeTimers();

    const content = loadContent();
    const { body } = createComposeDom({ html: '<p>Current</p>' });

    content.setUndoEntry(body, '<p>Original</p>');
    expect(content.__internal.undoEntries.has(body)).toBe(true);
    expect(content.__internal.undoEntries.get(body).originalHtml).toBe('<p>Original</p>');

    body.innerHTML = '<p>Changed</p>';
    content.restoreOriginalDraft(body);

    expect(body.innerHTML).toBe('<p>Original</p>');
    expect(content.__internal.undoEntries.has(body)).toBe(false);

    content.setUndoEntry(body, '<p>Again</p>');
    expect(content.__internal.undoEntries.has(body)).toBe(true);

    content.clearUndoEntry(body, true);
    expect(content.__internal.undoEntries.has(body)).toBe(false);

    content.setUndoEntry(body, '<p>Will Expire</p>');
    jest.advanceTimersByTime(30000);

    expect(content.__internal.undoEntries.has(body)).toBe(false);
  });

  test('isUndoShortcut and global Ctrl+Shift+P shortcut detection work', async () => {
    const content = loadContent();
    const { body } = createComposeDom({ html: 'Shortcut draft' });

    expect(content.isUndoShortcut({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(content.isUndoShortcut({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe(true);
    expect(content.isUndoShortcut({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(false);

    chrome.__storageData.provider = 'openai';
    chrome.__storageData.apiKey = 'sk-shortcut';

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({ ok: true, polishedText: 'Polished via shortcut' });
    });

    document.execCommand = jest.fn(() => true);
    content.ensureComposeState(body);

    body.focus();

    const shortcutEvent = {
      key: 'p',
      shiftKey: true,
      ctrlKey: true,
      metaKey: false,
      preventDefault: jest.fn()
    };

    content.onGlobalShortcut(shortcutEvent);
    await flushPromises();
    await flushPromises();

    expect(shortcutEvent.preventDefault).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'polishEmail' }),
      expect.any(Function)
    );
  });

  test('setLoadingState toggles button text/disabled state and compose processing class', () => {
    const content = loadContent();
    const { body } = createComposeDom({ html: 'Loading state draft' });

    const state = content.ensureComposeState(body);
    const button = document.createElement('button');

    const icon = document.createElement('span');
    icon.className = 'gmail-polish-icon';
    icon.textContent = content.POLISH_BUTTON_ICON;

    const label = document.createElement('span');
    label.className = 'gmail-polish-label';
    label.textContent = content.POLISH_BUTTON_LABEL;

    button.appendChild(icon);
    button.appendChild(label);
    state.button = button;

    content.setLoadingState(body, true);

    expect(button.disabled).toBe(true);
    expect(icon.textContent).toBe(content.POLISH_BUTTON_LOADING_ICON);
    expect(label.textContent).toBe(content.POLISH_BUTTON_LOADING_LABEL);
    expect(button.classList.contains('gmail-polish-button-loading')).toBe(true);
    expect(body.classList.contains('gmail-polish-processing')).toBe(true);

    content.setLoadingState(body, false);

    expect(button.disabled).toBe(false);
    expect(icon.textContent).toBe(content.POLISH_BUTTON_ICON);
    expect(label.textContent).toBe(content.POLISH_BUTTON_LABEL);
    expect(button.classList.contains('gmail-polish-button-loading')).toBe(false);
    expect(body.classList.contains('gmail-polish-processing')).toBe(false);
  });

  test('showToast renders and auto-dismisses after 5 seconds', () => {
    jest.useFakeTimers();

    const content = loadContent();
    const { root, body } = createComposeDom({ html: 'Toast draft' });

    content.showToast(body, 'Something went wrong');

    const toast = root.querySelector('.gmail-polish-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Something went wrong');

    jest.advanceTimersByTime(5000);

    expect(root.querySelector('.gmail-polish-toast')).toBeNull();
  });
});
