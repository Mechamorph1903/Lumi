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
// config.js is gitignored - each team member has their own copy locally
// Never paste your actual API key anywhere else in the code

// TODO: import or reference CONFIG from config.js
// const API_KEY = CONFIG.apiKey


// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// This is the function the whole backend role is about.
// Receives a string of text, returns a plain-language summary string.

async function getSummary(text) {
  // TODO:
  // 1. Build the request body with the correct Claude API structure
  // 2. Call fetch("https://api.anthropic.com/v1/messages", { ... })
  // 3. Parse the response
  // 4. Return just the summary text string
  //
  // The prompt to send Claude:
  // "Summarize the following webpage content in 3-5 plain, simple sentences
  //  that anyone can understand: " + text
  //
  // Required headers:
  //   "x-api-key": API_KEY
  //   "anthropic-version": "2023-06-01"
  //   "content-type": "application/json"
  //
  // Model to use: "claude-haiku-4-5-20251001"
}


// ─── THE SPEAK FUNCTION: READ TEXT ALOUD ─────────────────────────────────────
// Uses the browser's built-in Web Speech API - no API key needed.
// Receives a summary string and reads it aloud with controls.

function speak(text, rate = 1) {
  // TODO:
  // 1. Cancel any speech already playing
  // 2. Create a new SpeechSynthesisUtterance with the text
  // 3. Set the rate (speed) from the slider value
  // 4. Pick the most natural sounding available voice
  // 5. Call window.speechSynthesis.speak()
}

function pauseSpeech() {
  // TODO: window.speechSynthesis.pause()
}

function stopSpeech() {
  // TODO: window.speechSynthesis.cancel()
}


// ─── LISTEN FOR MESSAGES FROM POPUP.JS ───────────────────────────────────────
// popup.js sends a message with the text it wants summarized
// This listener receives it, calls getSummary(), and sends the result back

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_SUMMARY") {
    // TODO:
    // 1. Call getSummary(message.text)
    // 2. Send the result back with sendResponse({ summary: result })
    // Hint: getSummary is async so you'll need to handle the promise correctly
  }

  // IMPORTANT: return true to keep the message channel open for async response
  return true
})
