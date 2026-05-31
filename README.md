# Process Visualizer (via Groq)

A shareable web app where users speak or type prompts and get process diagrams rendered on canvas (flows, legends, arrows, shapes, labels).

## What this includes

- Browser UI with canvas renderer and voice input (`SpeechRecognition`)
- Node/Express backend that securely calls Groq
- Groq key kept on server (`.env`), not exposed to browsers
- JSON-based drawing schema for flows, legends, arrows, and custom shapes
- Optional basic auth gate for private sharing
- API rate limiting to control abuse
- One-click PNG export from the canvas

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Set your key in `.env`:

```env
GROQ_API_KEY=gsk_your_real_key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_STT_MODEL=whisper-large-v3-turbo
PORT=3000
APP_USERNAME=
APP_PASSWORD=
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=20
```

4. Run the app:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## Deploy options

Any Node host works (Render, Railway, Fly.io, VPS, etc.).

You need:

- Node 18+
- Environment variable `GROQ_API_KEY`
- Optional env vars `GROQ_MODEL`, `PORT`
- Optional env vars `APP_USERNAME` and `APP_PASSWORD` to require login
- Optional env vars `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` for request limits

## Do end users need their own API key?

- Website mode (recommended): No. Users do not need their own key. Your server uses your key.
- Downloadable single HTML file mode: Yes, unless you still run a backend somewhere.

If you want people to use one downloadable file with no setup, that file must call a hosted backend you control.

## Production checklist

- Add request rate limiting (recommended)
- Add basic auth or login if this is private
- Add prompt/content logging only if needed and with consent
- Add monitoring for API errors and latency
- Pin model and test prompt behavior before sharing broadly

## API route

`POST /api/draw`

Request body:

```json
{ "prompt": "5-step hiring flow with arrows" }
```

Response body:

```json
{
  "elements": [
    {
      "type": "flow",
      "steps": ["Source", "Screen", "Interview", "Offer", "Hired"],
      "startX": 48,
      "startY": 200,
      "stepW": 140,
      "stepH": 56,
      "gap": 36,
      "direction": "horizontal",
      "palette": "teal"
    }
  ]
}
```
