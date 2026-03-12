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
// Static import — works reliably in both Chrome and Firefox module service workers.
// config.js is gitignored; each team member creates their own copy locally.
import CONFIG from "./config.js"

if (!CONFIG || !CONFIG.apiKey) {
  console.error("API key not found. Make sure config.js exists with your apiKey.")
}


// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// Receives a string of text, returns a plain-language summary string.
// Called when popup.js sends: { type: "GET_SUMMARY", text: "..." }

async function getSummary(text, userPrompt = "") {
  if (!CONFIG || !CONFIG.apiKey) {
    throw new Error("Missing API key. Create config.js with your Anthropic key.")
  }

  const baseInstruction = userPrompt
    ? userPrompt
    : "Summarize the following in 3-5 plain simple sentences anyone can understand"

  const fullPrompt = `${baseInstruction}. Reply with plain text only, no markdown, no headings, no bullet points. Text to summarize: ${text}`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CONFIG.apiKey,
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
    let detail = ""
    try {
      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        const json = await response.json()
        const msg =
          (json && typeof json === "object" && (json.error?.message || json.message)) ||
          JSON.stringify(json)
        detail = typeof msg === "string" ? msg : String(msg)
      } else {
        detail = await response.text()
      }
    } catch (e) {
      // Fall back to status text if body parsing fails
      detail = response.statusText || ""
    }

    // Strip basic HTML tags to avoid surfacing raw markup
    if (detail) {
      detail = detail.replace(/<[^>]*>/g, "")
      const maxLen = 300
      if (detail.length > maxLen) {
        detail = detail.slice(0, maxLen) + "..."
      }
    }

    throw new Error(`API ${response.status}: ${detail || "Unknown error"}`)
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
