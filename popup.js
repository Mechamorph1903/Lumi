// popup.js
// Its three jobs:
//   1. Listen for button clicks from popup.html
//   2. Ask content.js for text from the current webpage
//   3. Send that text to background.js to get a summary from Claude
//   4. Pass the summary to the speak() function to read it aloud
//
// It CANNOT touch the webpage directly - only content.js can do that.
// It talks to background.js and content.js using chrome.runtime.sendMessage()


// ─── GRAB THE HTML ELEMENTS WE NEED TO CONTROL ───────────────────────────────

const btnSummarizePage  = document.getElementById("btn-summarize-page")
const btnReadSelection  = document.getElementById("btn-read-selection")
const userPrompt        = document.getElementById("user-prompt")
const btnPlayPause      = document.getElementById("btn-play-pause")
const btnRewind         = document.getElementById("btn-rewind")
const btnFastFwd        = document.getElementById("btn-fastfwd")
const speedSlider       = document.getElementById("speed-slider")
const languageSelect    = document.getElementById("language-select")
const statusText        = document.getElementById("status-text")
const summaryText       = document.getElementById("summary-text")
const summaryContainer  = document.getElementById("summary-container")
const toggleSummaryBtn  = document.getElementById("toggle-summary")
const progressBar       = document.getElementById("progress-bar")
const timeCurrent       = document.getElementById("time-current")
const timeTotal         = document.getElementById("time-total")

//language last used
chrome.storage.local.get("lumiLanguage", (result) => {
  if (result.lumiLanguage) {
    languageSelect.value = result.lumiLanguage
  }
})

// save language whenever user changes it
languageSelect.addEventListener("change", () => {
  chrome.storage.local.set({ lumiLanguage: languageSelect.value })
})

//summary last used
chrome.storage.local.get("lumiSummary", (result) => {
  if (result.lumiSummary) {
    summaryText.textContent = result.lumiSummary
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
  }
})

//input last entered
chrome.storage.local.get("lumiInput", (result) => {
  if (result.lumiInput) {
    userPrompt.value = result.lumiInput
  }
})
// save Input whenever user changes it
userPrompt.addEventListener("focusout", () => {
  chrome.storage.local.set({ lumiInput: userPrompt.value })
})

const SKIP_SECONDS = 10  // how many seconds to jump on rewind / fast-forward


// ─── TIME FORMATTING HELPER ──────────────────────────────────────────────────

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m + ":" + String(sec).padStart(2, "0")
}


// ─── PROGRESS BAR ────────────────────────────────────────────────────────────
// Track whether the user is actively dragging the bar so we don't fight with
// incoming progress updates.

let isSeeking = false
let lastTotalDuration = 0

progressBar.addEventListener("mousedown", () => { isSeeking = true })
progressBar.addEventListener("touchstart", () => { isSeeking = true })

progressBar.addEventListener("change", () => {
  isSeeking = false
  if (lastTotalDuration <= 0) return
  const seekTime = (progressBar.value / 100) * lastTotalDuration
  chrome.runtime.sendMessage({ type: "SEEK_AUDIO", time: seekTime })
})

// Also update on input for real-time visual feedback while dragging
progressBar.addEventListener("input", () => {
  if (lastTotalDuration <= 0) return
  const previewTime = (progressBar.value / 100) * lastTotalDuration
  timeCurrent.textContent = formatTime(previewTime)
})


// ─── UPDATE UI FROM PLAYBACK STATE ──────────────────────────────────────────

function updatePlaybackUI(state) {
  if (!state) return
  lastTotalDuration = state.totalDuration || 0

  if (!isSeeking && lastTotalDuration > 0) {
    progressBar.value = (state.currentTime / lastTotalDuration) * 100
  }
  timeCurrent.textContent = formatTime(state.currentTime || 0)
  timeTotal.textContent   = formatTime(lastTotalDuration)

  if (state.isPlaying) {
    isPaused = false
    btnPlayPause.textContent = "⏸"
    btnPlayPause.dataset.state = "playing"
  } else if (state.isPaused) {
    isPaused = true
    btnPlayPause.textContent = "▶"
    btnPlayPause.dataset.state = "paused"
  }
}


// ─── LISTEN FOR PROGRESS BROADCASTS FROM CONTENT.JS ─────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PLAYBACK_PROGRESS") {
    updatePlaybackUI(message)
  }
})


// ─── SYNC STATE WHEN POPUP OPENS ─────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_PLAYBACK_STATE" }, (state) => {
  if (chrome.runtime.lastError) return
  updatePlaybackUI(state)
})


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
  summaryContainer.classList.remove("hidden")
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

    console.log("AI SUMMARY:", summary)
    summaryText.textContent = summary
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")
    chrome.storage.local.set({ lumiSummary: summary })


    // Reset play/pause button to playing state whenever new speech starts
    resetToPlayingState()

    chrome.runtime.sendMessage({
      type: "PLAY_SPEECH",
      text: summary,
      language: languageSelect.value
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

    console.log("AI SUMMARY:", summary)
    summaryText.textContent = summary
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")
    chrome.storage.local.set({ lumiSummary: summary })

    // Reset play/pause button to playing state whenever new speech starts
    resetToPlayingState()

    chrome.runtime.sendMessage({
      type: "PLAY_SPEECH",
      text: summary,
      language: languageSelect.value
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
  btnPlayPause.textContent = "⏸"
  btnPlayPause.dataset.state = "playing"
}

btnPlayPause.addEventListener("click", () => {
  isPaused = !isPaused

  if (isPaused) {
    btnPlayPause.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><title>Play-filled-alt SVG Icon</title><path fill="currentColor" d="M7 28a1 1 0 0 1-1-1V5a1 1 0 0 1 1.482-.876l20 11a1 1 0 0 1 0 1.752l-20 11A1 1 0 0 1 7 28"/></svg>`
    btnPlayPause.dataset.state = "paused"
    setStatus("Paused.")
  } else {
    btnPlayPause.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><title>Pause-filled SVG Icon</title><path fill="currentColor" d="M12 6h-2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m10 0h-2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2"/></svg>`
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
  chrome.runtime.sendMessage({ type: "GET_PLAYBACK_STATE" }, (state) => {
    const newTime = Math.max(0, (state?.currentTime || 0) - SKIP_SECONDS)
    chrome.runtime.sendMessage({ type: "SEEK_AUDIO", time: newTime })
  })
})


// ─── BUTTON: FAST FORWARD 10 SECONDS ─────────────────────────────────────────
// Tells background.js to jump forward SKIP_SECONDS in the current speech.

btnFastFwd.addEventListener("click", () => {
  setStatus("Skipping " + SKIP_SECONDS + "s...")
  chrome.runtime.sendMessage({ type: "GET_PLAYBACK_STATE" }, (state) => {
    const newTime = (state?.currentTime || 0) + SKIP_SECONDS
    chrome.runtime.sendMessage({ type: "SEEK_AUDIO", time: newTime })
  })
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
