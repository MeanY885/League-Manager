const { getDatabase } = require('../config/database');

// In-memory storage for penalties (fallback)
const leaguePenalties = {}; // Format: { leagueId: { seasonId: { subsessionId: { custId: penaltyPoints } } } }

function getPenalties(leagueId, seasonId) {
    const db = getDatabase();
    
    if (db) {
        try {
            const rows = db.prepare('SELECT * FROM penalties WHERE league_id = ? AND season_id = ?').all(leagueId, seasonId);
            
            // Convert to nested object format
            const penalties = {};
            rows.forEach(row => {
                if (!penalties[row.subsession_id]) {
                    penalties[row.subsession_id] = {};
                }
                penalties[row.subsession_id][row.cust_id] = {
                    points: row.penalty_points,
                    reason: row.reason || '',
                    timestamp: row.created_at
                };
            });
            return penalties;
        } catch (error) {
            console.error('Database error, falling back to in-memory:', error);
        }
    }
    
    // Fallback to in-memory
    return leaguePenalties[leagueId]?.[seasonId] || {};
}

function savePenalty(leagueId, seasonId, subsessionId, custId, penaltyPoints, reason) {
    const db = getDatabase();
    
    if (db) {
        try {
            const stmt = db.prepare(`INSERT OR REPLACE INTO penalties 
                 (league_id, season_id, subsession_id, cust_id, penalty_points, reason) 
                 VALUES (?, ?, ?, ?, ?, ?)`);
            
            stmt.run(leagueId, seasonId, subsessionId, custId, penaltyPoints, reason);
            console.log('💾 Penalty saved to database');
        } catch (error) {
            console.error('Database save error, falling back to in-memory:', error);
        }
    }
    
    // Always save to in-memory as backup
    if (!leaguePenalties[leagueId]) {
        leaguePenalties[leagueId] = {};
    }
    if (!leaguePenalties[leagueId][seasonId]) {
        leaguePenalties[leagueId][seasonId] = {};
    }
    if (!leaguePenalties[leagueId][seasonId][subsessionId]) {
        leaguePenalties[leagueId][seasonId][subsessionId] = {};
    }
    
    leaguePenalties[leagueId][seasonId][subsessionId][custId] = {
        points: penaltyPoints,
        reason: reason || '',
        timestamp: new Date().toISOString()
    };
}

function deletePenalty(leagueId, seasonId, subsessionId, custId) {
    const db = getDatabase();
    
    if (db) {
        try {
            const stmt = db.prepare('DELETE FROM penalties WHERE league_id = ? AND season_id = ? AND subsession_id = ? AND cust_id = ?');
            stmt.run(leagueId, seasonId, subsessionId, custId);
            console.log('🗑️ Penalty deleted from database');
        } catch (error) {
            console.error('Database delete error, falling back to in-memory:', error);
        }
    }
    
    // Always delete from in-memory
    if (leaguePenalties[leagueId]?.[seasonId]?.[subsessionId]?.[custId]) {
        delete leaguePenalties[leagueId][seasonId][subsessionId][custId];
        
        // Clean up empty objects
        if (Object.keys(leaguePenalties[leagueId][seasonId][subsessionId]).length === 0) {
            delete leaguePenalties[leagueId][seasonId][subsessionId];
        }
    }
}

module.exports = {
    getPenalties,
    savePenalty,
    deletePenalty
}; 