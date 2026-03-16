// popup.js
// This file controls everything you see in the popup panel.
// Its three jobs:
//   1. Listen for button clicks from popup.html
//   2. Ask content.js for text from the current webpage
//   3. Send that text to background.js to get a summary from Claude
//   4. Pass the summary to the speak() function to read it aloud
//
// It CANNOT touch the webpage directly - only content.js can do that.
// It talks to background.js and content.js using chrome.runtime.sendMessage()


// ─── GRAB THE HTML ELEMENTS WE NEED TO CONTROL ───────────────────────────────
// These match the id="" values in popup.html

const btnSummarizePage  = document.getElementById("btn-summarize-page")
const btnReadSelection  = document.getElementById("btn-read-selection")
const userPrompt        = document.getElementById("user-prompt")
const btnPlayPause      = document.getElementById("btn-play-pause")   // replaces btnPause
const btnRewind         = document.getElementById("btn-rewind")        // replaces btnStop
const btnFastFwd        = document.getElementById("btn-fastfwd")       // new
const speedSlider       = document.getElementById("speed-slider")
const languageSelect    = document.getElementById("language-select")
const statusText        = document.getElementById("status-text")
const summaryBox        = document.getElementById("summary-box")
const summaryText       = document.getElementById("summary-text")
const summaryContainer  = document.getElementById("summary-container")
const toggleSummaryBtn  = document.getElementById("toggle-summary")

const SKIP_SECONDS = 10  // how many seconds to jump on rewind / fast-forward


// ─── TOGGLE SUMMARY TEXT ─────────────────────────────────────────────────────

toggleSummaryBtn.addEventListener("click", () => {
  summaryContainer.classList.toggle("hidden")

  toggleSummaryBtn.textContent =
    summaryContainer.classList.contains("hidden")
      ? "Show Summary"
      : "Hide Summary"
})


// ─── HELPER: UPDATE STATUS MESSAGE ───────────────────────────────────────────

function setStatus(message) {
  statusText.textContent = message
}

function showSummary(text) {
  summaryText.textContent = text
  summaryBox.hidden = false
}


// ─── HELPER: ENSURE CONTENT SCRIPT IS INJECTED ───────────────────────────────
// Tabs open before the extension loaded won't have content.js.
// Programmatically inject it so messaging doesn't fail.

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    })
  } catch {
    // Restricted page (chrome://, about:, etc.) — injection not possible
  }
}


// ─── PROMISE HELPER FUNCTIONS ─────────────────────────────────────────────────

const getPageText = (id) => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      id,
      { type: "GET_PAGE_TEXT" },
      (response) => { resolve(response.text) }
    )
  })
}

const getSelectedText = (id) => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      id,
      { type: "GET_SELECTED_TEXT" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
          return
        }
        if (!response) {
          reject("No response from content.js - is this a valid webpage?")
          return
        }
        console.log("got selection:" + response.text)
        resolve(response.text)
      }
    )
  })
}

const getSummaryFromBackground = (summaryText, userPrompt, mode) => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "GET_SUMMARY",
        text: summaryText,
        prompt: userPrompt,
        mode: mode,
        language: languageSelect.value
      },
      (response) => {
        console.log("got summary: " + response.summary)
        resolve(response.summary)
      }
    )
  })
}

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, "")        // remove headings #, ##, ###
    .replace(/\*\*(.*?)\*\*/g, "$1")   // remove bold **text**
    .replace(/\*(.*?)\*/g, "$1")       // remove italic *text*
    .replace(/^\s*[\d]+\.\s+/gm, "")  // remove numbered lists 1. 2. 3.
    .replace(/^\s*[-*+]\s+/gm, "")    // remove bullet points
    .replace(/`(.*?)`/g, "$1")        // remove inline code
    .replace(/\n{2,}/g, ". ")         // replace double newlines with pause
    .replace(/\n/g, " ")              // replace single newlines with space
    .trim()
}


// ─── BUTTON: SUMMARIZE FULL PAGE ─────────────────────────────────────────────

btnSummarizePage.addEventListener("click", async () => {
  setStatus("Reading page...")

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab || !tab.id) {
    setStatus("No active tab found.")
    return
  }

  try {
    await ensureContentScript(tab.id)

    const pageText = await getPageText(tab.id)

    if (!pageText || !pageText.trim()) {
      setStatus("No text found on this page.")
      return
    }

    console.log("PAGE TEXT:", pageText.substring(0, 200))
    setStatus("Summarizing with AI...")

    const summary = await getSummaryFromBackground(
      pageText,
      userPrompt.value.trim(),
      "page"
    )

    if (!summary) {
      setStatus("AI returned no summary.")
      return
    }

    const cleanSummary = stripMarkdown(summary)
    console.log("AI SUMMARY:", cleanSummary)
    summaryText.textContent = summary
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")

    // Reset play/pause button to playing state whenever new speech starts
    resetToPlayingState()

    chrome.runtime.sendMessage({
      type: "PLAY_SPEECH",
      text: cleanSummary
    })

  } catch (error) {
    console.error("Summarize page error:", error)
    setStatus("Something went wrong: " + error)
  }
})


// ─── BUTTON: READ MY SELECTION ────────────────────────────────────────────────

btnReadSelection.addEventListener("click", async () => {
  setStatus("Reading selection...")

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab || !tab.id) {
    setStatus("No active tab found.")
    return
  }

  try {
    await ensureContentScript(tab.id)

    const selectedText = await getSelectedText(tab.id)

    if (!selectedText || !selectedText.trim()) {
      setStatus("No text selected. Please highlight something first.")
      return
    }

    console.log("SELECTED TEXT:", selectedText)
    setStatus("Summarizing with AI...")

    const summary = await getSummaryFromBackground(
      selectedText,
      userPrompt.value.trim(),
      "selection"
    )

    if (!summary) {
      setStatus("AI returned no summary.")
      return
    }

    const cleanSummary = stripMarkdown(summary)
    console.log("AI SUMMARY:", summary)
    summaryText.textContent = summary
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")

    // Reset play/pause button to playing state whenever new speech starts
    resetToPlayingState()

    chrome.runtime.sendMessage({
      type: "PLAY_SPEECH",
      text: cleanSummary
    })

  } catch (error) {
    console.error("Read selection error:", error)
    setStatus("Something went wrong: " + error)
  }
})


// ─── BUTTON: PLAY / PAUSE ─────────────────────────────────────────────────────
// Toggles between pausing and resuming speech.
// Visual state is tracked via data-state attribute on the button.

let isPaused = false

function resetToPlayingState() {
  isPaused = false
  btnPlayPause.textContent = "Pause"
  btnPlayPause.dataset.state = "playing"
}

btnPlayPause.addEventListener("click", () => {
  isPaused = !isPaused

  if (isPaused) {
    btnPlayPause.textContent = "Play"
    btnPlayPause.dataset.state = "paused"
    setStatus("Paused.")
  } else {
    btnPlayPause.textContent = "Pause"
    btnPlayPause.dataset.state = "playing"
    setStatus("Resuming...")
  }

  chrome.runtime.sendMessage({ type: "PAUSE_SPEECH" })
})


// ─── BUTTON: REWIND 10 SECONDS ────────────────────────────────────────────────
// Tells background.js to jump back SKIP_SECONDS in the current speech.
// background.js handles the actual seek logic using char-position estimation.

btnRewind.addEventListener("click", () => {
  setStatus("Rewinding " + SKIP_SECONDS + "s...")
  // Make sure we're in a playing state after seeking
  isPaused = false
  btnPlayPause.textContent = "Pause"
  btnPlayPause.dataset.state = "playing"

  chrome.runtime.sendMessage({ type: "SEEK_SPEECH", offset: -SKIP_SECONDS })
})


// ─── BUTTON: FAST FORWARD 10 SECONDS ─────────────────────────────────────────
// Tells background.js to jump forward SKIP_SECONDS in the current speech.

btnFastFwd.addEventListener("click", () => {
  setStatus("Skipping " + SKIP_SECONDS + "s...")
  // Make sure we're in a playing state after seeking
  isPaused = false
  btnPlayPause.textContent = "Pause"
  btnPlayPause.dataset.state = "playing"

  chrome.runtime.sendMessage({ type: "SEEK_SPEECH", offset: +SKIP_SECONDS })
})


// ─── SLIDER: SPEED CONTROL ───────────────────────────────────────────────────
// When the user moves the slider, update the speech rate

speedSlider.addEventListener("input", () => {
  chrome.runtime.sendMessage({
    type: "SET_SPEED",
    rate: Number(speedSlider.value)
  })
})


// ─── TALKING TO OTHER FILES ───────────────────────────────────────────────────
// This is how popup.js sends messages to background.js or content.js
// You'll use this pattern a lot - study it carefully
//
// chrome.runtime.sendMessage(
//   { type: "GET_SUMMARY", text: "some text here" },
//   (response) => {
//     console.log(response.summary)
//   }
// )
//
// The other file receives this with chrome.runtime.onMessage.addListener()
// You'll see that pattern in background.js and content.js


console.log("popup loaded")
