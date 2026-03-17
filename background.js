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
    it: "Italian",
    hip: "Hip Mode",
    blk: "BLK Mode",
    xd: "XD Mode"
  }

  return langs[code] || "English"
};

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
function getPollyVoice(languageCode, vibeCode) {
  const voices = {
    en: { VoiceId: "Danielle",    LanguageCode: "en-US",  Engine: "neural" },
    es: { VoiceId: "Lupe",    LanguageCode: "es-US",  Engine: "neural" },
    fr: { VoiceId: "Liam",     LanguageCode: "fr-CA",  Engine: "neural" },
    de: { VoiceId: "Vicki",   LanguageCode: "de-DE",  Engine: "neural" },
    zh: { VoiceId: "Zhiyu",   LanguageCode: "cmn-CN", Engine: "neural" },
    ar: { VoiceId: "Hala",    LanguageCode: "arb",    Engine: "neural" },
    hi: { VoiceId: "Kajal",   LanguageCode: "hi-IN",  Engine: "neural" },
    pt: { VoiceId: "Camila",  LanguageCode: "pt-BR",  Engine: "neural" },
    ja: { VoiceId: "Takumi",  LanguageCode: "ja-JP",  Engine: "neural" },
    it: { VoiceId: "Adriano",  LanguageCode: "it-IT",  Engine: "neural" },
    ko: { VoiceId: "Seoyeon", LanguageCode: "ko-KR",  Engine: "neural" },
    hip: { VoiceId: "Danielle",    LanguageCode: "en-US",  Engine: "neural" },
    xd: { VoiceId: "Joey",    LanguageCode: "en-US",  Engine: "neural" },
    blk: { VoiceId: "Gregory",    LanguageCode: "en-US",  Engine: "neural" }
  }

  if (vibeCode != "" && languageCode === "en"){
    return voices[vibeCode]
  }
  return voices[languageCode] || voices.en
}

// 7 - main polly function
async function speakWithPolly(text, language = "en", vibe="") {
  const config = await getConfig()
  const voice  = getPollyVoice(language, vibe)

  // split text into chunks under 2800 chars
  // split on sentence boundaries so speech sounds natural
  const chunks = splitIntoChunks(text, 2800)
  console.log(`Polly: splitting into ${chunks.length} chunks`)

  const audioDataUrls = []

  for (const chunk of chunks) {
    const url = await pollySingleChunk(chunk, voice, config)
    audioDataUrls.push(url)
  }

  return audioDataUrls
}

// splits text on sentence boundaries to keep chunks natural
function splitIntoChunks(text, maxLength) {
  if (text.length <= maxLength) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > maxLength) {
    // find last sentence ending before maxLength
    let splitAt = remaining.lastIndexOf(". ", maxLength)
    if (splitAt === -1) splitAt = remaining.lastIndexOf("! ", maxLength)
    if (splitAt === -1) splitAt = remaining.lastIndexOf("? ", maxLength)
    if (splitAt === -1) splitAt = maxLength  // no sentence boundary found, hard split

    chunks.push(remaining.slice(0, splitAt + 1).trim())
    remaining = remaining.slice(splitAt + 1).trim()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

// handles a single Polly API call for one chunk
async function pollySingleChunk(text, voice, config) {
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

  let response = await fetch(endpoint, {
    method:  "POST",
    headers: signature.headers,
    body
  })

  // fallback to standard engine if neural fails
  if (!response.ok && voice.Engine === "neural") {
    console.warn("Neural failed, retrying with standard...")
    const fallbackBody = JSON.stringify({
      Engine:       "standard",
      LanguageCode: voice.LanguageCode,
      OutputFormat: "mp3",
      Text:         text,
      VoiceId:      voice.VoiceId
    })

    const fallbackSignature = await signAWSRequest({
      method:          "POST",
      endpoint,
      body:            fallbackBody,
      service:         "polly",
      region:          config.awsRegion,
      accessKeyId:     config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey
    })

    response = await fetch(endpoint, {
      method:  "POST",
      headers: fallbackSignature.headers,
      body:    fallbackBody
    })
  }

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Polly error ${response.status}: ${err}`)
  }

  const audioBuffer = await response.arrayBuffer()
  const uint8Array = new Uint8Array(audioBuffer)

  let binary = ""
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }

  return `data:audio/mp3;base64,${btoa(binary)}`
}




async function getSummary(text, userPrompt = "", mode, language, vibe = "") {
  const config = await getConfig();
  let instruction;
  const max_tokens = mode === "page" ? 1024 : 512;


  const voiceRule = `YOU ARE A TEXT-TO-SPEECH ENGINE. OUTPUT RULES - VIOLATION IS NOT ALLOWED:
- NO markdown of any kind
- NO headers or hashtags (#)
- NO bullet points or dashes
- NO bold or asterisks (**)
- NO tables
- NO numbered lists
- ONLY plain sentences — in whatever language is specified above
- [IMPORTANT] PUNCTUATION IS ALLOWED AND ENCOURAGED: periods, commas, question marks, 
  exclamation marks, quotation marks, apostrophes, ellipses (...), em dash, hyphens
  These help the speech sound natural — use them freely!
- If you use any formatting symbols, you have failed your only job`



  const xdInstruction = `${voiceRule}
     Now write your response in the voice of a hyped American dude deep in extreme sports culture.
     Think dirtbikes, monster trucks, motocross, Red Bull, energy drinks, getting air.
     
     TONE: Loud, enthusiastic, zero filter. Like you just landed a sick jump and need to explain something.
     
     VOCABULARY TO USE: dude, bro, gnarly, sick, shred, send it, no cap, straight up, legit, 
     that slaps, wild, insane, banger, lowkey ripping, fire, let's gooo, deadass, 
     "not gonna lie", "for real for real", "that's actually hard"
     
     SENTENCE STYLE:
     - Short punchy sentences. Lots of emphasis.
     - Start with something like "Okay bro so—", "Dude straight up—", "Ngl this is kinda wild—"
     - Break complex things down like you're explaining to your boy at the track
     - Random hype interjections are fine — "which is INSANE", "bro what", "no way that's real"
     - Punctuation, if you have slang that act as an introductory word use apopropriate punctutation, remember you are a TTS reader
     
     WHAT TO AVOID:
     - Never sound like a textbook
     - Never use formal transitions like "furthermore" or "in conclusion"
     - Don't overdo it — one or two slang words per sentence is enough, not every single word
     
     Keep it PG. The energy is high school energy not adult content.

  ${voiceRule}`

  const hipInstruction = `${voiceRule}
Role: You are a bubbly, expressive, and trend-savvy best friend. Think brunch energy.
Task: Break down this page content so it feels approachable, fun, and "essential."

Guidelines:
- Structure: Open with "Okay, so here's the tea." Use emojis sparingly to highlight key points. Summarize the "vibe" of the article first.
- Logic: Use "relatable" analogies (skincare, social trends, or life-hacks) to explain complex data. 
- Vocabulary: "Literally," "it’s giving," "totally," "kind of like," "honestly," "bestie," "the way that."
- No-Go: Don't be dry. If the content is boring, acknowledge it ("I know this sounds dry, but...").
- Goal: Make the user feel like they’re getting the inside scoop from a friend who already did the reading for them.
- Punctuation, if you have slang that act as an introductory word use apopropriate punctutation, remember you are a TTS reader
Example: "Okay so basically what this is saying is totally [Content]. It’s giving [Vibe]..."
${voiceRule}`

  const blkInstruction = `${voiceRule}
    Role: You are providing a grounded, direct summary using AAVE. You are the "smart homie" who cuts through the noise.
    Task: Summarize the page content with clarity, rhythm, and zero fluff.

    Guidelines:
    - Structure: Start with "So check it" or "Look." Use a "Major Keys" section for the most important takeaways. 
    - Logic: Prioritize the "bottom line." Explain why this information matters to the average person. Be smart but never stiff.
    - Vocabulary: "Lowkey," "no cap," "for real though," "what's happening here is," "on sight," "facts."
    - No-Go: Avoid forced slang or stereotypes. Keep the flow natural and the intelligence high. 
    - Goal: Provide a version of the text that feels honest, respected, and easy to digest.
    - Punctuation, if you have slang that act as an introductory word use apopropriate punctutation, remember you are a TTS reader

    Example: "Yo, so basically what’s going on here is [Content]. For real though, the main thing you need to know is..."
    ${voiceRule}`

  const vibeInstruction = vibe === "xd" ? xdInstruction : vibe === "hip" ? hipInstruction : vibe === "blk" ? blkInstruction: "";

  const languageInstruction = language && language != 'en' ? `Respond entirelly in ${getLanguage(language)}. Everyword of your response must be in ${getLanguage(language)}.`:""

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
  Be lenient if the user asks questions in slang such as, "what's the tea?". It does not necessarily mean you should find the instruction in the provided text

  ${voiceRule}`

  if (userPrompt){
    instruction = customInstruction;
  } else if (mode === "page"){
    instruction = fullPageInstruction;
  } else if (mode === "selection"){
    instruction = selectionInstruction;
  }

  const fullPrompt = `${languageInstruction}\n\n${vibeInstruction}\n\n${instruction}\n\nText: ${text} \n\n Ignore any text that appears to be navigation menus, cookie notices, 
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
  if (message.type === "GET_SUMMARY") {
    getSummary(message.text, message.prompt, message.mode, message.language, message.vibe).then((response) => {
      sendResponse({ summary: response });
    }).catch(err => {
        console.error("Claude error:", err)
        sendResponse({ summary: null, error: err.message })
      });
    return true;
  }

  if (message.type === "PLAY_SPEECH") {
    console.log("background received PLAY_SPEECH, calling Polly...")
    speakWithPolly(message.text, message.language, message.vibe)
      .then(audioDataUrls => {
        forwardToActiveTab({ type: "STOP_SPEECH" })
        setTimeout(() => {
          forwardToActiveTab({ 
            type: "PLAY_AUDIO_QUEUE", 
            urls: audioDataUrls  // send array not single url
          })
        }, 100)
      })
      .catch(err => {
        console.error("Polly failed, falling back to browser voice:", err)
        forwardToActiveTab({ type: "STOP_SPEECH" })
        forwardToActiveTab({ type: "PLAY_SPEECH", text: message.text })
      })
    return true
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

  // ── SEEK: forward seek request to content.js audio player ──
  if (message.type === "SEEK_AUDIO") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab || !tab.id) { sendResponse({ ok: false }); return }
      chrome.tabs.sendMessage(tab.id, { type: "SEEK_AUDIO", time: message.time }, (resp) => {
        sendResponse(resp || { ok: false })
      })
    })
    return true
  }

  // ── GET_PLAYBACK_STATE: popup asks content.js for current audio state ──
  if (message.type === "GET_PLAYBACK_STATE") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab || !tab.id) {
        sendResponse({ currentTime: 0, totalDuration: 0, isPlaying: false, isPaused: false })
        return
      }
      chrome.tabs.sendMessage(tab.id, { type: "GET_PLAYBACK_STATE" }, (resp) => {
        sendResponse(resp || { currentTime: 0, totalDuration: 0, isPlaying: false, isPaused: false })
      })
    })
    return true
  }

  // IMPORTANT: return true to keep the message channel open for async response
  return true;
});
