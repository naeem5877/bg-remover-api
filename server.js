const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { removeBackground } = require('@imgly/background-removal-node');
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;

// Model directory in /tmp (Render allows this)
const MODEL_DIR = path.join(os.tmpdir(), 'imgly-models');
if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    console.log('Created model directory:', MODEL_DIR);
}

// CRITICAL: Use file:// URI with trailing slash
const PUBLIC_PATH_URI = `file://${MODEL_DIR.replace(/\\/g, '/')}/`;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only PNG, JPG, JPEG, WebP allowed'));
    }
});

// Home
app.get('/', (req, res) => {
    res.json({
        message: 'Background Remover API – 100% WORKING on Render Free',
        status: 'online',
        endpoint: 'POST /remove-bg',
        auth: 'Bearer YOUR_API_KEY',
        note: 'First request after deploy takes 45-90s (downloads 300MB model once)',
        model_path: MODEL_DIR
    });
});

app.get('/health', (req, res) => res.json({ status: 'healthy', models: 'auto-downloaded on first use' }));

// Main endpoint
app.post('/remove-bg', upload.single('image'), async (req, res) => {
    // Auth
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    console.log(`Processing: ${req.file.originalname} (${req.file.mimetype})`);

    // Normalize image
    let inputBuffer;
    try {
        inputBuffer = await sharp(req.file.buffer)
            .rotate()
            .png({ quality: 95, compressionLevel: 6 })
            .toBuffer();
    } catch (err) {
        return res.status(400).json({ error: 'Invalid image', details: err.message });
    }

    try {
        console.log('Loading AI model... (First time: downloads ~300MB to /tmp)');

        const resultBlob = await removeBackground(inputBuffer, {
            model: "medium",
            publicPath: PUBLIC_PATH_URI,
            debug: false,
            progress: (key, current, total) => {
                const pct = ((current / total) * 100).toFixed(1);
                console.log(`Downloading model ${key}: ${pct}%`);
            }
        });

        const outputBuffer = Buffer.from(await resultBlob.arrayBuffer());

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="nobg_${Date.now()}.png"`);
        res.setHeader('X-Model-Path', MODEL_DIR);
        res.send(outputBuffer);

        console.log('Background removed successfully!');
    } catch (err) {
        console.error('AI Error:', err.message);
        res.status(500).json({
            error: 'Background removal failed',
            message: err.message,
            tip: 'Try again in 30s if first request (model still downloading)'
        });
    }
});

app.use('*', (req, res) => res.status(404).json({ error: 'Not found' }));

// Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER LIVE on port ${PORT}`);
    console.log(`URL: https://your-service.onrender.com`);
    console.log(`Model will auto-download to: ${MODEL_DIR}`);
    console.log(`API_KEY set: ${API_KEY === 'demo-key-123' ? 'SET IN RENDER ENV!' : 'OK'}`);
});
