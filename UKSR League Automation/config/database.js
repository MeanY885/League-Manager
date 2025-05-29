const Database = require('better-sqlite3');

let db;

// Initialize SQLite database
function initializeDatabase() {
    try {
        db = new Database('./data/league_data.db');
        console.log('✅ Connected to SQLite database');
        createTables();
        return db;
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.log('📝 Falling back to in-memory storage');
        return null;
    }
}

// Create database tables
function createTables() {
    if (!db) return;
    
    try {
        // Points configurations table
        db.exec(`CREATE TABLE IF NOT EXISTS points_configs (
            league_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            points TEXT NOT NULL,
            drop_weeks INTEGER DEFAULT 0,
            fastest_lap_points INTEGER DEFAULT 0,
            pole_position_points INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Penalties table
        db.exec(`CREATE TABLE IF NOT EXISTS penalties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_id TEXT NOT NULL,
            subsession_id TEXT NOT NULL,
            cust_id TEXT NOT NULL,
            penalty_points INTEGER NOT NULL,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(league_id, season_id, subsession_id, cust_id)
        )`);

        // Cached data table
        db.exec(`CREATE TABLE IF NOT EXISTS cached_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_id TEXT,
            data_type TEXT NOT NULL,
            data_key TEXT,
            data TEXT NOT NULL,
            cached_at DATETIME NOT NULL,
            UNIQUE(league_id, season_id, data_type, data_key)
        )`);

        // Classes table for storing custom class definitions
        db.exec(`CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(league_id, name)
        )`);

        // Driver class changes table for tracking class reassignments
        db.exec(`CREATE TABLE IF NOT EXISTS driver_class_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            cust_id TEXT NOT NULL,
            old_class TEXT,
            new_class TEXT NOT NULL,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Driver class assignments table for multiple class assignments per driver (tagging system)
        db.exec(`CREATE TABLE IF NOT EXISTS driver_class_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            cust_id TEXT NOT NULL,
            class_name TEXT NOT NULL,
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(league_id, cust_id, class_name)
        )`);

        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('❌ Database table creation failed:', error);
    }
}

function getDatabase() {
    return db;
}

function closeDatabase() {
    if (db) {
        db.close();
        console.log('Database connection closed.');
    }
}

module.exports = {
    initializeDatabase,
    getDatabase,
    closeDatabase
}; 