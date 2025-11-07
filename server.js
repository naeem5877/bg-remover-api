const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { removeBackground } = require('@imgly/background-removal-node');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads (store in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Background Remover API - Node.js',
        status: 'online',
        endpoints: {
            health: '/health',
            removeBackground: '/remove-bg (POST)'
        }
    });
});

// Health check route
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'background-remover' });
});

// Remove background route
app.post('/remove-bg', upload.single('image'), async (req, res) => {
    try {
        // Check API key
        const authHeader = req.headers.authorization || '';
        const providedKey = authHeader.replace('Bearer ', '').trim();
        
        if (providedKey !== API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check if image exists
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided' });
        }

        console.log('Processing image:', req.file.originalname);

        // Remove background
        const blob = await removeBackground(req.file.buffer);
        
        // Convert Blob to buffer
        const buffer = Buffer.from(await blob.arrayBuffer());

        // Set response headers
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'attachment; filename="removed_bg.png"');
        
        // Send the image
        res.send(buffer);

        console.log('Background removed successfully');

    } catch (error) {
        console.error('Error removing background:', error);
        res.status(500).json({ 
            error: 'Processing failed', 
            message: error.message 
        });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
