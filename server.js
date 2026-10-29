import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.use(express.static(path.join(__dirname, 'public')));

// Optional Server-Side Neural TTS Proxy (ElevenLabs fallback switch)
app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
  const text = String(req.body?.text || '').trim();

  if (!apiKey) {
    return res.status(200).json({
      configured: false,
      message: 'ELEVENLABS_API_KEY not configured on server; using Web Speech Deep Discovery Baritone engine.'
    });
  }
  if (!text) {
    return res.status(400).json({ configured: true, error: 'Missing narration text' });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.72, similarity_boost: 0.82, style: 0.25 }
      })
    });

    if (!response.ok) {
      return res.status(200).json({
        configured: false,
        message: 'Upstream neural TTS unavailable; falling back to Web Speech Deep Discovery engine.'
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.send(Buffer.from(arrayBuffer));
  } catch (_err) {
    return res.status(200).json({
      configured: false,
      message: 'Network fallback to Web Speech Deep Discovery engine.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
