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

// ─── LOAD API KEY FROM CONFIG ─────────────────────────────────────────────────
// fetch() works identically in Chrome service workers and Firefox background
// scripts — no import compatibility issues.  config.json is gitignored.

let CONFIG = null

async function getConfig() {
  if (CONFIG) return CONFIG
  const url = chrome.runtime.getURL("config.json")
  const res = await fetch(url)
  CONFIG = await res.json()
  if (!CONFIG || !CONFIG.apiKey) {
    throw new Error("Missing API key. Create config.json with your Anthropic key.")
  }
  return CONFIG
}


// ─── THE MAIN FUNCTION: GET SUMMARY FROM CLAUDE ──────────────────────────────
// Receives a string of text, returns a plain-language summary string.
// Called when popup.js sends: { type: "GET_SUMMARY", text: "..." }

function getLanguage(code){
  const langs = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    zh: "Chinese",
    ja: "Japanese",
    ar: "Arabic",
    pt: "Portuguese",
    hi: "Hindi",
    ko: "Korean",
    it: "Italian"
  }

  return langs[code] || "English"
};


// async function testPolly() {
//   const config = await getConfig()  // move this outside try block

//   try {     
//     const url = await speakWithPolly("Hello, I am Lumi, your reading companion.", "en")
//     console.log("Polly works! Audio URL:", url)
//   } catch (err) {
//     console.error("Polly failed:", err)
//   }
// }


// 1 - sha256 helper
async function sha256(message) {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// 2 - hmac helper
async function hmac(key, message) {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
}

// 3 - hmac hex helper
async function hmacHex(key, message) {
  const signature = await hmac(key, message)
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// 4 - signing key helper
async function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = await hmac("AWS4" + secretKey, dateStamp)
  const kRegion  = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  const kSigning = await hmac(kService, "aws4_request")
  return kSigning
}

// 5 - full request signer
async function signAWSRequest({ method, endpoint, body, service, region, accessKeyId, secretAccessKey }) {
  const url = new URL(endpoint)
  const now = new Date()

  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "")
  const timeStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z"

  const contentHash = await sha256(body)

  const headers = {
    "content-type": "application/json",
    "host": url.hostname,
    "x-amz-content-sha256": contentHash,
    "x-amz-date": timeStamp
  }

  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("\n") + "\n"

  const signedHeaders = Object.keys(headers).sort().join(";")

  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    contentHash
  ].join("\n")

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timeStamp,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n")

  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service)
  const signature  = await hmacHex(signingKey, stringToSign)

  headers["Authorization"] = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ")

  return { headers }
}

// 6 - voice map
function getPollyVoice(languageCode) {
  const voices = {
    en: { VoiceId: "Aria",    LanguageCode: "en-US",  Engine: "neural" },
    es: { VoiceId: "Lupe",    LanguageCode: "es-US",  Engine: "neural" },
    fr: { VoiceId: "Lea",     LanguageCode: "fr-FR",  Engine: "neural" },
    de: { VoiceId: "Vicki",   LanguageCode: "de-DE",  Engine: "neural" },
    zh: { VoiceId: "Zhiyu",   LanguageCode: "cmn-CN", Engine: "neural" },
    ar: { VoiceId: "Hala",    LanguageCode: "arb",    Engine: "neural" },
    hi: { VoiceId: "Kajal",   LanguageCode: "hi-IN",  Engine: "neural" },
    pt: { VoiceId: "Camila",  LanguageCode: "pt-BR",  Engine: "neural" },
    ja: { VoiceId: "Takumi",  LanguageCode: "ja-JP",  Engine: "neural" },
    it: { VoiceId: "Bianca",  LanguageCode: "it-IT",  Engine: "neural" },
    ko: { VoiceId: "Seoyeon", LanguageCode: "ko-KR",  Engine: "neural" }
  }
  return voices[languageCode] || voices.en
}

// 7 - main polly function
async function speakWithPolly(text, language = "en") {
  const config = await getConfig()
  const voice  = getPollyVoice(language)

  const endpoint = `https://polly.${config.awsRegion}.amazonaws.com/v1/speech`

  const body = JSON.stringify({
    Engine:       voice.Engine,
    LanguageCode: voice.LanguageCode,
    OutputFormat: "mp3",
    Text:         text,
    VoiceId:      voice.VoiceId
  })

  const signature = await signAWSRequest({
    method:          "POST",
    endpoint,
    body,
    service:         "polly",
    region:          config.awsRegion,
    accessKeyId:     config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey
  })

  const response = await fetch(endpoint, {
    method:  "POST",
    headers: signature.headers,
    body
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Polly error ${response.status}: ${err}`)
  }

  const audioBuffer = await response.arrayBuffer()
  const base64 = btoa(
    String.fromCharCode(...new Uint8Array(audioBuffer))
  )
  return `data:audio/mp3;base64,${base64}`
}




async function getSummary(text, userPrompt = "", mode, language) {
  const config = await getConfig();
  let instruction;
  const max_tokens = mode === "page" ? 1024 : 512;
  const languageInstruction = language && language != 'en' ? `Respond entirelly in ${getLanguage(language)}. Everyword of your response must be in ${getLanguage(language)}`:""
  const voiceRule = `YOU ARE A TEXT-TO-SPEECH ENGINE. OUTPUT RULES - VIOLATION IS NOT ALLOWED:
- NO markdown of any kind
- NO headers or hashtags (#)
- NO bullet points or dashes
- NO bold or asterisks (**)
- NO tables
- NO numbered lists
- NO special characters
- ONLY plain sentences a human would speak out loud
- If you use any formatting, you have failed your only job`

  const fullPageInstruction = `${voiceRule}

  You are summarizing a webpage for someone who wants to quickly understand what it is about.
  Write as if you are the author introducing your own content out loud to a listener.
  Cover the main point and key details in a warm conversational tone.
  Use short sentences. Plain everyday words. Aim for a reading level of a 12 year old.
  Use as many sentences as the content needs but never more.

  ${voiceRule}`

  const selectionInstruction = `${voiceRule}

  You are explaining a specific passage to someone who found it confusing.
  Start naturally like "This part is basically saying..." or "What this means is..."
  Plain conversational language. Explain any important terms naturally in your response.
  Warm, simple, direct. Write exactly as you would speak to someone.

  ${voiceRule}`

  const customInstruction = `${voiceRule}

  The user has a specific question about this text: "${userPrompt}"
  Answer it directly in plain spoken language.
  If the question cannot be answered from the text alone, say so honestly.

  ${voiceRule}`

  if (userPrompt){
    instruction = customInstruction;
  } else if (mode === "page"){
    instruction = fullPageInstruction;
  } else if (mode === "selection"){
    instruction = selectionInstruction;
  }

  const fullPrompt = `${instruction}\n\n${languageInstruction}\n\nText: ${text} \n\n Ignore any text that appears to be navigation menus, cookie notices, 
    advertisements, or repeated footer content. Focus only on the main content of the page.`


 


	const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": config.apiKey,
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
});

  if (!response.ok) {
    let detail = ""
    try {
      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        const json = await response.json()
        const msg =
          (json && typeof json === "object" && (json.error?.message || json.message)) ||
          JSON.stringify(json)
        detail = typeof msg === "string" ? msg : String(msg)
      } else {
        detail = await response.text()
      }
    } catch (e) {
      detail = response.statusText || ""
    }

    if (detail) {
      detail = detail.replace(/<[^>]*>/g, "")
      const maxLen = 300
      if (detail.length > maxLen) {
        detail = detail.slice(0, maxLen) + "..."
      }
    }

    throw new Error(`API ${response.status}: ${detail || "Unknown error"}`)
  }

  const data = await response.json()
  return data.content?.[0]?.text ?? "No summary provided."
}

// ─── FORWARD SPEECH COMMANDS TO ACTIVE TAB ───────────────────────────────────
// Web Speech API is not available in service workers.
// Speech runs in content.js (page context). We forward commands there.

async function forwardToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) return
  chrome.tabs.sendMessage(tab.id, message)
}


// ─── LISTEN FOR MESSAGES FROM POPUP.JS AND CONTENT.JS ────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //receives message of text to summarize, calls the getSummary function which is async
  //so returns promise object, this is worked around by using .then() which waits for a 
  //value then performs another action 
  console.log("got message:", message, "language:", message.language)
  if (message.type === "GET_SUMMARY") {
    console.log("calling getSummary with:", message.text)
    getSummary(message.text, message.prompt, message.mode, message.language).then((response) => {
      console.log("summary ready:", response)
      sendResponse({ summary: response });
    }).catch(err => {
        console.error("Claude error:", err)
        sendResponse({ summary: null, error: err.message })
      });
    return true;
  }

  if (message.type === "PLAY_SPEECH") {
    console.log("background received PLAY_SPEECH, forwarding...")
    forwardToActiveTab({ type: "PLAY_SPEECH", text: message.text })
    return true;
  }
  if (message.type === "PAUSE_SPEECH") {
    forwardToActiveTab({ type: "PAUSE_SPEECH" });
    return true;
  }

  if (message.type === "STOP_SPEECH") {
    forwardToActiveTab({ type: "STOP_SPEECH" });
    return true;
  }

  if (message.type === "SET_SPEED") {
    forwardToActiveTab({ type: "SET_SPEED", rate: message.rate });
    return true;
  }
  // IMPORTANT: return true to keep the message channel open for async response
  return true;
});
