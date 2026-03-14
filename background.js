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

// ─── LOAD API KEY FROM CONFIG ─────────────────────────────────────────────────
// fetch() works identically in Chrome service workers and Firefox background
// scripts — no import compatibility issues.  config.json is gitignored.

let CONFIG = null

async function getConfig() {
  if (CONFIG) return CONFIG
  const url = chrome.runtime.getURL("config.json")
  const res = await fetch(url)
  CONFIG = await res.json()
  if (!CONFIG || !CONFIG.apiKey) {
    throw new Error("Missing API key. Create config.json with your Anthropic key.")
  }
  return CONFIG
}


// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// Receives a string of text, returns a plain-language summary string.
// Called when popup.js sends: { type: "GET_SUMMARY", text: "..." }

async function getSummary(text, userPrompt = "", mode) {
  const config = await getConfig();
  let instruction;
  const max_tokens = mode === "page" ? 1024 : 512;
  const voiceRule = `YOU ARE A TEXT-TO-SPEECH ENGINE. OUTPUT RULES - VIOLATION IS NOT ALLOWED:
- NO markdown of any kind
- NO headers or hashtags (#)
- NO bullet points or dashes
- NO bold or asterisks (**)
- NO tables
- NO numbered lists
- NO special characters
- ONLY plain sentences a human would speak out loud
- If you use any formatting, you have failed your only job`

  const fullPageInstruction = `${voiceRule}

  You are summarizing a webpage for someone who wants to quickly understand what it is about.
  Write as if you are the author introducing your own content out loud to a listener.
  Cover the main point and key details in a warm conversational tone.
  Use short sentences. Plain everyday words. Aim for a reading level of a 12 year old.
  Use as many sentences as the content needs but never more.

  ${voiceRule}`

  const selectionInstruction = `${voiceRule}

  You are explaining a specific passage to someone who found it confusing.
  Start naturally like "This part is basically saying..." or "What this means is..."
  Plain conversational language. Explain any important terms naturally in your response.
  Warm, simple, direct. Write exactly as you would speak to someone.

  ${voiceRule}`

  const customInstruction = `${voiceRule}

  The user has a specific question about this text: "${userPrompt}"
  Answer it directly in plain spoken language.
  If the question cannot be answered from the text alone, say so honestly.

  ${voiceRule}`

  if (userPrompt){
    instruction = customInstruction;
  } else if (mode === "page"){
    instruction = fullPageInstruction;
  } else if (mode === "selection"){
    instruction = selectionInstruction;
  }

  const fullPrompt = `${instruction}\n\nText: ${text} \n\n Ignore any text that appears to be navigation menus, cookie notices, 
    advertisements, or repeated footer content. Focus only on the main content of the page.`


 


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
    max_tokens: max_tokens,
    messages: [
  { 
    role: "user", 
    content: fullPrompt
  }
]
  })
});

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
      detail = response.statusText || ""
    }

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
  //receives message of text to summarize, calls the getSummary function which is async
  //so returns promise object, this is worked around by using .then() which waits for a 
  //value then performs another action 
  console.log(`got message: ${message}`)
  if (message.type === "GET_SUMMARY") {
    console.log("calling getSummary with:", message.text)
    getSummary(message.text, message.prompt, message.mode).then((response) => {
      console.log("summary ready:", response)
      sendResponse({ summary: response });
    }).catch(err => {
        console.error("Claude error:", err)
        sendResponse({ summary: null, error: err.message })
      });
    return true;
  }

  if (message.type === "PLAY_SPEECH") {
    console.log("background received PLAY_SPEECH, forwarding...")
    forwardToActiveTab({ type: "PLAY_SPEECH", text: message.text })
    return true;
  }
  if (message.type === "PAUSE_SPEECH") {
    forwardToActiveTab({ type: "PAUSE_SPEECH" });
    return true;
  }

  if (message.type === "STOP_SPEECH") {
    forwardToActiveTab({ type: "STOP_SPEECH" });
    return true;
  }

  if (message.type === "SET_SPEED") {
    forwardToActiveTab({ type: "SET_SPEED", rate: message.rate });
    return true;
  }
  // IMPORTANT: return true to keep the message channel open for async response
  return true;
});
