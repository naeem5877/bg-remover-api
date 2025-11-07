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
const API_KEY = process.env.API_KEY; // Set in Render!

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
    }
})

// Model cache in Render's /tmp
const MODEL_PATH = path.join(os.tmpdir(), 'imgly-models');
if (!fs.existsSync(MODEL_PATH)) {
    fs.mkdirSync(MODEL_PATH, { recursive: true });
    console.log('Model cache created:', MODEL_PATH);
}

// CRITICAL: Use file:// URI format with trailing slash!
const PUBLIC_PATH_URI = `file://${MODEL_PATH.replace(/\\/g, '/')}/`; // Works on Linux & Windows

// Home
app.get('/', (req, res) => {
    res.json({
        message: 'BG Remover API - FIXED for Render Free Tier',
        status: 'online',
        tip: 'POST /remove-bg + Authorization: Bearer YOUR_KEY'
    });
});

// Health
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// Main endpoint
app.post('/remove-bg', upload.single('image'), async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    console.log(`Processing: ${req.file.originalname} (${req.file.mimetype})`);

    let inputBuffer;
    try {
        inputBuffer = await sharp(req.file.buffer)
            .rotate()
            .png({ quality: 95 })
            .toBuffer();
    } catch (err) {
        return res.status(400).json({ error: 'Invalid/corrupted image' });
    }

    try {
        console.log('Loading AI model (first run downloads ~300MB to /tmp)...');
        const resultBlob = await removeBackground(inputBuffer, {
            model: 'medium',
            publicPath: PUBLIC_PATH_URI, // ← THIS FIXES THE URI ERROR
            debug: true,
            progress: (key, current, total) => {
                console.log(`Downloading ${key}: ${Math.round((current / total) * 100)}%`);
            }
        });

        const outputBuffer = Buffer.from(await resultBlob.arrayBuffer());

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="nobg_${req.file.originalname}"`);
        res.send(outputBuffer);

        console.log('Success! Background removed.');
    } catch (err) {
        console.error('AI Error:', err);
        res.status(500).json({
            error: 'Background removal failed',
            details: err.message
        });
    }
});

// 404
app.use('*', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on https://your-app.onrender.com:${PORT}`);
    console.log(`Model URI: ${PUBLIC_PATH_URI}`);
    console.log(`API_KEY required: ${API_KEY === 'your-secret-key-123' ? 'SET IT IN RENDER!' : 'OK'}`);
});
