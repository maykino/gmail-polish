# Gmail Polish

Gmail Polish is a Chrome MV3 extension that adds a `✨ Polish` button to Gmail's compose toolbar. It sends your current draft text to an OpenAI-compatible API, returns a polished version, and replaces the draft in-place while preserving Gmail draft state tracking, with undo support and error handling.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select this folder: `gmail-polish`.

## Configuration

1. Open the extension options page:
   `chrome://extensions` -> Gmail Polish -> **Details** -> **Extension options**.
2. Choose a provider:
   - **OpenAI API** (default)
   - **Local Server** (OpenAI-compatible endpoint)
3. Set `API URL`, `API Key` (if needed), and `Model`.
4. Optional: add custom instructions.
5. Click **Save**.
6. Optional: click **Test Connection**.

## Usage

1. Open Gmail and start a compose draft.
2. Click `✨ Polish` in the compose toolbar.
3. The button changes to `⏳ Polishing...` while processing.
4. The polished plain-text draft replaces the original.
5. Use the undo bar (available for 30 seconds) if needed.

## Keyboard Shortcut

- **Windows/Linux:** `Ctrl+Shift+P`
- **macOS:** `Cmd+Shift+P`

The shortcut triggers polishing for the currently focused compose window.

## Notes

- Rich text formatting is simplified to plain text during polish.
- Gmail quote/signature content is excluded from the text sent to the API.
- If the API key is missing for OpenAI provider, clicking Polish opens the options page.
