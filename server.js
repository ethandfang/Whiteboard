const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const groqApiKey = process.env.GROQ_API_KEY || '';
const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const appUsername = process.env.APP_USERNAME || '';
const appPassword = process.env.APP_PASSWORD || '';
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 20);
const groqSttModel = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

const ipHits = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json({ limit: '1mb' }));

function requireBasicAuth(req, res, next) {
  if (!appUsername || !appPassword) {
    return next();
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Process Visualizer"');
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const encoded = auth.slice(6).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid auth header.' });
  }

  const sepIndex = decoded.indexOf(':');
  if (sepIndex === -1) {
    return res.status(401).json({ error: 'Invalid auth format.' });
  }

  const username = decoded.slice(0, sepIndex);
  const password = decoded.slice(sepIndex + 1);
  if (username !== appUsername || password !== appPassword) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  return next();
}

function rateLimitDraw(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const hitTimes = ipHits.get(key) || [];
  const activeHits = hitTimes.filter((ts) => now - ts < rateLimitWindowMs);

  if (activeHits.length >= rateLimitMax) {
    const retryAfterSec = Math.ceil((rateLimitWindowMs - (now - activeHits[0])) / 1000);
    res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }

  activeHits.push(now);
  ipHits.set(key, activeHits);
  return next();
}

app.use(requireBasicAuth);
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a canvas drawing assistant.
Return ONLY a JSON array of drawing elements. No explanation, no markdown, no extra text.

Canvas is 900x480.

Supported element schemas:
1) Flow:
{"type":"flow","steps":["Step 1","Step 2"],"startX":50,"startY":200,"stepW":140,"stepH":56,"gap":36,"direction":"horizontal","palette":"purple"}

2) Legend:
{"type":"legend","x":40,"y":40,"title":"Legend","items":[{"color":"green","label":"Approved"},{"color":"red","label":"Rejected"}]}

3) Rect:
{"type":"rect","x":100,"y":100,"w":160,"h":60,"color":"purple","label":"My Box","labelColor":"white","rx":10,"shadow":true}

4) Circle:
{"type":"circle","x":450,"y":240,"r":60,"color":"teal","label":"Start","labelColor":"white"}

5) Diamond:
{"type":"diamond","x":350,"y":180,"w":140,"h":80,"color":"orange","label":"Decision?","labelColor":"white"}

6) Arrow:
{"type":"arrow","x1":260,"y1":130,"x2":350,"y2":130,"color":"gray","label":"optional","curved":false,"dashed":false}

7) Text:
{"type":"text","x":450,"y":30,"text":"Title","color":"dark","fontSize":20,"fontWeight":"600","align":"center"}

Color names allowed: purple, blue, teal, green, red, coral, orange, amber, yellow, pink, gray, dark, white, black, navy, indigo, mint, rose, lavender, cyan, brown, lime.

Rules:
- If user asks to clear, return []
- You are editing an existing canvas state. Unless the user explicitly asks to remove or clear elements, preserve existing elements and add/modify on top.
- Return the COMPLETE updated array, not just new additions.
- For process flows, prefer type="flow"
- Avoid overlaps and use available canvas area
- Legends should go in corner unless user requests otherwise
- Return only valid JSON array`;

function isClearIntent(prompt) {
  const clearPattern = /\b(clear|erase|wipe|reset|start over|delete all|remove all)\b/i;
  return clearPattern.test(String(prompt || ''));
}

function parseElements(rawText) {
  const text = String(rawText || '').trim();

  if (!text) {
    return [];
  }

  // First try direct parse.
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) {
      return direct;
    }
  } catch (_err) {
    // Continue to fallback extraction.
  }

  // Strip common markdown fences.
  const unwrapped = text.replace(/```json|```/gi, '').trim();

  try {
    const parsed = JSON.parse(unwrapped);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_err) {
    // Continue to bracket extraction.
  }

  const start = unwrapped.indexOf('[');
  const end = unwrapped.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const arrayText = unwrapped.slice(start, end + 1);
    const parsed = JSON.parse(arrayText);
    if (!Array.isArray(parsed)) {
      throw new Error('Model response was not an array.');
    }
    return parsed;
  }

  throw new Error('Could not parse model output as a JSON array.');
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(groqApiKey),
    model: groqModel,
    hasBasicAuth: Boolean(appUsername && appPassword),
    rateLimitWindowMs,
    rateLimitMax
  });
});

app.post('/api/draw', rateLimitDraw, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const currentElements = Array.isArray(req.body?.currentElements)
      ? req.body.currentElements
      : [];
    const clearIntent = isClearIntent(prompt);

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    if (!groqApiKey) {
      return res.status(500).json({
        error: 'Server is missing GROQ_API_KEY. Set it in your .env file.'
      });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `User request: ${prompt}`,
              'Current canvas elements JSON:',
              JSON.stringify(currentElements),
              'Return the full updated canvas JSON array.'
            ].join('\n')
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || 'Groq API request failed.';
      return res.status(response.status).json({ error: message });
    }

    const content = data?.choices?.[0]?.message?.content || '';
    let elements = parseElements(content);

    // Safety: never wipe the canvas unless the user explicitly asked to clear.
    if (clearIntent) {
      elements = [];
    } else if (currentElements.length > 0 && elements.length === 0) {
      elements = currentElements;
    }

    return res.json({ elements });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
});

app.post('/api/transcribe', rateLimitDraw, upload.single('audio'), async (req, res) => {
  try {
    if (!groqApiKey) {
      return res.status(500).json({
        error: 'Server is missing GROQ_API_KEY. Set it in your .env file.'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Audio file is required.' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const fileName = req.file.originalname || 'speech.webm';

    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: mimeType });
    form.append('file', blob, fileName);
    form.append('model', groqSttModel);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`
      },
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || 'Groq transcription request failed.';
      return res.status(response.status).json({ error: message });
    }

    const text = String(data?.text || '').trim();
    return res.json({ text });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Unexpected transcription error.'
    });
  }
});

app.listen(port, () => {
  console.log(`Process Visualizer running at http://localhost:${port}`);
});
