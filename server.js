import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.use(express.static(path.join(__dirname, 'public')));

function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Google Maps Platform & Gemini configuration endpoint
app.get('/api/maps-config', (_req, res) => {
  const googleMapsApiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.MAPS_API_KEY ||
    '';
  res.json({
    googleMapsApiKey,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Server-side Gemini API with Google Maps Grounding
app.post('/api/gemini-maps-grounding', async (req, res) => {
  const ai = getGenAIClient();
  if (!ai) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured. Please check Settings > Secrets.',
    });
  }

  const placeName = String(req.body?.placeName || '').trim();
  const modernName = String(req.body?.modernName || '').trim();
  const era = String(req.body?.era || '').trim();
  const scriptureRefs = String(req.body?.scriptureRefs || '').trim();
  const customQuery = String(req.body?.query || '').trim();
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);

  const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lon);

  const prompt = customQuery
    ? `${customQuery} (Context: Biblical/Historical site ${placeName}${modernName ? `, modern ${modernName}` : ''}${era ? `, era: ${era}` : ''})`
    : `Provide a rich geographical, archaeological, and modern visitor overview of the biblical site "${placeName}" (${modernName || 'Ancient Near East / Mediterranean'}). Include its significance during ${era || 'biblical antiquity'} (${scriptureRefs || 'canonical & apocryphal traditions'}), visible archaeological ruins or landmarks nearby today, and current geographical context.`;

  try {
    const config = {
      tools: [{ googleMaps: {} }],
    };

    if (hasValidCoords) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: lat,
            longitude: lon,
          },
        },
      };
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config,
    });

    const text = response.text || 'No grounded summary returned.';
    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const mapsLinks = [];

    for (const chunk of rawChunks) {
      if (chunk?.maps) {
        const reviewSnippets = (chunk.maps.placeAnswerSources?.reviewSnippets || [])
          .map((s) => ({
            text: s?.reviewText || s?.text || '',
            author: s?.authorAttribution?.displayName || '',
            uri: s?.googleMapsUri || s?.uri || '',
          }))
          .filter((s) => s.text || s.uri);

        if (chunk.maps.uri || chunk.maps.title || reviewSnippets.length > 0) {
          mapsLinks.push({
            title: chunk.maps.title || placeName || 'Google Maps Place',
            uri: chunk.maps.uri || '',
            placeId: chunk.maps.placeId || '',
            reviewSnippets,
          });
        }
      }
    }

    return res.json({
      text,
      mapsLinks,
      coordinates: hasValidCoords ? { lat, lon } : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: `Gemini Maps Grounding request failed: ${message}`,
    });
  }
});

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

