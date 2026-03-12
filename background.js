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
import CONFIG from "./config.js"

const apiKey = CONFIG.apiKey;

// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// This is the function the whole backend role is about.
// Receives a string of text, returns a plain-language summary string.

//I did some code to test my popups in the console
// AI SUMMARY FUNCTION
// This function sends webpage text to Claude
// and returns a plain-language summary.
//
// Called when popup.js sends:
// { type: "GET_SUMMARY", text: "..." }
//
// NOTE FOR TEAM: You can also delete all this and write your actual getsummary function.
// I just used this to test popup.jss
// This part is the AI integration layer.
// If you want to adjust prompt quality or model settings, this is the place to do it.


async function getSummary(text, userPrompt = "", mode) {
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
    "x-api-key": apiKey,
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

})
	let data = await response.json();
	const result = data.content?.[0]?.text ?? "No Summary Provided";
	return result;
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
  //receives message of text to summarize, calls the getSummary function which is async
  //so returns promise object, this is worked around by using .then() which waits for a 
  //value then performs another action 
  console.log(`got message: ${message}`)
  if (message.type === "GET_SUMMARY") {
    console.log("calling getSummary with:", message.text)
    getSummary(message.text, message.prompt).then((response) => {
      console.log("summary ready:", response)
      sendResponse({ summary: response });
    });
  }
  // IMPORTANT: return true to keep the message channel open for async response
  return true;
});
