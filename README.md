# AccessAI — AI-Powered Screen Reader

An AI-powered browser extension that summarizes webpage content and reads it aloud. Built for the Honeywell Hackathon at NSBE 26.

---

## What It Does

AccessAI is a browser extension (Chrome + Firefox) that makes web content more accessible by:

- **Summarizing full pages** — extracts all visible text and generates a concise 3–5 sentence summary using Claude AI
- **Summarizing selections** — highlight any text on a page and summarize just that
- **Floating "Read This" button** — appears automatically when you highlight text for quick one-click access
- **Text-to-speech playback** — reads summaries aloud with pause, stop, and speed controls

---

## Prerequisites

- Google Chrome or Mozilla Firefox
- An [Anthropic API key](https://console.anthropic.com/)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Mechamorph1903/humane-glmg.git
cd humane-glmg
```

### 2. Create your config file

Create a file named `config.js` in the project root with your Anthropic API key:

```js
const CONFIG = {
  apiKey: "sk-ant-your-api-key-here"
};
export default CONFIG;
```

> **Note:** `config.js` is gitignored and must be created manually. Never commit your API key.

### 3. Load the extension

**Chrome:**
1. Open `chrome://extensions/`
2. Toggle on **Developer mode** (top-right corner)
3. Click **Load unpacked**
4. Select the `humane-glmg` project folder

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` from the project folder

---

## Usage

### Summarize a full page

1. Navigate to any webpage
2. Click the AccessAI extension icon in your toolbar
3. Click **Summarize Page**
4. The extension will read a summary of the entire page aloud

### Summarize a selection

1. Highlight any text on a webpage
2. Either:
   - Click the floating **Read This** button that appears near your selection, or
   - Open the extension popup and click **Read My Selection**
3. A summary of the selected text will be read aloud

### Playback controls

Use the controls in the extension popup to:

| Control | Action |
|---------|--------|
| Pause / Resume | Pause or continue speech |
| Stop | Stop playback entirely |
| Speed slider | Adjust reading speed |

---

## Project Structure

```
humane-glmg/
├── manifest.json     # Extension config (Manifest V3, Chrome + Firefox)
├── background.js     # Service worker — calls Claude API, forwards speech commands
├── content.js        # Injected into pages — extracts text, runs TTS, floating button
├── popup.html        # Extension popup UI
├── popup.js          # Popup event handlers and message coordination
├── popup.css         # Dark-theme styling
└── config.js         # (you create this) API key — gitignored
```

---

## How It Works

1. User triggers an action in the popup or via the floating button
2. `popup.js` sends a message to `content.js` to extract page or selection text
3. `popup.js` forwards the text to `background.js`
4. `background.js` calls the Anthropic Claude API (`claude-haiku-4-5-20251001`) to generate a summary
5. `background.js` forwards the summary to `content.js`
6. `content.js` reads it aloud using the browser's Web Speech API (service workers can't access `speechSynthesis`)

---

## Permissions

The extension requires the following permissions:

| Permission | Reason |
|------------|--------|
| `activeTab` | Access text content of the current tab |
| `scripting` | Inject content scripts into pages |
| `storage` | Store local settings |

---

## Tech Stack

- Vanilla JavaScript (no build step required)
- Extensions Manifest V3 (Chrome + Firefox)
- Anthropic Claude API (`claude-haiku-4-5-20251001`)
- Web Speech API (browser-native text-to-speech)
