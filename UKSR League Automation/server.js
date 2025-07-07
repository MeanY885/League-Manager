const express = require('express');
const session = require('express-session');
const path = require('path');

// Import configuration and utilities
const { initializeDatabase, closeDatabase } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const leagueRoutes = require('./routes/league');
const resultsRoutes = require('./routes/results');
const pointsConfigRoutes = require('./routes/points-config');
const penaltiesRoutes = require('./routes/penalties');
const championshipRoutes = require('./routes/championship');
const cacheRoutes = require('./routes/cache');
const classRoutes = require('./routes/classes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize database
const db = initializeDatabase();

// Make database available to routes
app.locals.db = db;

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/league', leagueRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/league', pointsConfigRoutes);
app.use('/api/league', penaltiesRoutes);
app.use('/api/league', championshipRoutes);
app.use('/api/league', cacheRoutes);
app.use('/api/league', classRoutes);

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve debug page
app.get('/debug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'debug.html'));
});

// Serve championship widget pages
app.get('/widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'widget-demo.html'));
});

app.get('/championship-widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'championship-widget.html'));
});

app.get('/publish-widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'widget-publisher.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    closeDatabase();
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📂 Database: ${db ? 'SQLite enabled' : 'In-memory fallback'}`);
}); 