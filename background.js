// background.js
// This is the silent brain of the extension.
// It runs in the background even when the popup is closed.
//
// Its one job:
//   Receive text from popup.js, call the Claude API, return the summary
//
// Why here and not in popup.js?
//   Because Manifest V3 restricts where external API calls can be made.
//   background.js (the service worker) is the safe place for fetch() calls.
//
// It talks to popup.js using chrome.runtime.onMessage.addListener()
//test

// ─── LOAD API KEY FROM CONFIG ─────────────────────────────────────────────────
// Lazy-loaded to avoid top-level await, which breaks in Firefox classic-script
// mode (event pages on Firefox < 120).  Dynamic import() works in both module
// and classic contexts in all modern browsers.

let CONFIG = null

async function getConfig() {
  if (CONFIG) return CONFIG
  try {
    const mod = await import("./config.js")
    CONFIG = mod.default
  } catch {
    CONFIG = self.CONFIG
  }
  return CONFIG
}


// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// Receives a string of text, returns a plain-language summary string.
// Called when popup.js sends: { type: "GET_SUMMARY", text: "..." }

async function getSummary(text, userPrompt = "") {
  const config = await getConfig()

  const baseInstruction = userPrompt
    ? userPrompt
    : "Summarize the following in 3-5 plain simple sentences anyone can understand"

  const fullPrompt = `${baseInstruction}. Reply with plain text only, no markdown, no headings, no bullet points. Text to summarize: ${text}`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: fullPrompt }]
    })
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API ${response.status}: ${errBody}`)
  }

  const data = await response.json()
  return data.content?.[0]?.text ?? "No summary provided."
}

// ─── FORWARD SPEECH COMMANDS TO ACTIVE TAB ───────────────────────────────────
// Web Speech API is not available in service workers.
// Speech runs in content.js (page context). We forward commands there.

async function forwardToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) return
  chrome.tabs.sendMessage(tab.id, message)
}


// ─── LISTEN FOR MESSAGES FROM POPUP.JS AND CONTENT.JS ────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // AI SUMMARY REQUEST
  // Called when popup.js sends page or selection text
  if (message.type === "GET_SUMMARY") {
    getSummary(message.text, message.userPrompt)
      .then(summary => sendResponse({ summary }))
      .catch(err => {
        console.error("Claude error:", err)
        sendResponse({ summary: null, error: err.message })
      })
    return true  // keep channel open for async response
  }

  // SPEECH COMMANDS
  // Forward to content.js running in the active tab, which owns the Web Speech API
  if (message.type === "PLAY_SPEECH") {
    forwardToActiveTab({ type: "PLAY_SPEECH", text: message.text })
  }

  if (message.type === "PAUSE_SPEECH") {
    forwardToActiveTab({ type: "PAUSE_SPEECH" })
  }

  if (message.type === "STOP_SPEECH") {
    forwardToActiveTab({ type: "STOP_SPEECH" })
  }

  if (message.type === "SET_SPEED") {
    forwardToActiveTab({ type: "SET_SPEED", rate: message.rate })
  }

  return true
})
