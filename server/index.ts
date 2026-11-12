import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), 'env'), override: false });

const app = express();
app.disable('x-powered-by');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype));
  },
});

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.API_HOST || '127.0.0.1';
const MODEL = 'gemini-3.6-flash';
let rotationCursor = 0;
const keyCooldowns = new Map<string, number>();

const responseSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short, appetizing meal name.' },
    emoji: { type: 'string', description: 'Exactly one emoji that best represents the meal or drink category.' },
    portion: { type: 'string', description: 'Estimated total portion size in familiar units and grams when possible.' },
    calories: { type: 'number' },
    protein: { type: 'number', description: 'Grams.' },
    carbs: { type: 'number', description: 'Grams.' },
    fat: { type: 'number', description: 'Grams.' },
    fiber: { type: 'number', description: 'Grams.' },
    sugar: { type: 'number', description: 'Grams.' },
    sodium: { type: 'number', description: 'Milligrams.' },
    ingredients: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string', description: 'One short caveat about the estimate; empty if none.' },
    healthScore: { type: 'number', description: 'A health score from 1 to 10 based on nutritional value.' },
    healthScoreReason: { type: 'string', description: 'One concise sentence explaining the health score, weighing the most important positive and negative nutrition factors in this serving.' },
  },
  required: ['name', 'emoji', 'portion', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'ingredients', 'confidence', 'notes', 'healthScore', 'healthScoreReason'],
};

function getKeys() {
  const values = [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY, process.env.keys, process.env.KEYS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s,;]+/))
    .map((value) => value.trim().replace(/^['\"\[]|['\"\]]$/g, ''))
    .filter(Boolean);
  return [...new Set(values)];
}

function getRotatingKeys(keys: string[]) {
  if (!keys.length) return [];
  const start = rotationCursor % keys.length;
  rotationCursor = (rotationCursor + 1) % keys.length;
  const ordered = [...keys.slice(start), ...keys.slice(0, start)];
  const now = Date.now();
  const available = ordered.filter((key) => (keyCooldowns.get(key) || 0) <= now);
  return available.length ? available : ordered;
}

function shouldRetry(status: number, apiStatus?: string) {
  return [401, 403, 429, 500, 502, 503, 504].includes(status)
    || ['API_KEY_INVALID', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE'].includes(apiStatus || '');
}

function cooldownKey(key: string, status: number) {
  const cooldown = status === 401 || status === 403 ? 5 * 60_000 : 60_000;
  keyCooldowns.set(key, Date.now() + cooldown);
}

type AnalysisPayload = Record<string, unknown>;
type AnalysisJob = {
  status: 'analyzing' | 'complete' | 'failed';
  result?: AnalysisPayload;
  error?: string;
  updatedAt: number;
};

const analysisJobs = new Map<string, AnalysisJob>();

async function analyzeMeal(image?: Express.Multer.File, textQuery?: string): Promise<AnalysisPayload> {
  const keys = getKeys();
  if (!keys.length) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the local env file.');

  const hasImage = !!image;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: `You are a careful food nutrition estimator. Inspect this ${hasImage ? 'meal photo' : 'meal description'}, identify all visible food and estimate the nutrition for the ENTIRE visible serving. Account for likely oils, sauces and toppings, but do not invent invisible sides. Return realistic central estimates, not ranges. Choose exactly one intuitive emoji for the overall category, such as a drink, dessert, breakfast, snack, salad, soup, or main meal. Also assign a healthScore from 1 to 10 based on nutritional density and quality, and give one concise healthScoreReason that explains the score using the most important positive and negative factors in this specific serving. If the ${hasImage ? 'image' : 'description'} is not food, use confidence low and explain that briefly. Values are estimates and will be reviewed by the user.${hasImage && textQuery ? `\nUser's description: ${textQuery}` : ''}${!hasImage && textQuery ? `\nMeal description: ${textQuery}` : ''}`,
        },
        ...(image ? [{
          inlineData: {
            mimeType: image.mimetype,
            data: image.buffer.toString('base64'),
          },
        }] : []),
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.2,
    },
  };

  let finalError = 'Gemini could not analyze this image.';
  for (const key of getRotatingKeys(keys)) {
    try {
      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await geminiResponse.json() as {
        error?: { message?: string; status?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      if (!geminiResponse.ok) {
        finalError = payload.error?.message || finalError;
        if (shouldRetry(geminiResponse.status, payload.error?.status)) {
          cooldownKey(key, geminiResponse.status);
          continue;
        }
        break;
      }
      const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
      if (!text) {
        finalError = 'Gemini returned an empty analysis. Try a clearer photo.';
        continue;
      }
      keyCooldowns.delete(key);
      return JSON.parse(text) as AnalysisPayload;
    } catch (error) {
      cooldownKey(key, 503);
      finalError = error instanceof Error ? error.message : finalError;
    }
  }

  throw new Error(finalError);
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, model: MODEL, configured: getKeys().length > 0 });
});

const dataFile = path.resolve(process.cwd(), 'server', 'data.json');

app.get('/api/sync', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    if (fs.existsSync(dataFile)) {
      res.json(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
    } else {
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: 'Could not read data' });
  }
});

app.post('/api/sync', express.json({ limit: '50mb' }), (req, res) => {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not save data' });
  }
});

function persistAnalyzedMeal(id: string, eatenAt: string, result: AnalysisPayload) {
  try {
    const stored = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Record<string, unknown> : {};
    const meals = Array.isArray(stored.meals) ? stored.meals as Array<Record<string, unknown>> : [];
    stored.meals = [{ ...result, id, eatenAt }, ...meals.filter((meal) => meal.id !== id)];
    fs.writeFileSync(dataFile, JSON.stringify(stored));
  } catch (error) {
    console.error('Could not persist completed meal analysis:', error);
  }
}

app.post('/api/analyze', upload.single('image'), async (request, response) => {
  const textQuery = request.body?.text;
  if (!request.file && !textQuery) {
    response.status(400).json({ error: 'Provide a meal photo or a text description.' });
    return;
  }

  try {
    response.json(await analyzeMeal(request.file, textQuery));
  } catch (error) {
    response.status(getKeys().length ? 502 : 503).json({ error: error instanceof Error ? error.message : 'The meal could not be analyzed.' });
  }
});

app.post('/api/analyze-jobs', upload.single('image'), (request, response) => {
  const textQuery = request.body?.text;
  if (!request.file && !textQuery) {
    response.status(400).json({ error: 'Provide a meal photo or a text description.' });
    return;
  }
  if (!getKeys().length) {
    response.status(503).json({ error: 'Gemini is not configured. Add GEMINI_API_KEY to the local env file.' });
    return;
  }

  const requestedId = typeof request.body?.jobId === 'string' ? request.body.jobId : '';
  const id = /^[a-zA-Z0-9_-]{1,100}$/.test(requestedId) ? requestedId : randomUUID();
  const requestedEatenAt = typeof request.body?.eatenAt === 'string' ? request.body.eatenAt : '';
  const eatenAt = Number.isNaN(new Date(requestedEatenAt).getTime()) ? new Date().toISOString() : requestedEatenAt;
  const existing = analysisJobs.get(id);
  if (existing) {
    response.status(existing.status === 'analyzing' ? 202 : 200).json({ id, status: existing.status });
    return;
  }

  analysisJobs.set(id, { status: 'analyzing', updatedAt: Date.now() });
  response.status(202).json({ id, status: 'analyzing' });

  void analyzeMeal(request.file, textQuery)
    .then((result) => {
      if (!analysisJobs.has(id)) return;
      persistAnalyzedMeal(id, eatenAt, result);
      analysisJobs.set(id, { status: 'complete', result, updatedAt: Date.now() });
    })
    .catch((error) => {
      if (analysisJobs.has(id)) analysisJobs.set(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'The meal could not be analyzed.',
        updatedAt: Date.now(),
      });
    });
});

app.get('/api/analyze-jobs/:id', (request, response) => {
  const job = analysisJobs.get(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'Analysis job not found.' });
    return;
  }
  response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  response.json(job);
});

app.delete('/api/analyze-jobs/:id', (request, response) => {
  analysisJobs.delete(request.params.id);
  response.json({ ok: true });
});

const analysisJobCleanup = setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [id, job] of analysisJobs) {
    if (job.updatedAt < cutoff) analysisJobs.delete(id);
  }
}, 60 * 60_000);
analysisJobCleanup.unref();

const progressCategories = ['front-relaxed', 'front-open', 'side'] as const;
type ProgressCategory = typeof progressCategories[number];
type ProgressAlignment = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  headTop?: { x: number; y: number };
  waistCenter?: { x: number; y: number };
  torsoCenterX?: number;
};
type ProgressSymmetry = {
  measurementVersion?: number;
  imageLeftShoulder: { x: number; y: number };
  imageRightShoulder: { x: number; y: number };
  imageLeftHip?: { x: number; y: number };
  imageRightHip?: { x: number; y: number };
  imageLeftEar?: { x: number; y: number };
  imageRightEar?: { x: number; y: number };
  chin?: { x: number; y: number };
  headCenter: { x: number; y: number };
  neckCenter: { x: number; y: number };
  torsoCenter: { x: number; y: number };
  manualBodyLine?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
};
type ProgressSideAlignment = {
  facing: 'image-left' | 'image-right';
  ear: { x: number; y: number };
  shoulder: { x: number; y: number };
  hip: { x: number; y: number };
  knee: { x: number; y: number };
  ankle: { x: number; y: number };
};
type ProgressPhotoRecord = {
  id: string;
  category: ProgressCategory;
  capturedAt: string;
  uploadedAt: string;
  filename: string;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  alignment?: ProgressAlignment;
  symmetry?: ProgressSymmetry;
  sideAlignment?: ProgressSideAlignment;
};

const progressRoot = path.resolve(process.cwd(), 'server', 'progress');
const progressDataFile = path.join(progressRoot, 'photos.json');
const progressSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: progressCategories },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reason: { type: 'string', description: 'A short factual explanation of the visible pose only.' },
    alignment: {
      type: 'object',
      properties: {
        top: { type: 'number', description: 'Top of the visible person bounds from 0 to 1000.' },
        left: { type: 'number', description: 'Left of the visible person bounds from 0 to 1000.' },
        bottom: { type: 'number', description: 'Bottom of the visible person bounds from 0 to 1000.' },
        right: { type: 'number', description: 'Right of the visible person bounds from 0 to 1000.' },
        headTop: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
            y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
          },
          required: ['x', 'y'],
        },
        waistCenter: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
            y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
          },
          required: ['x', 'y'],
        },
        torsoCenterX: { type: 'number', description: 'Horizontal center of the torso from 0 to 1000, ignoring arm position.' },
      },
      required: ['top', 'left', 'bottom', 'right', 'headTop', 'waistCenter', 'torsoCenterX'],
    },
  },
  required: ['category', 'confidence', 'reason', 'alignment'],
};

function ensureProgressStorage() {
  fs.mkdirSync(progressRoot, { recursive: true });
  for (const category of progressCategories) {
    fs.mkdirSync(path.join(progressRoot, category), { recursive: true });
  }
}

function readProgressPhotos(): ProgressPhotoRecord[] {
  ensureProgressStorage();
  if (!fs.existsSync(progressDataFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(progressDataFile, 'utf8')) as ProgressPhotoRecord[];
  return Array.isArray(parsed) ? parsed : [];
}

function writeProgressPhotos(photos: ProgressPhotoRecord[]) {
  ensureProgressStorage();
  fs.writeFileSync(progressDataFile, JSON.stringify(photos, null, 2));
}

function publicProgressPhoto(photo: ProgressPhotoRecord) {
  return {
    id: photo.id,
    category: photo.category,
    capturedAt: photo.capturedAt,
    uploadedAt: photo.uploadedAt,
    confidence: photo.confidence,
    reason: photo.reason,
    alignment: photo.alignment,
    symmetry: photo.symmetry,
    sideAlignment: photo.sideAlignment,
    url: '/api/progress/images/' + photo.category + '/' + photo.filename,
  };
}

const progressSymmetrySchema = {
  type: 'object',
  properties: {
    imageLeftShoulder: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    imageRightShoulder: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    imageLeftHip: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    imageRightHip: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    imageLeftEar: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    imageRightEar: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    chin: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    headCenter: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    neckCenter: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
    torsoCenter: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal coordinate from 0 to 1000.' },
        y: { type: 'number', description: 'Vertical coordinate from 0 to 1000.' },
      },
      required: ['x', 'y'],
    },
  },
  required: ['imageLeftShoulder', 'imageRightShoulder', 'imageLeftHip', 'imageRightHip', 'imageLeftEar', 'imageRightEar', 'chin', 'headCenter', 'neckCenter', 'torsoCenter'],
};

const progressSideAlignmentSchema = {
  type: 'object',
  properties: {
    facing: { type: 'string', enum: ['image-left', 'image-right'] },
    ear: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    shoulder: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    hip: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    knee: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    ankle: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
  },
  required: ['facing', 'ear', 'shoulder', 'hip', 'knee', 'ankle'],
};

function normalizeProgressSymmetry(value: unknown): ProgressSymmetry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const clamp = (number: number) => Math.min(1, Math.max(0, number / 1000));
  const point = (key: string) => {
    const raw = candidate[key] as Record<string, unknown> | undefined;
    const x = Number(raw?.x);
    const y = Number(raw?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x), y: clamp(y) } : null;
  };
  let imageLeftShoulder = point('imageLeftShoulder');
  let imageRightShoulder = point('imageRightShoulder');
  let imageLeftHip = point('imageLeftHip');
  let imageRightHip = point('imageRightHip');
  let imageLeftEar = point('imageLeftEar');
  let imageRightEar = point('imageRightEar');
  const chin = point('chin');
  const headCenter = point('headCenter');
  const neckCenter = point('neckCenter');
  const torsoCenter = point('torsoCenter');
  if (!imageLeftShoulder || !imageRightShoulder || !imageLeftHip || !imageRightHip
    || !headCenter || !neckCenter || !torsoCenter) return null;
  if (imageLeftShoulder.x > imageRightShoulder.x) {
    [imageLeftShoulder, imageRightShoulder] = [imageRightShoulder, imageLeftShoulder];
  }
  if (imageLeftHip.x > imageRightHip.x) {
    [imageLeftHip, imageRightHip] = [imageRightHip, imageLeftHip];
  }
  if (imageLeftEar && imageRightEar && imageLeftEar.x > imageRightEar.x) {
    [imageLeftEar, imageRightEar] = [imageRightEar, imageLeftEar];
  }
  const shoulderMidY = (imageLeftShoulder.y + imageRightShoulder.y) / 2;
  const hipMidY = (imageLeftHip.y + imageRightHip.y) / 2;
  if (imageRightShoulder.x - imageLeftShoulder.x < 0.08
    || imageRightHip.x - imageLeftHip.x < 0.04
    || hipMidY - shoulderMidY < 0.05
    || torsoCenter.y - neckCenter.y < 0.05) return null;
  const shoulderSpan = imageRightShoulder.x - imageLeftShoulder.x;
  const earSpan = imageLeftEar && imageRightEar ? imageRightEar.x - imageLeftEar.x : 0;
  const earMidY = imageLeftEar && imageRightEar ? (imageLeftEar.y + imageRightEar.y) / 2 : 0;
  const jawIsUsable = Boolean(imageLeftEar && imageRightEar && chin
    && earSpan > shoulderSpan * 0.15
    && chin.y - earMidY > earSpan * 0.2);
  return {
    measurementVersion: 2,
    imageLeftShoulder,
    imageRightShoulder,
    imageLeftHip,
    imageRightHip,
    ...(jawIsUsable ? { imageLeftEar: imageLeftEar!, imageRightEar: imageRightEar!, chin: chin! } : {}),
    headCenter,
    neckCenter,
    torsoCenter,
  };
}

function normalizeProgressSideAlignment(value: unknown): ProgressSideAlignment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const facing = candidate.facing;
  if (facing !== 'image-left' && facing !== 'image-right') return null;
  const clamp = (number: number) => Math.min(1, Math.max(0, number / 1000));
  const point = (key: string) => {
    const raw = candidate[key] as Record<string, unknown> | undefined;
    const x = Number(raw?.x);
    const y = Number(raw?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x), y: clamp(y) } : null;
  };
  const ear = point('ear');
  const shoulder = point('shoulder');
  const hip = point('hip');
  const knee = point('knee');
  const ankle = point('ankle');
  if (!ear || !shoulder || !hip || !knee || !ankle) return null;
  if (!(ear.y < hip.y && shoulder.y < hip.y && hip.y < knee.y && knee.y < ankle.y)) return null;
  return { facing, ear, shoulder, hip, knee, ankle };
}

function storedProgressPoint(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function validateStoredProgressSymmetry(value: unknown): ProgressSymmetry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const imageLeftShoulder = storedProgressPoint(candidate.imageLeftShoulder);
  const imageRightShoulder = storedProgressPoint(candidate.imageRightShoulder);
  const imageLeftHip = storedProgressPoint(candidate.imageLeftHip);
  const imageRightHip = storedProgressPoint(candidate.imageRightHip);
  const headCenter = storedProgressPoint(candidate.headCenter);
  const neckCenter = storedProgressPoint(candidate.neckCenter);
  const torsoCenter = storedProgressPoint(candidate.torsoCenter);
  if (!imageLeftShoulder || !imageRightShoulder || !imageLeftHip || !imageRightHip || !headCenter || !neckCenter || !torsoCenter) return null;

  const imageLeftEar = candidate.imageLeftEar === undefined ? undefined : storedProgressPoint(candidate.imageLeftEar);
  const imageRightEar = candidate.imageRightEar === undefined ? undefined : storedProgressPoint(candidate.imageRightEar);
  const chin = candidate.chin === undefined ? undefined : storedProgressPoint(candidate.chin);
  if (imageLeftEar === null || imageRightEar === null || chin === null) return null;

  let manualBodyLine: ProgressSymmetry['manualBodyLine'];
  if (candidate.manualBodyLine !== undefined) {
    if (!candidate.manualBodyLine || typeof candidate.manualBodyLine !== 'object') return null;
    const rawLine = candidate.manualBodyLine as Record<string, unknown>;
    const start = storedProgressPoint(rawLine.start);
    const end = storedProgressPoint(rawLine.end);
    if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 0.02) return null;
    manualBodyLine = { start, end };
  }

  return {
    measurementVersion: 2,
    imageLeftShoulder,
    imageRightShoulder,
    imageLeftHip,
    imageRightHip,
    ...(imageLeftEar && imageRightEar && chin ? { imageLeftEar, imageRightEar, chin } : {}),
    headCenter,
    neckCenter,
    torsoCenter,
    ...(manualBodyLine ? { manualBodyLine } : {}),
  };
}

function validateStoredProgressSideAlignment(value: unknown): ProgressSideAlignment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const facing = candidate.facing;
  if (facing !== 'image-left' && facing !== 'image-right') return null;
  const ear = storedProgressPoint(candidate.ear);
  const shoulder = storedProgressPoint(candidate.shoulder);
  const hip = storedProgressPoint(candidate.hip);
  const knee = storedProgressPoint(candidate.knee);
  const ankle = storedProgressPoint(candidate.ankle);
  if (!ear || !shoulder || !hip || !knee || !ankle) return null;
  return { facing, ear, shoulder, hip, knee, ankle };
}

function normalizeProgressAlignment(value: unknown): ProgressAlignment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const raw = ['top', 'left', 'bottom', 'right'].map((key) => Number(candidate[key]));
  if (raw.some((number) => !Number.isFinite(number))) return null;
  const [rawTop, rawLeft, rawBottom, rawRight] = raw;
  const clamp = (number: number) => Math.min(1, Math.max(0, number / 1000));
  const alignment = {
    top: clamp(rawTop),
    left: clamp(rawLeft),
    bottom: clamp(rawBottom),
    right: clamp(rawRight),
  };
  if (alignment.bottom - alignment.top < 0.15 || alignment.right - alignment.left < 0.04) return null;
  const headValue = candidate.headTop as Record<string, unknown> | undefined;
  const waistValue = candidate.waistCenter as Record<string, unknown> | undefined;
  const anchorValues = [headValue?.x, headValue?.y, waistValue?.x, waistValue?.y, candidate.torsoCenterX].map(Number);
  if (anchorValues.some((number) => !Number.isFinite(number))) return null;
  const [headX, headY, waistX, waistY, torsoCenterX] = anchorValues.map(clamp);
  if (waistY - headY < 0.2) return null;
  return {
    ...alignment,
    headTop: { x: headX, y: headY },
    waistCenter: { x: waistX, y: waistY },
    torsoCenterX,
  };
}

function extensionForMime(mimeType: string) {
  return ({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
  } as Record<string, string>)[mimeType] || '.jpg';
}

async function classifyProgressPhoto(image: Pick<Express.Multer.File, 'buffer' | 'mimetype'>) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the local env file.');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Classify this progress photo into exactly one of three pose folders. Use front-relaxed when the person faces the camera with both arms resting down; front-open when the person faces the camera with both arms extended outward; and side for a left or right side profile. Choose the closest of those three even when framing is imperfect, and lower confidence when uncertain. Return alignment geometry as numbers from 0 to 1000 relative to the displayed image: a tight top/left/bottom/right rectangle around the entire visible person; headTop at the top-center of the hair or scalp; waistCenter at the center of the upper edge of the shorts or pants; and torsoCenterX at the horizontal center of the chest and abdomen, explicitly ignoring extended arms. Use visible clothing boundaries and image edges when cropped. Exclude background objects and shadows. Do not identify the person. Do not describe, rate, or infer their body, health, weight, attractiveness, age, ethnicity, or any other sensitive trait. The reason must mention only camera orientation and arm position.',
        },
        {
          inlineData: {
            mimeType: image.mimetype,
            data: image.buffer.toString('base64'),
          },
        },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: progressSchema,
      temperature: 0,
    },
  };

  let finalError = 'Gemini could not classify this progress photo.';
  for (const key of getRotatingKeys(keys)) {
    try {
      const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await geminiResponse.json() as {
        error?: { message?: string; status?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      if (!geminiResponse.ok) {
        finalError = payload.error?.message || finalError;
        if (shouldRetry(geminiResponse.status, payload.error?.status)) {
          cooldownKey(key, geminiResponse.status);
          continue;
        }
        break;
      }

      const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
      if (!text) {
        finalError = 'Gemini returned an empty classification. Try a clearer photo.';
        continue;
      }
      const result = JSON.parse(text) as { category?: string; confidence?: string; reason?: string; alignment?: unknown };
      const alignment = normalizeProgressAlignment(result.alignment);
      if (!progressCategories.includes(result.category as ProgressCategory)
        || !['low', 'medium', 'high'].includes(result.confidence || '')
        || !result.reason
        || !alignment) {
        finalError = 'Gemini returned an invalid pose classification.';
        continue;
      }
      keyCooldowns.delete(key);
      return {
        category: result.category as ProgressCategory,
        confidence: result.confidence as 'low' | 'medium' | 'high',
        reason: result.reason.slice(0, 180),
        alignment,
      };
    } catch (error) {
      cooldownKey(key, 503);
      finalError = error instanceof Error ? error.message : finalError;
    }
  }

  throw new Error(finalError);
}

async function measureProgressSymmetry(image: Pick<Express.Multer.File, 'buffer' | 'mimetype'>) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the local env file.');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Locate visual alignment landmarks in this front-facing progress photo. Return coordinates from 0 to 1000 relative to the complete image. All left/right names mean the left and right sides of the displayed image, not anatomical left/right. Place imageLeftShoulder and imageRightShoulder at the comparable acromion/outer shoulder-joint height, not the top of the trapezius or clothing. imageLeftHip and imageRightHip are the hip-joint centers at matching height. imageLeftEar and imageRightEar are the tragion points: the small notch immediately in front of each ear where the ear meets the face. chin is the soft-tissue menton, the lowest central point of the chin contour. headCenter is the visual center of the face between the eyes. neckCenter is the center at the base of the neck between the shoulders. torsoCenter is the center of the torso at the hip-line height; if the hips are cropped, estimate all hip points at the lowest visible torso boundary. Use only visible geometry, and do not infer or report identity, health, attractiveness, ethnicity, age, weight, a diagnosis, or any other sensitive trait.',
        },
        {
          inlineData: {
            mimeType: image.mimetype,
            data: image.buffer.toString('base64'),
          },
        },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: progressSymmetrySchema,
      temperature: 0,
    },
  };

  let finalError = 'Could not measure symmetry in this photo.';
  for (const key of getRotatingKeys(keys)) {
    try {
      const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await geminiResponse.json() as {
        error?: { message?: string; status?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      if (!geminiResponse.ok) {
        finalError = payload.error?.message || finalError;
        if (shouldRetry(geminiResponse.status, payload.error?.status)) {
          cooldownKey(key, geminiResponse.status);
          continue;
        }
        break;
      }
      const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
      if (!text) {
        finalError = 'The measurement returned no landmarks. Try a clearer front-facing photo.';
        continue;
      }
      const symmetry = normalizeProgressSymmetry(JSON.parse(text));
      if (!symmetry) {
        finalError = 'The required alignment landmarks could not all be located clearly.';
        continue;
      }
      keyCooldowns.delete(key);
      return symmetry;
    } catch (error) {
      cooldownKey(key, 503);
      finalError = error instanceof Error ? error.message : finalError;
    }
  }

  throw new Error(finalError);
}

async function measureProgressSideAlignment(image: Pick<Express.Multer.File, 'buffer' | 'mimetype'>) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the local env file.');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Locate sagittal posture landmarks in this side-profile progress photo. Return coordinates from 0 to 1000 relative to the complete image. facing is image-left or image-right based on the direction the face points. Use the visible side closest to the camera. ear is the external ear canal center; shoulder is the acromion/outer shoulder-joint center; hip is the greater-trochanter hip-joint center; knee is the lateral knee-joint center; ankle is the lateral ankle-joint center. Estimate an obscured joint only from immediately surrounding visible anatomy, but keep every point on the same side of the body. Use only visual geometry. Do not infer or report identity, health, attractiveness, ethnicity, age, weight, a diagnosis, or any other sensitive trait.',
        },
        {
          inlineData: {
            mimeType: image.mimetype,
            data: image.buffer.toString('base64'),
          },
        },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: progressSideAlignmentSchema,
      temperature: 0,
    },
  };

  let finalError = 'Could not measure sagittal alignment in this photo.';
  for (const key of getRotatingKeys(keys)) {
    try {
      const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await geminiResponse.json() as {
        error?: { message?: string; status?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      if (!geminiResponse.ok) {
        finalError = payload.error?.message || finalError;
        if (shouldRetry(geminiResponse.status, payload.error?.status)) {
          cooldownKey(key, geminiResponse.status);
          continue;
        }
        break;
      }
      const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
      if (!text) {
        finalError = 'The measurement returned no landmarks. Try a clearer full-body side photo.';
        continue;
      }
      const sideAlignment = normalizeProgressSideAlignment(JSON.parse(text));
      if (!sideAlignment) {
        finalError = 'The ear, shoulder, hip, knee, and ankle could not all be located clearly.';
        continue;
      }
      keyCooldowns.delete(key);
      return sideAlignment;
    } catch (error) {
      cooldownKey(key, 503);
      finalError = error instanceof Error ? error.message : finalError;
    }
  }

  throw new Error(finalError);
}

ensureProgressStorage();

app.get('/api/progress', (_request, response) => {
  response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const photos = readProgressPhotos()
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.uploadedAt.localeCompare(a.uploadedAt))
      .map(publicProgressPhoto);
    response.json({ photos });
  } catch {
    response.status(500).json({ error: 'Could not read progress photos.' });
  }
});

app.post('/api/progress', upload.single('image'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'Choose a progress photo to upload.' });
    return;
  }

  const date = String(request.body?.capturedAt || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T12:00:00').getTime())) {
    response.status(400).json({ error: 'Choose a valid date for this photo.' });
    return;
  }

  try {
    const classification = await classifyProgressPhoto(request.file);
    const filename = Date.now() + '-' + randomUUID() + extensionForMime(request.file.mimetype);
    const destination = path.join(progressRoot, classification.category, filename);
    fs.writeFileSync(destination, request.file.buffer);

    const photo: ProgressPhotoRecord = {
      id: randomUUID(),
      capturedAt: date,
      uploadedAt: new Date().toISOString(),
      filename,
      ...classification,
    };

    try {
      writeProgressPhotos([photo, ...readProgressPhotos()]);
    } catch (writeError) {
      fs.unlinkSync(destination);
      throw writeError;
    }
    response.status(201).json(publicProgressPhoto(photo));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Could not sort this progress photo.' });
  }
});

app.post('/api/progress/:id/alignment', async (request, response) => {
  try {
    const photos = readProgressPhotos();
    const index = photos.findIndex((photo) => photo.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: 'Progress photo not found.' });
      return;
    }

    const photo = photos[index];
    const imagePath = path.join(progressRoot, photo.category, photo.filename);
    const extension = path.extname(photo.filename).toLowerCase();
    const mimetype = ({
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
    } as Record<string, string>)[extension] || 'image/jpeg';
    const classification = await classifyProgressPhoto({ buffer: fs.readFileSync(imagePath), mimetype });
    photos[index] = { ...photo, alignment: classification.alignment };
    writeProgressPhotos(photos);
    response.json(publicProgressPhoto(photos[index]));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Could not align this progress photo.' });
  }
});

app.post('/api/progress/:id/symmetry', async (request, response) => {
  try {
    const photos = readProgressPhotos();
    const index = photos.findIndex((photo) => photo.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: 'Progress photo not found.' });
      return;
    }

    const photo = photos[index];
    const imagePath = path.join(progressRoot, photo.category, photo.filename);
    const extension = path.extname(photo.filename).toLowerCase();
    const mimetype = ({
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
    } as Record<string, string>)[extension] || 'image/jpeg';
    const image = { buffer: fs.readFileSync(imagePath), mimetype };
    if (photo.category === 'side') {
      const sideAlignment = await measureProgressSideAlignment(image);
      photos[index] = { ...photo, sideAlignment };
    } else {
      const symmetry = await measureProgressSymmetry(image);
      photos[index] = { ...photo, symmetry };
    }
    writeProgressPhotos(photos);
    response.json(publicProgressPhoto(photos[index]));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Could not measure symmetry in this photo.' });
  }
});

app.patch('/api/progress/:id/measurements', express.json(), (request, response) => {
  try {
    const photos = readProgressPhotos();
    const index = photos.findIndex((photo) => photo.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: 'Progress photo not found.' });
      return;
    }

    const photo = photos[index];
    if (photo.category === 'side') {
      const sideAlignment = validateStoredProgressSideAlignment(request.body?.sideAlignment);
      if (!sideAlignment) {
        response.status(400).json({ error: 'The adjusted side-profile landmarks are invalid.' });
        return;
      }
      photos[index] = { ...photo, sideAlignment };
    } else {
      const symmetry = validateStoredProgressSymmetry(request.body?.symmetry);
      if (!symmetry) {
        response.status(400).json({ error: 'The adjusted front-view landmarks are invalid.' });
        return;
      }
      photos[index] = { ...photo, symmetry };
    }
    writeProgressPhotos(photos);
    response.json(publicProgressPhoto(photos[index]));
  } catch {
    response.status(500).json({ error: 'Could not save the measurement adjustment.' });
  }
});

app.patch('/api/progress/:id', express.json(), (request, response) => {
  const category = request.body?.category as ProgressCategory;
  if (!progressCategories.includes(category)) {
    response.status(400).json({ error: 'Choose a valid progress folder.' });
    return;
  }

  try {
    const photos = readProgressPhotos();
    const index = photos.findIndex((photo) => photo.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: 'Progress photo not found.' });
      return;
    }

    const current = photos[index];
    if (current.category !== category) {
      fs.renameSync(path.join(progressRoot, current.category, current.filename), path.join(progressRoot, category, current.filename));
      photos[index] = { ...current, category };
      writeProgressPhotos(photos);
    }
    response.json(publicProgressPhoto(photos[index]));
  } catch {
    response.status(500).json({ error: 'Could not move this progress photo.' });
  }
});

app.delete('/api/progress/:id', (request, response) => {
  try {
    const photos = readProgressPhotos();
    const photo = photos.find((item) => item.id === request.params.id);
    if (!photo) {
      response.status(404).json({ error: 'Progress photo not found.' });
      return;
    }

    const imagePath = path.join(progressRoot, photo.category, photo.filename);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    writeProgressPhotos(photos.filter((item) => item.id !== photo.id));
    response.json({ ok: true });
  } catch {
    response.status(500).json({ error: 'Could not delete this progress photo.' });
  }
});

app.get('/api/progress/images/:category/:filename', (request, response) => {
  const category = request.params.category as ProgressCategory;
  const filename = path.basename(request.params.filename);
  if (!progressCategories.includes(category) || filename !== request.params.filename) {
    response.status(404).end();
    return;
  }

  const photo = readProgressPhotos().find((item) => item.category === category && item.filename === filename);
  if (!photo) {
    response.status(404).end();
    return;
  }
  response.setHeader('Cache-Control', 'private, max-age=604800');
  response.sendFile(path.join(progressRoot, category, filename));
});

const currentFile = fileURLToPath(import.meta.url);
const dist = path.resolve(path.dirname(currentFile), '../dist');
app.use(express.static(dist));
app.get('*', (_request, response) => response.sendFile(path.join(dist, 'index.html')));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'That image is too large. Choose one under 8 MB.' });
    return;
  }
  response.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Nourish API listening on http://${HOST}:${PORT}`);
});
