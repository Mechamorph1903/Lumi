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
const userPrompt = document.getElementById("user-prompt")
<<<<<<< HEAD
const btnPause          = document.getElementById("btn-pause")
const btnStop           = document.getElementById("btn-stop")
const speedSlider       = document.getElementById("speed-slider")
const languageSelect = document.getElementById("language-select")
const statusText        = document.getElementById("status-text")
const summaryBox        = document.getElementById("summary-box")
const summaryText       = document.getElementById("summary-text")
=======
const btnPause = document.getElementById("btn-pause")
const btnStop = document.getElementById("btn-stop")
const speedSlider = document.getElementById("speed-slider")
const statusText = document.getElementById("status-text")
const summaryText = document.getElementById("summary-text")
const summaryContainer = document.getElementById("summary-container")
const toggleSummaryBtn = document.getElementById("toggle-summary")


//toggle go summary text
toggleSummaryBtn.addEventListener("click", () => {
  summaryContainer.classList.toggle("hidden")

  toggleSummaryBtn.textContent =
    summaryContainer.classList.contains("hidden")
      ? "Show Summary"
      : "Hide Summary"
})
>>>>>>> main


// ─── HELPER: UPDATE STATUS MESSAGE ───────────────────────────────────────────
// Call this whenever the state changes so the user knows what's happening

function setStatus(message) {
  statusText.textContent = message
}

function showSummary(text) {
  summaryText.textContent = text
  summaryBox.hidden = false
}


// ─── HELPER: ENSURE CONTENT SCRIPT IS INJECTED ─────────────────────────────
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
      {type: "GET_SUMMARY", text: summaryText, prompt: userPrompt, mode: mode},
      (response) => {
        console.log("got summary: " + response.summary);
        resolve(response.summary);
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

  try {
    await ensureContentScript(tab.id)

    const pageText = await getPageText(tab.id)

<<<<<<< HEAD
      console.log("PAGE TEXT:", response.text.substring(0, 200))
      setStatus("Summarizing with AI...")

      chrome.runtime.sendMessage(
        {
          type: "GET_SUMMARY",
          text: response.text,
          userPrompt: userPrompt.value.trim(),
          language: languageSelect.value
        },
        (aiResponse) => {

          if (chrome.runtime.lastError) {
            console.error("GET_SUMMARY error:", chrome.runtime.lastError.message)
            setStatus("AI request failed.")
            return
          }

          if (!aiResponse || !aiResponse.summary) {
            setStatus(aiResponse?.error || "AI returned no summary.")
            return
          }

          console.log("AI SUMMARY:", aiResponse.summary)

          // Show summary text in the popup
          showSummary(aiResponse.summary)

          // Status update for user
          setStatus("Reading summary...")

          // Trigger speech playback
          chrome.runtime.sendMessage({
            type: "PLAY_SPEECH",
            text: aiResponse.summary
          })
        }
      )
=======
    if (!pageText || !pageText.trim()) {
      setStatus("No text found on this page.")
      return
>>>>>>> main
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

    const cleanSummary = stripMarkdown(summary);
    console.log("AI SUMMARY:", cleanSummary)
    summaryText.textContent = summary;
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")

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
// When clicked:
//   1. Tell content.js to grab only the text the user has highlighted
//   2. Send that text to background.js to call Claude
//   3. Get the summary back
//   4. Pass the summary to speak()


//Flow is identical to Summarize Page,
//except content.js returns only highlighted text.
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

<<<<<<< HEAD
      console.log("SELECTED TEXT:", response.text)
      setStatus("Summarizing selection...")

      chrome.runtime.sendMessage(
        {
          type: "GET_SUMMARY",
          text: response.text,
          userPrompt: userPrompt.value.trim(),
          language: languageSelect.value
        },
        (aiResponse) => {

          if (chrome.runtime.lastError) {
            console.error("GET_SUMMARY error:", chrome.runtime.lastError.message)
            setStatus("AI request failed.")
            return
          }

          if (!aiResponse || !aiResponse.summary) {
            setStatus(aiResponse?.error || "AI returned no summary.")
            return
          }

          console.log("AI SUMMARY:", aiResponse.summary)

          // Show summary text in the popup
          showSummary(aiResponse.summary)

          setStatus("Reading selection summary...")

          // Trigger speech playback
          chrome.runtime.sendMessage({
            type: "PLAY_SPEECH",
            text: aiResponse.summary
          })
        }
      )
=======
    if (!selectedText || !selectedText.trim()) {
      setStatus("No text selected. Please highlight something first.")
      return
>>>>>>> main
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
    const cleanSummary = stripMarkdown(summary)
    summaryContainer.classList.remove("hidden")
    toggleSummaryBtn.textContent = "Hide Summary"
    setStatus("Reading summary...")

    chrome.runtime.sendMessage({
      type: "PLAY_SPEECH",
      text: cleanSummary
    })

  } catch (error) {
    console.error("Read selection error:", error)
    setStatus("Something went wrong: " + error)
  }

})


// ─── BUTTON: PAUSE / RESUME ───────────────────────────────────────────────────
// Sends PAUSE_SPEECH to background.js, which forwards to content.js.
// content.js toggles pause/resume based on current speechSynthesis state.

btnPause.addEventListener("click", () => {
  const isPaused = btnPause.textContent.trim() === "Resume"

  if (isPaused) {
    btnPause.textContent = "Pause"
    setStatus("Resuming...")
  } else {
    btnPause.textContent = "Resume"
    setStatus("Paused.")
  }

  chrome.runtime.sendMessage({ type: "PAUSE_SPEECH" })
})


// ─── BUTTON: STOP ────────────────────────────────────────────────────────────
// Stop reading entirely and reset


btnStop.addEventListener("click", () => {
  btnPause.textContent = "Pause"
  setStatus("Stopped.")

  chrome.runtime.sendMessage({ type: "STOP_SPEECH" })
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