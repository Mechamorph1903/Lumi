import CONFIG from "./config.js"

const apiKey = CONFIG.apiKey;

async function getSummary(text, userPrompt = "") {
  const baseInstruction = userPrompt
    ? userPrompt
    : "Summarize the following in 3-5 plain simple sentences anyone can understand"

  const fullPrompt = `${baseInstruction}. Reply with plain text only, no markdown, no headings, no bullet points. Text to summarize: ${text}`

	const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
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

const data = await getSummary(`It wasn’t competitive in the first half. We were beating them by double digits until Kobe started going off.

Once he got hot the commentators got to the point where they expressed how they missed Hoffa because he would be the one to give a hard foul on Kobe to stop his run (LOL). The fact was that we allowed him to embarrass us.

He wasn’t double teamed, and we pretty much allowed him to go to work on Jalen and Mo Pete. Sam Mitchell was the blame for most of that run but no one remembers the horrible coaching job.

If we double teamed him he might’ve still got 70, but in all likelihood we would’ve still won that game and his 70 would be relatively meaningless. Smitch was a deer caught in headlights. Just an absolute hatchet job of “coaching”.`, "What does he mean?")

console.log(data)