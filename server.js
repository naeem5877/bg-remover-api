const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { removeBackground, downloadModels } = require('@imgly/background-removal-node');
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || 'demo-key-123';

// ==================== CRITICAL: PRE-DOWNLOAD MODELS ====================
const MODEL_DIR = path.join(os.tmpdir(), 'imgly-models');
const PUBLIC_PATH_URI = `file://${MODEL_DIR.replace(/\\/g, '/')}/`;

async function ensureModels() {
    try {
        await fs.access(MODEL_DIR);
        console.log('Models already exist in /tmp');
    } catch {
        console.log('Models not found. Downloading ~300MB (this runs once)...');
        await fs.mkdir(MODEL_DIR, { recursive: true });

        // This forces download of ALL model files + resources.json
        await downloadModels({
            publicPath: PUBLIC_PATH_URI,
            model: 'medium',
            progress: (key, current, total) => {
                const percent = ((current / total) * 100).toFixed(1);
                console.log(`Downloading ${key}: ${percent}%`);
            }
        });

        console.log('All model files downloaded successfully!');
        console.log('Location:', MODEL_DIR);
    }
}

// Run on startup (Render cold start)
ensureModels().catch(err => {
    console.error('Failed to download models:', err);
    process.exit(1);
});

// ==================== EXPRESS SETUP ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file'));
    }
});

// ==================== ROUTES ====================
app.get('/', (req, res) => {
    res.json({
        message: 'Background Remover API – 100% Working on Render Free',
        status: 'online',
        endpoint: 'POST /remove-bg',
        auth: 'Bearer YOUR_API_KEY',
        tip: 'First request after deploy takes 30–60s (model download)'
    });
});

app.get('/health', (req, res) => res.json({ status: 'healthy', models: 'ready' }));

app.post('/remove-bg', upload.single('image'), async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    console.log(`Processing: ${req.file.originalname} (${req.file.mimetype})`);

    let inputBuffer;
    try {
        inputBuffer = await sharp(req.file.buffer)
            .rotate()
            .png({ quality: 95 })
            .toBuffer();
    } catch (err) {
        return res.status(400).json({ error: 'Invalid image', details: err.message });
    }

    try {
        console.log('Running background removal...');
        const resultBlob = await removeBackground(inputBuffer, {
            model: 'medium',
            publicPath: PUBLIC_PATH_URI,
            debug: false
        });

        const outputBuffer = Buffer.from(await resultBlob.arrayBuffer());

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="nobg_${Date.now()}.png"`);
        res.send(outputBuffer);

        console.log('Success! Background removed');
    } catch (err) {
        console.error('AI Error:', err.message);
        res.status(500).json({
            error: 'Removal failed',
            message: err.message,
            tip: 'Try a clearer photo of a person/object'
        });
    }
});

app.use('*', (req, res) => res.status(404).json({ error: 'Not found' }));

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server LIVE on port ${PORT}`);
    console.log(`URL: https://your-app.onrender.com`);
    console.log(`Model path: ${MODEL_DIR}`);
    console.log(`API_KEY: ${API_KEY === 'demo-key-123' ? 'SET IN RENDER ENV!' : 'OK'}`);
});
