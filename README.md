# Lumi 🌟
### AI-Powered Screen Reader Chrome Extension

> Built for the NSBE AI Impact-A-Thon · Archived

Lumi is an intelligent screen reader Chrome extension that makes web content accessible to everyone. Powered by Claude AI and AWS Polly neural voices, Lumi reads web pages aloud with natural-sounding speech — supporting multiple languages and adjustable communication styles to fit each user's needs.

---

## Features

- **AI-Powered Reading** — Uses Claude Haiku to intelligently process and summarize web content before reading, not just raw text dumps
- **Neural Text-to-Speech** — AWS Polly neural voices deliver natural, human-like audio across multiple languages
- **Multilingual Support** — Reads and speaks content in multiple languages, automatically adapting to page content
- **Custom Communication Registers** — Users can adjust speech style (formal, conversational, simplified) to match their comprehension preferences
- **Seamless Browser Integration** — Built on Chrome Manifest V3 for performance, security, and compatibility with modern Chrome APIs

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension Architecture | Chrome Manifest V3 |
| AI / NLP | Anthropic Claude Haiku API |
| Text-to-Speech | AWS Polly (Neural Engine) |
| AWS Auth | Signature V4 |
| Language | JavaScript |

### Architecture Overview

Lumi follows a service-worker architecture required by Manifest V3:

1. **Content Script** — Extracts and cleans page text from the active tab
2. **Service Worker (Background)** — Orchestrates API calls; sends text to Claude Haiku for processing, then forwards the result to AWS Polly
3. **Popup UI** — Controls for language selection, communication register, and playback
4. **AWS Polly** — Returns audio stream, authenticated via AWS Signature V4

---

## Team

This project was built as a hackathon submission for the **NSBE AI Impact-A-Thon**.

| Name | Role |
|---|---|
| Daniel | Lead Developer & Prompt Engineer (Claude & AWS Polly Integration) |
| Gabe | Backend Developer (Speech & Playback) |
| Marius | Front-end Developer (Main UI) |
| Adeboye | Front-end Developer (Main UI) |
| Michael | Front-end Developer (Playback)  |
| Ezra | Presenter & Project Coordinator |


---

## Status

This repository is **archived** (*Daniel: For now). Lumi was built as a hackathon project and is not actively maintained. The codebase is available for reference, learning, and forking.

If you'd like to build on top of Lumi, feel free to fork the repo.

---

## Acknowledgements

- [Anthropic](https://www.anthropic.com) — Claude Haiku API
- [AWS Polly](https://aws.amazon.com/polly/) — Neural text-to-speech
- Honeywell NSBE AI Impact-A-Thon organizers and mentors

---

<p align="center">Made with purpose · GLMLG Legion · Honeywell NSBE AI Impact-A-Thon 2026</p>
