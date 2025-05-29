const { getDatabase } = require('../config/database');

// Default points configurations with drop weeks, fastest lap, and pole position points
const DEFAULT_POINTS_CONFIGS = {
    'standard': {
        name: 'Standard Championship',
        points: { 1: 30, 2: 28, 3: 26, 4: 24, 5: 22, 6: 20, 7: 18, 8: 16, 9: 14, 10: 12, 11: 10, 12: 8, 13: 6, 14: 4, 15: 2 },
        dropWeeks: 2,
        fastestLapPoints: 1,
        polePositionPoints: 1
    },
    'f1_style': {
        name: 'F1 Style',
        points: { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 },
        dropWeeks: 2,
        fastestLapPoints: 1,
        polePositionPoints: 1
    },
    'indycar_style': {
        name: 'IndyCar Style',
        points: { 1: 50, 2: 40, 3: 35, 4: 32, 5: 30, 6: 28, 7: 26, 8: 24, 9: 22, 10: 20, 11: 19, 12: 18, 13: 17, 14: 16, 15: 15, 16: 14, 17: 13, 18: 12, 19: 11, 20: 10 },
        dropWeeks: 1,
        fastestLapPoints: 0,
        polePositionPoints: 1
    },
    'nascar_style': {
        name: 'NASCAR Style',
        points: { 1: 40, 2: 35, 3: 34, 4: 33, 5: 32, 6: 31, 7: 30, 8: 29, 9: 28, 10: 27, 11: 26, 12: 25, 13: 24, 14: 23, 15: 22, 16: 21, 17: 20, 18: 19, 19: 18, 20: 17 },
        dropWeeks: 2,
        fastestLapPoints: 1,
        polePositionPoints: 1
    }
};

// In-memory storage for league points configurations (fallback)
const leaguePointsConfigs = {};

// Database helper functions with fallback to in-memory storage
function getPointsConfig(leagueId) {
    const db = getDatabase();
    
    if (db) {
        try {
            const row = db.prepare('SELECT * FROM points_configs WHERE league_id = ?').get(leagueId);
            if (row) {
                return {
                    name: row.name,
                    points: JSON.parse(row.points),
                    dropWeeks: row.drop_weeks,
                    fastestLapPoints: row.fastest_lap_points,
                    polePositionPoints: row.pole_position_points
                };
            }
        } catch (error) {
            console.error('Database error, falling back to in-memory:', error);
        }
    }
    
    // Fallback to in-memory or default
    return leaguePointsConfigs[leagueId] || {
        name: 'Standard Championship',
        points: { 1: 30, 2: 28, 3: 26, 4: 24, 5: 22, 6: 20, 7: 18, 8: 16, 9: 14, 10: 12, 11: 10, 12: 8, 13: 6, 14: 4, 15: 2 },
        dropWeeks: 2,
        fastestLapPoints: 1,
        polePositionPoints: 1
    };
}

function savePointsConfig(leagueId, config) {
    const db = getDatabase();
    
    if (db) {
        try {
            const stmt = db.prepare(`INSERT OR REPLACE INTO points_configs 
                 (league_id, name, points, drop_weeks, fastest_lap_points, pole_position_points, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
            
            stmt.run(
                leagueId,
                config.name,
                JSON.stringify(config.points),
                config.dropWeeks,
                config.fastestLapPoints,
                config.polePositionPoints
            );
            
            console.log('💾 Points config saved to database');
        } catch (error) {
            console.error('Database save error, falling back to in-memory:', error);
        }
    }
    
    // Always save to in-memory as backup
    leaguePointsConfigs[leagueId] = config;
}

module.exports = {
    DEFAULT_POINTS_CONFIGS,
    getPointsConfig,
    savePointsConfig
}; 