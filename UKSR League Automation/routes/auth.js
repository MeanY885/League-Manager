const express = require('express');
const { authenticateWithIRacing } = require('../utils/iracing-api');

const router = express.Router();

// Authentication endpoint with new hashed password method
router.post('/', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        console.log(`Authentication attempt for user: ${username}`);

        // Authenticate with iRacing
        const authCookie = await authenticateWithIRacing(username, password);

        // Store the auth cookie in session
        req.session.authCookie = authCookie;
        req.session.username = username;

        console.log('Authentication successful');
        res.json({ 
            success: true, 
            message: 'Authentication successful',
            username: username
        });

    } catch (error) {
        console.error('Authentication error:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        
        res.status(401).json({ 
            error: error.response?.status === 401 ? 
                'Invalid username or password' : 
                'Authentication failed'
        });
    }
});

// Check authentication status
router.get('/status', (req, res) => {
    if (req.session.authCookie && req.session.username) {
        res.json({ 
            authenticated: true, 
            username: req.session.username 
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Logout endpoint
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

module.exports = router; 