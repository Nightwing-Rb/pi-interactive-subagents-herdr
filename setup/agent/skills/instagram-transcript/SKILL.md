---
name: instagram-transcript
description: Transcribe an Instagram Reel from a URL into plain text via the FreeScribe API. Use when the user provides a video URL and needs its spoken content for analysis, summarization, quoting, or search.
---

# Instagram / Video Transcript

Fetches a video's transcript by sending the URL to the FreeScribe API, which does the speech-to-text server-side. Works with Instagram Reels. No authentication and no local STT model required.

## Requirements

- Python 3 (stdlib only, no pip installs)
- Internet access

## Usage

```bash
python ~/.pi/agent/skills/instagram-transcript/transcribe.py "<video_url>"

# Optional language code (default: auto)
python ~/.pi/agent/skills/instagram-transcript/transcribe.py "<video_url>" en
```

## Output

Prints a JSON object to stdout:

```json
{
  "title": "Post caption / video title",
  "transcript": "full transcript text as a single string",
  "author": "account_username"
}
```

Progress/info logs go to stderr. On failure (private/deleted video, no speech, bad URL, network error), the script exits non-zero with a message on stderr.

## Notes

- `title` is the post caption/description, not spoken content — only `transcript` contains spoken words.
- Transcript is plain text with timing stripped — not timestamped. For timestamped segments, call the FreeScribe `/api/transcript` endpoint directly and read its `segments` (`{text, startMs, endMs}`).
- Supports 50+ languages; `auto` detects automatically.
- Longer videos can take 30-60s+; the script uses a generous timeout.
