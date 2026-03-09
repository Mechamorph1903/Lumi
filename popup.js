// popup.js
// This file controls everything you see in the popup panel. test
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

const btnSummarizePage = document.getElementById("btn-summarize-page")
const btnReadSelection  = document.getElementById("btn-read-selection")
const btnPause          = document.getElementById("btn-pause")
const btnStop           = document.getElementById("btn-stop")
const speedSlider       = document.getElementById("speed-slider")
const statusText        = document.getElementById("status-text")


// ─── HELPER: UPDATE STATUS MESSAGE ───────────────────────────────────────────
// Call this whenever the state changes so the user knows what's happening

function setStatus(message) {
    statusText.textContent = message
  // TODO: update statusText.textContent with the message
  // Example states to handle: "Ready", "Thinking...", "Reading...", "Done", "Error"
}


// ─── BUTTON: SUMMARIZE FULL PAGE ─────────────────────────────────────────────
// When clicked:
//   1. Tell content.js to grab all the text on the current page
//   2. Send that text to background.js to call Claude
//   3. Get the summary back
//   4. Pass the summary to speak()

btnSummarizePage.addEventListener("click", async () => {
  setStatus("Reading page...")

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab || !tab.id) {
    setStatus("No active tab found.")
    return
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: "GET_PAGE_TEXT" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("GET_PAGE_TEXT error:", chrome.runtime.lastError.message)
        setStatus("Cannot read this page.")
        return
      }

      if (!response || !response.text) {
        setStatus("No page text found.")
        return
      }

      console.log("PAGE TEXT:", response.text.substring(0, 200))
      setStatus("Page text captured. Ready for summary.")
    }
  )
})


// ─── BUTTON: READ MY SELECTION ────────────────────────────────────────────────
// When clicked:
//   1. Tell content.js to grab only the text the user has highlighted
//   2. Send that text to background.js to call Claude
//   3. Get the summary back
//   4. Pass the summary to speak()

btnReadSelection.addEventListener("click", async () => {
  setStatus("Reading selection...")

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab || !tab.id) {
    setStatus("No active tab found.")
    return
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: "GET_SELECTED_TEXT" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("GET_SELECTED_TEXT error:", chrome.runtime.lastError.message)
        setStatus("Cannot read this page.")
        return
      }

      if (!response || !response.text || !response.text.trim()) {
        setStatus("No text selected.")
        return
      }

      console.log("SELECTED TEXT:", response.text)
      setStatus("Selection captured.")
    }
  )
})


// ─── BUTTON: PAUSE / RESUME ───────────────────────────────────────────────────
// Toggle between pausing and resuming the speech

btnPause.addEventListener("click", () => {
  // TODO
})


// ─── BUTTON: STOP ────────────────────────────────────────────────────────────
// Stop reading entirely and reset

btnStop.addEventListener("click", () => {
  // TODO
})


// ─── SLIDER: SPEED CONTROL ───────────────────────────────────────────────────
// When the user moves the slider, update the speech rate

speedSlider.addEventListener("input", () => {
  // TODO: pass speedSlider.value to the speak() function
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
