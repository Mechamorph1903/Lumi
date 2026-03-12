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

const btnSummarizePage  = document.getElementById("btn-summarize-page")
const btnReadSelection  = document.getElementById("btn-read-selection")
const userPrompt        = document.getElementById("user-prompt")
const btnPause          = document.getElementById("btn-pause")
const btnStop           = document.getElementById("btn-stop")
const speedSlider       = document.getElementById("speed-slider")
const statusText        = document.getElementById("status-text")
const summaryBox        = document.getElementById("summary-box")


// ─── HELPER: UPDATE STATUS MESSAGE ───────────────────────────────────────────
// Call this whenever the state changes so the user knows what's happening

function setStatus(message) {
  statusText.textContent =  message;
  return
}

//Promise Helper Functions
const getPageText = (id) => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      id,
      {type: "GET_PAGE_TEXT"},
      (response) => {
        resolve(response.text);
      }
    )
  })
}
const getSelectedText = (id) => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      id,
      {type: "GET_SELECTED_TEXT"},
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
          return
        }
        if (!response) {
          reject("No response from content.js - is this a valid webpage?")
          return
        }
        console.log("got selection:" + response.text);
        resolve(response.text);
      }
    )
  })
}
const getSummaryFromBackground = (summaryText, userPrompt, mode) => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {type: "GET_SUMMARY", text: summaryText, prompt: userPrompt},
      (response) => {
        console.log("got summary: " + response.summary);
        resolve(response.summary);
      }
    )
  })
}



// ─── BUTTON: SUMMARIZE FULL PAGE ─────────────────────────────────────────────
// When clicked:
//   1. Tell content.js to grab all the text on the current page
//   2. Send that text to background.js to call Claude
//   3. Get the summary back
//   4. Pass the summary to speak()

btnSummarizePage.addEventListener("click", async () => {
  // TODO
  setStatus("Reading...")
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const pageText = await getPageText(tab.id);
  const summary = await getSummaryFromBackground(pageText, userPrompt, "page");
  console.log(summary)
  setStatus("Summary Ready.")
  // setTimeout(setStatus("Reading..."), 2000);
  // speak(summary);
  // summaryBox.textContent = summary;
  


})


// ─── BUTTON: READ MY SELECTION ────────────────────────────────────────────────
// When clicked:
//   1. Tell content.js to grab only the text the user has highlighted
//   2. Send that text to background.js to call Claude
//   3. Get the summary back
//   4. Pass the summary to speak()


//Flow is identical to Summarize Page,
//except content.js returns only highlighted text.
btnReadSelection.addEventListener("click", async () => {
  // TODO
  setStatus("Reading...")
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const pageText = await getSelectedText(tab.id);
  const summary = await getSummaryFromBackground(pageText, userPrompt, "selection");
  setStatus("Summary Ready.")
  // setTimeout(setStatus("Reading..."), 2000);
  // speak(summary);
  // summaryBox.textContent = summary;
})


// ─── BUTTON: PAUSE / RESUME ───────────────────────────────────────────────────
// Toggle between pausing and resuming the speech

// SPEECH CONTROLS
//
// popup.js does NOT implement speech itself.
// It simply sends commands to background.js.


// This button currently sends PAUSE_SPEECH only.
// If resume  is added later, this logic will need to be
// updated to toggle between pause and resume based on speech state.
//background.js handles speech playback
btnPause.addEventListener("click", () => {
  setStatus("Speech paused.")

  chrome.runtime.sendMessage({
    type: "PAUSE_SPEECH"
  })
})


// ─── BUTTON: STOP ────────────────────────────────────────────────────────────
// Stop reading entirely and reset


btnStop.addEventListener("click", () => {
  setStatus("Speech stopped.")

  chrome.runtime.sendMessage({
    type: "STOP_SPEECH"
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


//test
console.log("popup loaded")