(() => {
  const COMPOSE_SELECTOR = 'div[role="textbox"][contenteditable="true"]';
  const RICH_TEXT_PREF_KEY = 'gmailPolishSkipRichTextWarning';
  const POLISH_BUTTON_TEXT = '✨ Polish';
  const POLISH_BUTTON_LOADING_TEXT = '⏳ Polishing...';
  const UNDO_DURATION_MS = 30000;

  const composeStates = new WeakMap();
  const undoEntries = new WeakMap();
  let scanQueued = false;
  const root = typeof globalThis !== 'undefined' ? globalThis : window;

  if (!root.__GMAIL_POLISH_DISABLE_AUTO_INIT__) {
    init();
  }

  function init() {
    scanComposeBodies();

    const observer = new MutationObserver(() => {
      queueScan();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('keydown', onGlobalShortcut, true);
  }

  function queueScan() {
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scanComposeBodies();
    });
  }

  function scanComposeBodies() {
    const bodies = document.querySelectorAll(COMPOSE_SELECTOR);
    bodies.forEach((body) => {
      if (!isComposeBody(body)) {
        return;
      }

      ensureComposeState(body);
      ensurePolishButton(body);
    });
  }

  function isComposeBody(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const editable = element.getAttribute('g_editable') === 'true';
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    return editable || ariaLabel.includes('message body');
  }

  function ensureComposeState(body) {
    if (composeStates.has(body)) {
      return composeStates.get(body);
    }

    const state = {
      button: null,
      isPolishing: false
    };

    body.addEventListener('keydown', (event) => {
      onComposeKeydown(event, body);
    });

    composeStates.set(body, state);
    return state;
  }

  function ensurePolishButton(body) {
    const state = composeStates.get(body);
    if (!state) {
      return;
    }

    if (state.button && document.contains(state.button)) {
      return;
    }

    const toolbar = findToolbarContainer(body);
    if (!toolbar) {
      return;
    }

    const existing = toolbar.querySelector('.gmail-polish-button');
    if (existing) {
      state.button = existing;
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gmail-polish-button';
    button.textContent = POLISH_BUTTON_TEXT;
    button.addEventListener('click', () => {
      void polishComposeBody(body);
    });

    toolbar.appendChild(button);
    state.button = button;
  }

  function findToolbarContainer(body) {
    const composeRoot = findComposeRoot(body);
    if (!composeRoot) {
      return null;
    }

    composeRoot.classList.add('gmail-polish-compose-root');

    const directCandidates = [
      '.aDh',
      'div[gh="btb"]',
      'div[role="toolbar"]'
    ];

    for (const selector of directCandidates) {
      const node = composeRoot.querySelector(selector);
      if (node instanceof HTMLElement) {
        return node;
      }
    }

    const sendButton = composeRoot.querySelector(
      'div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label*="Send"]'
    );

    if (sendButton?.parentElement instanceof HTMLElement) {
      return sendButton.parentElement;
    }

    return body.parentElement;
  }

  function findComposeRoot(body) {
    let current = body;

    while (current && current !== document.body) {
      const hasSend = current.querySelector?.(
        'div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label*="Send"]'
      );

      if (hasSend) {
        return current;
      }

      if (current.getAttribute && current.getAttribute('role') === 'dialog') {
        return current;
      }

      current = current.parentElement;
    }

    return body.closest('div[role="dialog"]') || body.parentElement;
  }

  async function polishComposeBody(body) {
    const state = composeStates.get(body);
    if (!state || state.isPolishing) {
      return;
    }

    ensurePolishButton(body);

    const settings = await getSettings(['provider', 'apiKey']);
    const provider = settings.provider || 'openai';
    const apiKey = (settings.apiKey || '').trim();

    if (provider === 'openai' && !apiKey) {
      showToast(body, 'Configure your API key in extension options first.');
      chrome.runtime.openOptionsPage();
      return;
    }

    if (containsRichFormatting(body)) {
      await maybeShowRichTextWarning(body);
    }

    const draftText = extractDraftText(body);
    if (!draftText) {
      showToast(body, 'Nothing to polish in this draft.');
      return;
    }

    setLoadingState(body, true);
    state.isPolishing = true;

    try {
      const originalHtml = body.innerHTML;
      const response = await sendRuntimeMessage({
        type: 'polishEmail',
        draftText
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Unable to polish this draft.');
      }

      const polishedText = (response.polishedText || '').trim();
      if (!polishedText) {
        throw new Error('Received an empty polished draft.');
      }

      replaceComposeText(body, polishedText);
      setUndoEntry(body, originalHtml);
      showUndoBar(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to polish this draft.';
      showToast(body, message);
    } finally {
      state.isPolishing = false;
      setLoadingState(body, false);
    }
  }

  function containsRichFormatting(body) {
    return Boolean(body.querySelector('b, strong, i, em, a, ul, ol, img, [style]'));
  }

  async function maybeShowRichTextWarning(body) {
    const pref = await getSettings([RICH_TEXT_PREF_KEY]);
    if (pref[RICH_TEXT_PREF_KEY]) {
      return;
    }

    const composeRoot = findComposeRoot(body);
    if (!composeRoot) {
      return;
    }

    if (composeRoot.querySelector('.gmail-polish-rich-warning')) {
      return;
    }

    const warning = document.createElement('div');
    warning.className = 'gmail-polish-rich-warning';

    const text = document.createElement('span');
    text.className = 'gmail-polish-rich-warning-text';
    text.textContent = 'Note: formatting (bold, links, etc.) will be simplified to plain text';

    const controls = document.createElement('div');
    controls.className = 'gmail-polish-rich-warning-controls';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `gmail-polish-rich-warning-${Date.now()}`;

    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);
    label.textContent = "Don't show again";

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'gmail-polish-warning-dismiss';
    dismissBtn.textContent = 'Dismiss';

    dismissBtn.addEventListener('click', async () => {
      if (checkbox.checked) {
        await chrome.storage.local.set({ [RICH_TEXT_PREF_KEY]: true });
      }
      warning.remove();
    });

    controls.appendChild(checkbox);
    controls.appendChild(label);
    controls.appendChild(dismissBtn);
    warning.appendChild(text);
    warning.appendChild(controls);

    composeRoot.insertBefore(warning, composeRoot.firstChild);
  }

  function extractDraftText(body) {
    const clone = body.cloneNode(true);

    const signatureStageRemoved = removeBySelector(clone, '[data-smartmail="gmail_signature"]') > 0;

    const quoteSelectors = ['blockquote[type="cite"]', 'div.gmail_quote', 'blockquote'];
    for (const selector of quoteSelectors) {
      const removedCount = removeBySelector(clone, selector);
      if (removedCount > 0) {
        break;
      }
    }

    let text = normalizeText(clone.innerText || clone.textContent || '');

    if (!signatureStageRemoved) {
      text = stripPlainTextSignature(text);
    }

    return text.trim();
  }

  function removeBySelector(root, selector) {
    const nodes = root.querySelectorAll(selector);
    nodes.forEach((node) => node.remove());
    return nodes.length;
  }

  function normalizeText(value) {
    const withUnixLines = value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
    const trimmedLines = withUnixLines
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''));
    return trimmedLines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function stripPlainTextSignature(text) {
    const lines = text.split('\n');
    const delimiterIndex = lines.findIndex((line) => line.trim() === '--');

    if (delimiterIndex >= 0) {
      return lines.slice(0, delimiterIndex).join('\n');
    }

    return text;
  }

  function replaceComposeText(body, polishedText) {
    body.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(body);

    selection.removeAllRanges();
    selection.addRange(range);

    let usedExecCommand = false;

    try {
      usedExecCommand = document.execCommand('insertText', false, polishedText);
    } catch (_error) {
      usedExecCommand = false;
    }

    if (!usedExecCommand) {
      const beforeInputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: polishedText
      });
      body.dispatchEvent(beforeInputEvent);

      selection.removeAllRanges();
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(body);
      selection.addRange(fallbackRange);
      selection.deleteFromDocument();

      const textNode = document.createTextNode(polishedText);
      fallbackRange.insertNode(textNode);
      fallbackRange.setStartAfter(textNode);
      fallbackRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(fallbackRange);

      body.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: polishedText
        })
      );
    }

    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setUndoEntry(body, originalHtml) {
    const existing = undoEntries.get(body);
    if (existing?.timerId) {
      clearTimeout(existing.timerId);
    }

    const entry = {
      originalHtml,
      expiresAt: Date.now() + UNDO_DURATION_MS,
      dismissed: false,
      timerId: null,
      barElement: null
    };

    entry.timerId = window.setTimeout(() => {
      clearUndoEntry(body);
    }, UNDO_DURATION_MS);

    undoEntries.set(body, entry);
  }

  function showUndoBar(body) {
    const composeRoot = findComposeRoot(body);
    const entry = undoEntries.get(body);

    if (!composeRoot || !entry) {
      return;
    }

    if (entry.barElement && document.contains(entry.barElement)) {
      entry.barElement.remove();
    }

    const bar = document.createElement('div');
    bar.className = 'gmail-polish-undo-bar';

    const message = document.createElement('span');
    message.textContent = 'Polished draft applied.';

    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.className = 'gmail-polish-undo-button';
    undoButton.textContent = 'Undo';
    undoButton.addEventListener('click', () => {
      restoreOriginalDraft(body);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gmail-polish-undo-close';
    closeButton.textContent = 'Dismiss';
    closeButton.addEventListener('click', () => {
      clearUndoEntry(body, true);
    });

    bar.appendChild(message);
    bar.appendChild(undoButton);
    bar.appendChild(closeButton);

    composeRoot.insertBefore(bar, body);
    entry.barElement = bar;
  }

  function onComposeKeydown(event, body) {
    if (!isUndoShortcut(event)) {
      return;
    }

    const entry = undoEntries.get(body);
    if (!entry || entry.dismissed || Date.now() > entry.expiresAt) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    restoreOriginalDraft(body);
  }

  function isUndoShortcut(event) {
    const key = (event.key || '').toLowerCase();
    if (key !== 'z') {
      return false;
    }

    const hasModifier = event.ctrlKey || event.metaKey;
    return hasModifier && !event.shiftKey && !event.altKey;
  }

  function restoreOriginalDraft(body) {
    const entry = undoEntries.get(body);
    if (!entry || entry.dismissed || Date.now() > entry.expiresAt) {
      clearUndoEntry(body, true);
      return;
    }

    body.innerHTML = entry.originalHtml;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new Event('change', { bubbles: true }));

    clearUndoEntry(body, true);
  }

  function clearUndoEntry(body, dismissed = false) {
    const entry = undoEntries.get(body);
    if (!entry) {
      return;
    }

    if (entry.timerId) {
      clearTimeout(entry.timerId);
    }

    if (entry.barElement && document.contains(entry.barElement)) {
      entry.barElement.remove();
    }

    entry.dismissed = dismissed;
    undoEntries.delete(body);
  }

  function setLoadingState(body, isLoading) {
    const state = composeStates.get(body);
    const button = state?.button;

    if (button) {
      button.disabled = isLoading;
      button.textContent = isLoading ? POLISH_BUTTON_LOADING_TEXT : POLISH_BUTTON_TEXT;
      button.classList.toggle('gmail-polish-button-loading', isLoading);
    }

    body.classList.toggle('gmail-polish-processing', isLoading);
  }

  function showToast(body, message) {
    const composeRoot = findComposeRoot(body);
    if (!composeRoot) {
      return;
    }

    const existing = composeRoot.querySelector('.gmail-polish-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'gmail-polish-toast';
    toast.textContent = message;

    composeRoot.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 5000);
  }

  function onGlobalShortcut(event) {
    const key = (event.key || '').toLowerCase();
    const matches = key === 'p' && event.shiftKey && (event.ctrlKey || event.metaKey);
    if (!matches) {
      return;
    }

    const body = getFocusedComposeBody();
    if (!body) {
      return;
    }

    event.preventDefault();
    void polishComposeBody(body);
  }

  function getFocusedComposeBody() {
    const active = document.activeElement;
    if (active && active.matches?.(COMPOSE_SELECTOR) && isComposeBody(active)) {
      return active;
    }

    if (active?.closest) {
      const fromActive = active.closest(COMPOSE_SELECTOR);
      if (fromActive && isComposeBody(fromActive)) {
        return fromActive;
      }
    }

    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor && anchor.nodeType === Node.ELEMENT_NODE
      ? anchor
      : anchor?.parentElement;

    const fromSelection = anchorElement?.closest?.(COMPOSE_SELECTOR);
    if (fromSelection && isComposeBody(fromSelection)) {
      return fromSelection;
    }

    return null;
  }

  function sendRuntimeMessage(message) {
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

  function getSettings(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result || {});
      });
    });
  }

  const testApi = {
    COMPOSE_SELECTOR,
    RICH_TEXT_PREF_KEY,
    POLISH_BUTTON_TEXT,
    POLISH_BUTTON_LOADING_TEXT,
    UNDO_DURATION_MS,
    init,
    queueScan,
    scanComposeBodies,
    isComposeBody,
    ensureComposeState,
    ensurePolishButton,
    findToolbarContainer,
    findComposeRoot,
    polishComposeBody,
    containsRichFormatting,
    maybeShowRichTextWarning,
    extractDraftText,
    stripPlainTextSignature,
    replaceComposeText,
    setUndoEntry,
    showUndoBar,
    onComposeKeydown,
    isUndoShortcut,
    restoreOriginalDraft,
    clearUndoEntry,
    setLoadingState,
    showToast,
    onGlobalShortcut,
    getFocusedComposeBody,
    sendRuntimeMessage,
    getSettings,
    __internal: {
      composeStates,
      undoEntries
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = testApi;
  }
})();
