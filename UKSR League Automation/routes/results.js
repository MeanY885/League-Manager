const express = require('express');
const { fetchIRacingData } = require('../utils/iracing-api');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get session results
router.get('/:subsessionId', requireAuth, async (req, res) => {
    try {
        const { subsessionId } = req.params;
        const { include_licenses, cached } = req.query;
        
        // If cached data requested, try to get from database first
        if (cached === 'true') {
            const db = req.app.locals.db;
            if (db) {
                try {
                    const stmt = db.prepare(`
                        SELECT data, cached_at FROM cached_data 
                        WHERE data_type = 'session_result' AND data_key = ? 
                        ORDER BY cached_at DESC LIMIT 1
                    `);
                    const result = stmt.get(subsessionId);
                    
                    if (result) {
                        const data = JSON.parse(result.data);
                        data.last_updated = result.cached_at;
                        console.log(`Returning cached session results for ${subsessionId}`);
                        return res.json(data);
                    }
                } catch (dbError) {
                    console.error('Database error:', dbError);
                }
            }
        }
        
        console.log(`🏆 Getting results for subsession: ${subsessionId}`);
        
        let endpoint = `/data/results/get?subsession_id=${subsessionId}`;
        if (include_licenses === 'true') {
            endpoint += '&include_licenses=true';
        }
        
        const data = await fetchIRacingData(endpoint, req.session.authCookie);
        
        res.json(data);
        
    } catch (error) {
        console.error('Session results error:', error);
        res.status(500).json({ error: 'Failed to load session results' });
    }
});

module.exports = router; 