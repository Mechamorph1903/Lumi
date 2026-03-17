// Prevent double-initialization when injected programmatically on a tab
// that already has the content script from the manifest.
if (!globalThis.__accessaiLoaded) {
  Object.defineProperty(globalThis, "__accessaiLoaded", {
    value: true,
    writable: false,
    configurable: false,
  })

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


// ─── TEXT-TO-SPEECH SYSTEM ────────────────────────────────────────────────────
// Web Speech API is built into Chrome - no API key or install needed.
// This is the only context (page/content script) where it is available.

let currentRate = 1    // tracks speed set by slider; updated by SET_SPEED messages
let lastUtteranceText = ""  // saved so SET_SPEED can restart at new rate
let speakTimer = null  // guards against rapid-fire speak() calls

// ─── SEEKABLE AUDIO PLAYER ENGINE ─────────────────────────────────────────────
// Spotify/YouTube-style: pre-loads all audio chunks, tracks total duration,
// supports seeking to any position, and reports progress back to the popup.

let audioElements = []       // Pre-loaded Audio objects for each chunk
let chunkDurations = []      // Duration (seconds) of each chunk
let totalDuration = 0        // Sum of all chunk durations
let currentChunkIndex = 0    // Which chunk is currently playing
let playerIsPlaying = false  // True when audio is actively playing
let playerIsPaused = false   // True when paused mid-playback
let progressInterval = null  // Timer that reports progress to popup

// Loads all audio chunk URLs, pre-loads them to get durations, wires up
// auto-advance so chunks play seamlessly one after another.
function loadAudioChunks(urls) {
  return new Promise((resolve, reject) => {
    // Clean up any previous playback
    destroyPlayer()

    let loadedCount = 0
    const total = urls.length

    urls.forEach((url, i) => {
      const audio = new Audio()
      audio.preload = "auto"

      audio.addEventListener("loadedmetadata", () => {
        chunkDurations[i] = audio.duration
        loadedCount++
        if (loadedCount === total) {
          totalDuration = chunkDurations.reduce((sum, d) => sum + d, 0)
          console.log(`Audio player: ${total} chunks loaded, total ${totalDuration.toFixed(1)}s`)
          resolve()
        }
      })

      audio.addEventListener("error", (e) => {
        console.error(`Audio chunk ${i} failed to load:`, e)
        chunkDurations[i] = 0
        loadedCount++
        if (loadedCount === total) {
          totalDuration = chunkDurations.reduce((sum, d) => sum + d, 0)
          resolve()
        }
      })

      audio.addEventListener("ended", () => {
        if (currentChunkIndex < audioElements.length - 1) {
          // Advance to next chunk
          currentChunkIndex++
          const next = audioElements[currentChunkIndex]
          next.currentTime = 0
          next.playbackRate = currentRate
          next.play()
        } else {
          // All chunks finished
          playerIsPlaying = false
          playerIsPaused = false
          stopProgressReporting()
          reportProgress()  // final update
        }
      })

      audio.src = url
      audioElements[i] = audio
    })

    if (total === 0) {
      resolve()
    }
  })
}

// Tears down the player completely
function destroyPlayer() {
  stopProgressReporting()
  audioElements.forEach(a => {
    a.pause()
    a.removeAttribute("src")
    a.load()  // release resources
  })
  audioElements = []
  chunkDurations = []
  totalDuration = 0
  currentChunkIndex = 0
  playerIsPlaying = false
  playerIsPaused = false
}

// Start playing from the current chunk/position
function playerPlay() {
  if (audioElements.length === 0) return
  const audio = audioElements[currentChunkIndex]
  audio.playbackRate = currentRate
  audio.play()
  playerIsPlaying = true
  playerIsPaused = false
  startProgressReporting()
}

// Pause at current position
function playerPause() {
  if (!playerIsPlaying) return
  const audio = audioElements[currentChunkIndex]
  audio.pause()
  playerIsPaused = true
  playerIsPlaying = false
  stopProgressReporting()
  reportProgress()
}

// Toggle pause/resume
function playerTogglePause() {
  if (playerIsPaused) {
    playerPlay()
  } else if (playerIsPlaying) {
    playerPause()
  }
}

// Stop and reset to beginning
function playerStop() {
  if (audioElements.length === 0) return
  audioElements[currentChunkIndex].pause()
  audioElements.forEach(a => { a.currentTime = 0 })
  currentChunkIndex = 0
  playerIsPlaying = false
  playerIsPaused = false
  stopProgressReporting()
  reportProgress()
}

// Get current playback position in seconds across all chunks
function getPlayerCurrentTime() {
  let elapsed = 0
  for (let i = 0; i < currentChunkIndex; i++) {
    elapsed += (chunkDurations[i] || 0)
  }
  if (audioElements[currentChunkIndex]) {
    elapsed += audioElements[currentChunkIndex].currentTime
  }
  return elapsed
}

// Seek to an absolute time (seconds) across all chunks
function playerSeekTo(time) {
  if (audioElements.length === 0 || totalDuration === 0) return

  // Clamp to valid range
  time = Math.max(0, Math.min(time, totalDuration - 0.01))

  const wasPlaying = playerIsPlaying

  // Pause current chunk
  if (audioElements[currentChunkIndex]) {
    audioElements[currentChunkIndex].pause()
  }

  // Find the target chunk and offset
  let accumulated = 0
  for (let i = 0; i < chunkDurations.length; i++) {
    if (accumulated + chunkDurations[i] > time || i === chunkDurations.length - 1) {
      currentChunkIndex = i
      audioElements[i].currentTime = time - accumulated
      audioElements[i].playbackRate = currentRate

      if (wasPlaying) {
        audioElements[i].play()
        playerIsPlaying = true
      }
      reportProgress()
      return
    }
    accumulated += chunkDurations[i]
  }
}

// Reports current playback state back to the popup/background
function reportProgress() {
  const state = {
    type: "PLAYBACK_PROGRESS",
    currentTime: getPlayerCurrentTime(),
    totalDuration: totalDuration,
    isPlaying: playerIsPlaying,
    isPaused: playerIsPaused,
    chunkIndex: currentChunkIndex,
    totalChunks: audioElements.length
  }
  chrome.runtime.sendMessage(state).catch(() => {
    // popup may be closed — ignore
  })
}

function startProgressReporting() {
  stopProgressReporting()
  progressInterval = setInterval(reportProgress, 250)
}

function stopProgressReporting() {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

// ─── LEGACY QUEUE COMPAT ──────────────────────────────────────────────────────
// Kept for the fallback browser-voice path which doesn't need seeking.
let currentAudio = null
let audioQueue = []

function playNextInQueue() {
  if (audioQueue.length === 0) {
    currentAudio = null
    return
  }
  const url = audioQueue.shift()
  currentAudio = new Audio(url)
  currentAudio.playbackRate = currentRate
  currentAudio.onerror = (e) => {
    console.error("Audio error:", e)
    playNextInQueue()
  }
  currentAudio.onended = () => {
    playNextInQueue()
  }
  currentAudio.play()
}

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
  lastUtteranceText = text

  // Cancel anything already playing so we start fresh
  window.speechSynthesis.cancel()

  // Clear any pending speak timeout to prevent stale utterances
  if (speakTimer) clearTimeout(speakTimer)

  // Firefox ignores speak() called immediately after cancel().
  // A brief delay lets the engine reset before queuing new speech.
  speakTimer = setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate

    const voice = getBestVoice()
    if (voice) utterance.voice = voice

    utterance.onerror = (e) => {
      console.error("Speech error type:", e.error)
      console.error("Speech error text length:", text.length)
      console.error("Speech error text preview:", text.substring(0, 100))
    }

    window.speechSynthesis.speak(utterance)
  }, 50)
}

function pauseSpeech() {
  // Seekable player takes priority
  if (audioElements.length > 0) {
    playerTogglePause()
    return
  }
  // Legacy fallback
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause()
    return
  }
  if (currentAudio && currentAudio.paused) {
    currentAudio.play()
    return
  }
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume()
  } else if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause()
  }
}

function stopSpeech() {
  // Seekable player
  if (audioElements.length > 0) {
    destroyPlayer()
  }
  // Legacy queue
  audioQueue = []
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  if (speakTimer) {
    clearTimeout(speakTimer)
    speakTimer = null
  }
  window.speechSynthesis.cancel()
}

const MAX_PAGE_TEXT_LENGTH = 50000

// ─── LISTEN FOR MESSAGES FROM POPUP.JS / BACKGROUND.JS ───────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── REQUEST: GET FULL PAGE TEXT ──
  if (message.type === "GET_PAGE_TEXT") {
    // grab all visible text from the page
    const clone = document.body.cloneNode(true)

    const noisy = [
      "nav", "header", "footer", "aside",
      "script", "style", "noscript",
      "[class*='nav']", "[class*='menu']",
      "[class*='footer']", "[class*='header']",
      "[class*='sidebar']", "[class*='cookie']",
      "[class*='banner']", "[class*='ad-']",
      "[id*='nav']", "[id*='footer']",
      "[id*='header']", "[id*='sidebar']"
    ]
    noisy.forEach(selector => {
      try {
        clone.querySelectorAll(selector).forEach(el => el.remove())
      } catch(e) {
        // some selectors might fail on certain pages, skip them silently
      }
    })
    const pageText = clone.innerText.trim().slice(0, MAX_PAGE_TEXT_LENGTH);
    sendResponse({ text: pageText });
  }

  // ── REQUEST: GET SELECTED TEXT ──
  if (message.type === "GET_SELECTED_TEXT") {
    const selected = window.getSelection().toString().trim();
    sendResponse({ text: selected });
  }

  // ── SEEKABLE AUDIO PLAYER (primary path from Polly) ──
  if (message.type === "PLAY_AUDIO_QUEUE") {
    stopSpeech()  // stop anything currently playing
    loadAudioChunks(message.urls).then(() => {
      playerPlay()
      sendResponse({ ok: true, totalDuration })
    }).catch(err => {
      console.error("Failed to load audio chunks:", err)
      sendResponse({ ok: false, error: err.message })
    })
    return true  // async response
  }

  if (message.type === "PLAY_AUDIO_URL") {
    stopSpeech()
    loadAudioChunks([message.url]).then(() => {
      playerPlay()
      sendResponse({ ok: true, totalDuration })
    }).catch(err => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  }

  // ── SEEK: jump to a specific time in seconds ──
  if (message.type === "SEEK_AUDIO") {
    playerSeekTo(message.time)
    sendResponse({ ok: true, currentTime: getPlayerCurrentTime() })
  }

  // ── GET_PLAYBACK_STATE: popup requests current state on open ──
  if (message.type === "GET_PLAYBACK_STATE") {
    sendResponse({
      currentTime: getPlayerCurrentTime(),
      totalDuration: totalDuration,
      isPlaying: playerIsPlaying,
      isPaused: playerIsPaused,
      chunkIndex: currentChunkIndex,
      totalChunks: audioElements.length
    })
  }

  //OLD COMMANDS (FALLBACK WHEN POLLY FAILS)
  if (message.type === "PLAY_SPEECH") {
    console.log("content.js received fallback PLAY_SPEECH, speaking:", message.text.substring(0, 50))
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

    // Seekable player: update the currently playing chunk's rate
    if (audioElements[currentChunkIndex]) {
      audioElements[currentChunkIndex].playbackRate = currentRate
    }

    // Legacy fallback
    if (currentAudio) {
      currentAudio.playbackRate = currentRate
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
      text: selectedText,
      prompt: '',
      mode: "selection"
    }, (aiResponse) => {

      // If AI fails or returns nothing, exit safely
      if (!aiResponse || !aiResponse.summary) return

      // Read the summary aloud
      chrome.runtime.sendMessage({
          type: "PLAY_SPEECH",
          text: aiResponse.summary,
          language: "en"  // floating button uses default language
        })
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

} // end guard: window._accessaiLoaded