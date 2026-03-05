# Gmail Polish — Chrome Extension

Build a Chrome MV3 extension that adds a "✨ Polish" button to Gmail's compose toolbar. When clicked, it sends the draft email to an OpenAI-compatible API, gets back a polished version, and replaces the draft in-place.

## Architecture

```
gmail-polish/
├── manifest.json          # MV3 manifest
├── content.js             # Content script: DOM injection + text extraction
├── background.js          # Service worker: OpenAI API calls
├── options.html           # Settings page
├── options.js
├── styles.css             # Button + overlay styling
├── icons/                 # Extension icons (generate simple SVG-based PNGs or use emoji-based canvas icons)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Critical Implementation Requirements

These are non-negotiable. Get these right or the extension is broken.

### 1. Text Replacement — Use execCommand/InputEvent, NOT innerHTML

Gmail tracks compose state internally. Directly writing innerHTML desyncss Gmail's draft autosave, undo stack, and send payload. The compose body might show polished text but Gmail sends the OLD draft.

**Required approach:**
- Select all text in the compose body programmatically (window.getSelection + Range)
- Use `document.execCommand('insertText', false, polishedText)` to replace — this triggers Gmail's internal change tracking
- If execCommand is deprecated/blocked, fall back to dispatching InputEvent with inputType 'insertText'
- After replacement, dispatch both 'input' and 'change' events with bubbles:true
- VERIFY: Gmail's draft autosave picks up the change (test by clicking away and reopening draft)

### 2. Quote/Signature Detection — Resilient Selectors

Do NOT rely solely on `.gmail_quote` or `.gmail_signature` class names (Google changes these).

**Use layered detection (try in order, first match wins):**
- `[data-smartmail="gmail_signature"]` attribute (most stable)
- `blockquote[type="cite"]` elements
- `div.gmail_quote` (fallback)
- `-- ` text delimiter for signatures (plain text fallback)
- Any `<blockquote>` element as last resort for quotes

**Extraction strategy:**
- Clone the compose body
- Remove ALL detected quote/signature elements
- Extract remaining text (this is the user's draft)

### 3. Rich Text Handling

MVP approach: Extract as plain text, send to API, replace as plain text. But WARN the user:
- Before polishing, check if the compose body contains any formatting: `<b>`, `<i>`, `<a>`, `<ul>`, `<ol>`, `<img>`, inline styles
- If rich formatting is detected, show a brief warning: "Note: formatting (bold, links, etc.) will be simplified to plain text"
- This warning should be dismissible and have a "Don't show again" option (stored in chrome.storage.local)

### 4. Undo Support

- Store original innerHTML in a WeakMap keyed by compose body element
- Show an undo bar above the compose body after polishing
- Undo bar stays for **30 seconds** (not 10)
- Also support Ctrl+Z / Cmd+Z: add a keydown listener on the compose body that restores original if undo data exists (and hasn't been dismissed)
- Undo restores innerHTML AND dispatches input event to sync Gmail state

### 5. Loading State & Error Handling

- Button shows "⏳ Polishing..." during API call
- Compose body gets opacity: 0.6 and pointer-events: none
- Button is disabled (pointer-events: none) during processing
- **15 second timeout** — if API doesn't respond, cancel and show error
- Error toast appears at bottom-right of the compose window
- Toast auto-dismisses after 5 seconds
- If API key is not configured, clicking Polish opens the options page

### 6. CSP Compatibility

- Gmail has strict Content Security Policy
- Content scripts bypass page CSP for their own execution
- BUT: do NOT use inline event handlers (onclick="...") — they'll be blocked
- Use addEventListener exclusively
- All UI elements created via DOM API, no innerHTML with event handlers

## Manifest

```json
{
  "manifest_version": 3,
  "name": "Gmail Polish",
  "version": "1.0.0",
  "description": "One-click email polishing with AI",
  "permissions": ["storage"],
  "host_permissions": [
    "https://mail.google.com/*",
    "https://api.openai.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://mail.google.com/*"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

## Service Worker (background.js)

Handle the API call. System prompt:

```
You are an email writing assistant. Your job is to polish and improve emails while preserving the sender's intent, meaning, and voice.

Rules:
- Fix grammar, spelling, and punctuation
- Improve clarity and professional tone
- Keep the same level of formality the sender intended (don't make casual emails overly formal)
- Preserve all names, addresses, numbers, dates, and specific details EXACTLY
- Keep the email concise — don't add unnecessary fluff
- Maintain the original structure (greeting, body, sign-off)
- Return ONLY the polished email text, no explanations or commentary
- Do not add a subject line
- Do not add a signature (it's handled separately)
```

- Default model: `gpt-4.1`
- Default API URL: `https://api.openai.com/v1/chat/completions`
- Temperature: 0.3
- Max tokens: 2048
- Support custom instructions from options

## Options Page

Clean, simple settings:
- Provider dropdown: "OpenAI API" or "Local Server"
- API URL field (auto-fills based on provider selection)
- API Key field (password type)
- Model field
- Custom Instructions textarea
- Save button with status feedback
- "Test Connection" button that sends a simple test prompt

## Styling

- Button: blue pill (#1a73e8), white text, 36px height, fits Gmail's toolbar aesthetic
- Hover: darker blue (#1557b0)
- Loading: gray (#5f6368)
- Undo bar: dark gray (#323232), white text, rounded corners
- Toast: similar dark style, positioned at bottom of compose window
- Should look native to Gmail, not like an add-on

## Icons

Generate simple extension icons. Can use a canvas-based generator script, or create simple SVG-to-PNG icons. A sparkle ✨ or magic wand theme. Generate icon16.png, icon48.png, and icon128.png.

## README

Include:
- What it does (1 paragraph)
- Installation steps (load unpacked in Chrome/Shift)
- Configuration (API key setup)
- Usage (click Polish in compose)
- Keyboard shortcut (Ctrl+Shift+P)

## Keyboard Shortcut

Register Ctrl+Shift+P (Cmd+Shift+P on Mac) via a keydown listener in the content script. When pressed while a compose window is focused, trigger polish on that compose body.

## What NOT to build

- No Chrome Web Store publishing
- No analytics/telemetry
- No inbox reading/scanning
- No auto-trigger (user must click)
- No server component
