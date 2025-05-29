const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { DEFAULT_POINTS_CONFIGS, getPointsConfig, savePointsConfig } = require('../utils/points-config');

const router = express.Router();

// Points configuration endpoints
router.get('/:leagueId/points-config', requireAuth, async (req, res) => {
    try {
        const { leagueId } = req.params;
        
        // Get config using hybrid approach (database with fallback)
        const config = getPointsConfig(leagueId);
        
        res.json({
            config: config,
            presets: DEFAULT_POINTS_CONFIGS
        });
        
    } catch (error) {
        console.error('Points config error:', error);
        res.status(500).json({ error: 'Failed to load points configuration' });
    }
});

router.post('/:leagueId/points-config', requireAuth, async (req, res) => {
    try {
        const { leagueId } = req.params;
        const { name, points, dropWeeks, fastestLapPoints, polePositionPoints } = req.body;
        
        if (!name || !points) {
            return res.status(400).json({ error: 'Name and points configuration are required' });
        }
        
        // Validate dropWeeks
        const dropWeeksValue = parseInt(dropWeeks) || 0;
        if (dropWeeksValue < 0) {
            return res.status(400).json({ error: 'Drop weeks cannot be negative' });
        }
        
        // Validate fastestLapPoints
        const fastestLapPointsValue = parseInt(fastestLapPoints) || 0;
        if (fastestLapPointsValue < 0) {
            return res.status(400).json({ error: 'Fastest lap points cannot be negative' });
        }
        
        // Validate polePositionPoints
        const polePositionPointsValue = parseInt(polePositionPoints) || 0;
        if (polePositionPointsValue < 0) {
            return res.status(400).json({ error: 'Pole position points cannot be negative' });
        }
        
        // Validate points object
        const pointsEntries = Object.entries(points);
        if (pointsEntries.length === 0) {
            return res.status(400).json({ error: 'Points configuration cannot be empty' });
        }
        
        // Ensure all positions are numbers and all points are numbers
        const validatedPoints = {};
        for (const [position, pointValue] of pointsEntries) {
            const pos = parseInt(position);
            const pts = parseInt(pointValue);
            
            if (isNaN(pos) || isNaN(pts) || pos < 1) {
                return res.status(400).json({ error: 'Invalid position or points value' });
            }
            
            validatedPoints[pos] = pts;
        }
        
        // Save configuration using hybrid approach
        const config = {
            name: name,
            points: validatedPoints,
            dropWeeks: dropWeeksValue,
            fastestLapPoints: fastestLapPointsValue,
            polePositionPoints: polePositionPointsValue
        };
        
        savePointsConfig(leagueId, config);
        
        console.log(`💾 Saved points config for league ${leagueId}: ${name} (Drop weeks: ${dropWeeksValue}, Fastest lap: ${fastestLapPointsValue}pts, Pole: ${polePositionPointsValue}pts)`);
        
        res.json({ success: true, config: config });
        
    } catch (error) {
        console.error('Save points config error:', error);
        res.status(500).json({ error: 'Failed to save points configuration' });
    }
});

module.exports = router; 