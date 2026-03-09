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


// ─── LISTEN FOR MESSAGES FROM POPUP.JS ───────────────────────────────────────
// popup.js will send a message asking for text
// This listener waits for that message and sends back what was asked for
//test
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── REQUEST: GET FULL PAGE TEXT ──
  if (message.type === "GET_PAGE_TEXT") {
    // TODO: grab all visible text from the page
    // Hint: document.body.innerText gives you everything
    // Tip: trim it and maybe limit the length so Claude isn't overwhelmed
    const pageText = document.body.innerText // replace this
    sendResponse({ text: pageText })
  }

  // ── REQUEST: GET SELECTED TEXT ──
  if (message.type === "GET_SELECTED_TEXT") {
    // TODO: grab only what the user has highlighted
    // Hint: window.getSelection().toString() is all you need
    const selectedText = window.getSelection().toString() // replace this
    sendResponse({ text: selectedText })
  }

  // IMPORTANT: return true here to tell Chrome this is async
  // Without this line, sendResponse won't work
  return true
})


// ─── OPTIONAL: FLOATING TOOLTIP ──────────────────────────────────────────────
// When the user highlights text, a small button appears near their selection
// Clicking it triggers the "Read Selection" flow without opening the popup
//
// This is a nice-to-have feature - build the core first, add this after
//
// To build this you'll need to:
//   1. Listen for the "mouseup" event on the document
//   2. Check if window.getSelection().toString() is not empty
//   3. Inject a small <div> button near the selection coordinates
//   4. On click, send a message to background.js with the selected text
//   5. Remove the tooltip when the user clicks elsewhere

// document.addEventListener("mouseup", () => {
//   TODO
// })
