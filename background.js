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
  const config = await getConfig()
  let instruction;

  const max_tokens = mode === "page" ? 1024 : 512
  const fullPageInstruction = `You are summarizing a webpage for someone who wants to quickly understand what it's about before reading it. 
    Write as if you are the author introducing your own content in a natural, conversational tone. 
    Cover the main point, the key details, and what the reader will gain from reading further.
    Use short sentences. Plain everyday language. No jargon. No bullet points. No markdown.
    Make it feel like a human wrote it, not a machine. Aim for a reading level of a 12 year old. Simple words always beat complex ones.
If you can say it in 5 words instead of 10, use 5. Use as many sentences as the content needs, but never more. 
Cut anything that isn't essential. Every sentence should earn its place.`;

  const selectionInstruction = `You are helping someone understand a specific piece of text they found confusing or interesting.
    Explain what this passage means in plain everyday language, like a knowledgeable friend explaining it casually.
    Start your response with a natural phrase like "This part is basically saying..." or "What this means is..." 
    Keep it conversational, warm, and simple. No bullet points. No markdown. No jargon.
    If there are important terms, explain them naturally within your response.`;

  const customInstruction = `The user has a specific question or request about this text: "${userPrompt}"
    Answer it in plain everyday language. Be direct and helpful. 
    No bullet points. No markdown. Short clear sentences.
    If the question can't be answered from the text alone, say so honestly.`;

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
    getSummary(message.text, message.prompt).then((response) => {
      console.log("summary ready:", response)
      sendResponse({ summary: response });
    }).catch(err => {
        console.error("Claude error:", err)
        sendResponse({ summary: null, error: err.message })
      });
  }
  // IMPORTANT: return true to keep the message channel open for async response
  return true;
});
