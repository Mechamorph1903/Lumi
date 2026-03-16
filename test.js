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

