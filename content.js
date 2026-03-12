console.log("CONTENT SCRIPT LOADED")
// content.js
// This file is injected into every webpage the user visits.
// It is the ONLY file that can directly touch and read webpage content.
//
// Its two jobs:
//   1. Grab text from the page when popup.js asks for it
//      - Either the full page text
//      - Or just the text the user has highlighted
//   2. (Optional) Inject a small floating tooltip near highlighted text
//      with a quick "Read this" button
//
// It cannot call the Claude API - only background.js can do that.
// It talks to popup.js using chrome.runtime.onMessage / sendMessage


// ─── MINI SUMMARY PANEL (injected onto the page) ────────────────────────────
// Creates or updates a small floating panel at the bottom-right of the viewport
// so the user can always see & re-read the summary even if the popup closes.

let summaryPanel = null

function showSummaryPanel(text) {
  if (!summaryPanel) {
    summaryPanel = document.createElement("div")
    summaryPanel.id = "accessai-summary-panel"

    // Fixed overlay styling
    Object.assign(summaryPanel.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      width: "340px",
      maxHeight: "260px",
      background: "#1a1a2e",
      color: "#e0e0e0",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: "13px",
      lineHeight: "1.6",
      borderRadius: "10px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      border: "1px solid #333"
    })

    // Header bar with title + close button
    const header = document.createElement("div")
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 12px",
      background: "#2d7ff9",
      color: "white",
      fontSize: "13px",
      fontWeight: "bold",
      flexShrink: "0"
    })
    header.textContent = "AccessAI Summary"

    const closeBtn = document.createElement("button")
    closeBtn.textContent = "X"
    Object.assign(closeBtn.style, {
      background: "transparent",
      border: "none",
      color: "white",
      fontSize: "14px",
      cursor: "pointer",
      padding: "0 2px",
      fontWeight: "bold"
    })
    closeBtn.addEventListener("click", () => {
      summaryPanel.remove()
      summaryPanel = null
    })
    header.appendChild(closeBtn)

    // Scrollable text body
    const body = document.createElement("div")
    body.id = "accessai-summary-body"
    Object.assign(body.style, {
      padding: "10px 12px",
      overflowY: "auto",
      flex: "1",
      whiteSpace: "pre-wrap"
    })

    summaryPanel.appendChild(header)
    summaryPanel.appendChild(body)
    document.documentElement.appendChild(summaryPanel)
  }

  // Update content
  const body = summaryPanel.querySelector("#accessai-summary-body")
  body.textContent = text
}

// ─── TEXT-TO-SPEECH SYSTEM ────────────────────────────────────────────────────
// Web Speech API is built into Chrome - no API key or install needed.
// This is the only context (page/content script) where it is available.

let currentRate = 1  // tracks speed set by slider; updated by SET_SPEED messages

// Voices load asynchronously — cache them once they're ready
let cachedVoices = []
function loadVoices() {
  cachedVoices = window.speechSynthesis.getVoices()
}
loadVoices()
window.speechSynthesis.addEventListener("voiceschanged", loadVoices)

function getBestVoice() {
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices()
  return (
    voices.find(v => v.lang.startsWith("en") && v.localService) ||
    voices.find(v => v.lang.startsWith("en")) ||
    voices[0] ||
    null
  )
}

function speak(text, rate = currentRate) {
  // Save text so SET_SPEED can restart speech if needed
  window._lastUtteranceText = text

  // Cancel anything already playing so we start fresh
  window.speechSynthesis.cancel()

  // Firefox ignores speak() called immediately after cancel().
  // A brief delay lets the engine reset before queuing new speech.
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate

    // Pick the most natural-sounding English voice available in the browser.
    // Prefer local (offline) voices first, then any English voice, then whatever is available.
    const voice = getBestVoice()
    if (voice) utterance.voice = voice

    utterance.onerror = (e) => console.error("Speech error:", e.error)

    window.speechSynthesis.speak(utterance)
  }, 50)
}

function pauseSpeech() {
  // Toggle: pause if speaking, resume if already paused
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume()
  } else if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause()
  }
}

function stopSpeech() {
  window.speechSynthesis.cancel()
}


// ─── LISTEN FOR MESSAGES FROM POPUP.JS / BACKGROUND.JS ───────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── REQUEST: GET FULL PAGE TEXT ──
  if (message.type === "GET_PAGE_TEXT") {
    const pageText = document.body.innerText.trim().slice(0, 15000)
    sendResponse({ text: pageText })
  }

  // ── REQUEST: GET SELECTED TEXT ──
  if (message.type === "GET_SELECTED_TEXT") {
    const selectedText = window.getSelection().toString()
    sendResponse({ text: selectedText })
  }

  // ── SPEECH COMMANDS (forwarded here from background.js) ──
  if (message.type === "PLAY_SPEECH") {
    showSummaryPanel(message.text)
    speak(message.text)
    sendResponse({ ok: true })
  }

  if (message.type === "PAUSE_SPEECH") {
    pauseSpeech()
    sendResponse({ ok: true })
  }

  if (message.type === "STOP_SPEECH") {
    stopSpeech()
    sendResponse({ ok: true })
  }

  if (message.type === "SET_SPEED") {
    currentRate = message.rate
    // If speech is active, restart it at the new speed
    if (window.speechSynthesis.speaking) {
      const remaining = window._lastUtteranceText
      if (remaining) speak(remaining, currentRate)
    }
    sendResponse({ ok: true })
  }

  return true
})


// FLOATING "READ THIS" BUTTON
// Appears when the user highlights text anywhere on a webpage.
// Allows the user to trigger the AI summary + speech pipeline
// without opening the extension popup.

// Stores reference to the currently visible floating button
let floatingButton = null

// Listen for when the user finishes highlighting text
document.addEventListener("mouseup", (event) => {

  console.log("Mouse released on page")

  // Prevent the tooltip logic from triggering when the user
  // clicks the floating button itself
  if (floatingButton && event.target === floatingButton) {
    return
  }

  // Get the text the user currently has selected
  const selectedText = window.getSelection().toString().trim()

  // If no text is selected, remove any existing button
  if (!selectedText) {
    if (floatingButton) {
      floatingButton.remove()
      floatingButton = null
    }
    return
  }

  // Determine where on the page the text selection is located
  // so we can position the button nearby
  const selection = window.getSelection()
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()

  // Remove any previous floating button before creating a new one
  if (floatingButton) {
    floatingButton.remove()
  }

  //CREATE THE FLOATING BUTTON 
  console.log("Floating button created")

  floatingButton = document.createElement("button")
  floatingButton.textContent = "🔊 Read this"

  // Position the button near the highlighted text
  floatingButton.style.position = "absolute"
  floatingButton.style.top = `${window.scrollY + rect.top - 40}px`
  floatingButton.style.left = `${window.scrollX + rect.left}px`
  floatingButton.style.zIndex = "9999"

  // Basic styling to match extension theme
  floatingButton.style.padding = "6px 10px"
  floatingButton.style.fontSize = "12px"
  floatingButton.style.borderRadius = "6px"
  floatingButton.style.border = "none"
  floatingButton.style.background = "#2d7ff9"
  floatingButton.style.color = "white"
  floatingButton.style.cursor = "pointer"

  // When clicked, send the selected text to the AI pipeline
  floatingButton.addEventListener("click", () => {

    console.log("Floating Read button clicked")
    console.log("Selected text:", selectedText)

    // Send highlighted text to background.js for AI summarization
    console.log("Sending text to background")

    chrome.runtime.sendMessage({
      type: "GET_SUMMARY",
      text: selectedText
    }, (aiResponse) => {

      // If AI fails or returns nothing, exit safely
      if (!aiResponse || !aiResponse.summary) return

      // Show summary panel on the page and read aloud
      showSummaryPanel(aiResponse.summary)
      speak(aiResponse.summary)

    })

    // Remove the floating button after it is used
    floatingButton.remove()
    floatingButton = null
  })

  // Add the button to the page
  // Using documentElement instead of body avoids conflicts
  // with certain website layouts or frameworks
  document.documentElement.appendChild(floatingButton)

})