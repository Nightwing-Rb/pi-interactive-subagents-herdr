#!/usr/bin/env python3
"""Transcribe an Instagram Reel / TikTok / YouTube video via the FreeScribe API.

Two-step flow:
  1. POST /api/video-info  -> metadata + direct media URL
  2. POST /api/transcript  -> timestamped segments

No authentication needed; the API does the speech-to-text server-side.
"""
import json
import sys
import urllib.request
import urllib.error

BASE = "https://freescribe.app"
HEADERS = {
    "Content-Type": "application/json",
    "Origin": BASE,
    "Referer": f"{BASE}/instagram-transcript",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


def post(endpoint, payload, timeout=180):
    req = urllib.request.Request(
        f"{BASE}{endpoint}",
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        print(f"HTTP {e.code} from {endpoint}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Network error calling {endpoint}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <video_url> [language]", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "auto"

    print("Fetching video info...", file=sys.stderr)
    info = post("/api/video-info", {"url": url, "language": language})
    media_url = info.get("media")
    if not media_url:
        print(
            "No media URL returned — the video may be private, deleted, or unsupported.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Requesting transcript...", file=sys.stderr)
    result = post(
        "/api/transcript",
        {"url": url, "language": language, "mediaUrl": media_url},
    )
    segments = result.get("segments", [])
    if not segments:
        print("Transcript returned no segments (video may have no speech).", file=sys.stderr)
        sys.exit(1)

    transcript = " ".join(s["text"].strip() for s in segments if s.get("text", "").strip())
    output = {
        "title": info.get("title", "Unknown_Title"),
        "transcript": transcript,
        "author": info.get("authorUsername"),
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
