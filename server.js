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
const API_KEY = process.env.API_KEY; // Change in Render env vars!

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Multer: Store in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PNG, JPG, JPEG, WebP allowed.'));
        }
    }
});

// Pre-download model to /tmp (Render allows writing here)
const MODEL_PATH = path.join(os.tmpdir(), 'background-removal-model');
if (!fs.existsSync(MODEL_PATH)) {
    fs.mkdirSync(MODEL_PATH, { recursive: true });
}

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Background Remover API - Fixed & Render Ready',
        status: 'online',
        usage: 'POST /remove-bg with image file + Authorization: Bearer YOUR_KEY',
        tip: 'Set API_KEY in Render Environment Variables'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main endpoint
app.post('/remove-bg', upload.single('image'), async (req, res) => {
    // === 1. Auth Check ===
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized', tip: 'Use Bearer YOUR_API_KEY' });
    }

    // === 2. File Check ===
    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded', field: 'image' });
    }

    console.log(`Processing: ${req.file.originalname} | ${req.file.mimetype} | ${(req.file.size / 1024).toFixed(1)} KB`);

    let processedBuffer;

    // === 3. Validate & Convert with Sharp ===
    try {
        processedBuffer = await sharp(req.file.buffer)
            .rotate() // Fix EXIF rotation
            .flatten({ background: { r: 255, g: 255, b: 255 } }) // Remove alpha issues
            .png({ quality: 95, compressionLevel: 6 })
            .toBuffer();
    } catch (err) {
        console.error('Sharp failed:', err.message);
        return res.status(400).json({
            error: 'Invalid or corrupted image',
            details: 'File could not be processed. Try a different image.'
        });
    }

    // === 4. Remove Background ===
    try {
        console.log('Running AI model...');
        const resultBlob = await removeBackground(processedBuffer, {
            model: "medium",
            publicPath: MODEL_PATH, // Critical for Render!
            debug: false
        });

        const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

        // === 5. Send Result ===
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="nobg_${req.file.originalname.replace(/\.[^/.]+$/, '')}.png"`);
        res.setHeader('X-Processed-By', 'img.ly + Sharp');
        res.send(resultBuffer);

        console.log('Success! Background removed.');
    } catch (err) {
        console.error('Background removal failed:', err.message);
        res.status(500).json({
            error: 'AI processing failed',
            message: err.message,
            tip: 'Try a simpler image (person/object on solid background)'
        });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server LIVE on port ${PORT}`);
    console.log(`Free Render URL: https://your-service.onrender.com`);
    console.log(`Model cache: ${MODEL_PATH}`);
    if (API_KEY === 'your-secret-key-123') {
        console.log('WARNING: Set API_KEY in Render > Environment Variables!');
    }
});
