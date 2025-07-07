const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { fetchIRacingData } = require('../utils/iracing-api');

// Cache season data
router.post('/:leagueId/season/:seasonId/cache', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;

        console.log(`Caching data for league ${leagueId}, season ${seasonId}`);
        
        // Get database connection
        const db = req.app.locals.db;
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }

        const now = new Date().toISOString();
        
        // Cache roster
        try {
            const rosterData = await fetchIRacingData(`/data/league/get?league_id=${leagueId}&include_roster=1`, req.session.authCookie);
            if (rosterData && rosterData.roster) {
                // Filter roster data like in the league route
                const filteredRoster = rosterData.roster.map(member => ({
                    cust_id: member.cust_id || null,
                    display_name: member.display_name || null,
                    car_number: member.car_number || null,
                    nick_name: member.nick_name || null
                }));
                
                const rosterResponse = { 
                    roster: filteredRoster,
                    count: filteredRoster.length
                };
                
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO cached_data 
                    (league_id, season_id, data_type, data, cached_at) 
                    VALUES (?, ?, ?, ?, ?)
                `);
                stmt.run(leagueId, null, 'roster', JSON.stringify(rosterResponse), now);
                console.log('Cached roster data');
            }
        } catch (error) {
            console.error('Error caching roster:', error);
        }

        // Cache season sessions
        try {
            const sessionsData = await fetchIRacingData(`/data/league/season_sessions?league_id=${leagueId}&season_id=${seasonId}`, req.session.authCookie);
            if (sessionsData && sessionsData.sessions) {
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO cached_data 
                    (league_id, season_id, data_type, data, cached_at) 
                    VALUES (?, ?, ?, ?, ?)
                `);
                stmt.run(leagueId, seasonId, 'sessions', JSON.stringify(sessionsData), now);
                console.log('Cached sessions data');
                
                // Cache individual session results for past sessions only
                for (const session of sessionsData.sessions) {
                    if (session.subsession_id) {
                        // Only cache past sessions
                        const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                           session.start_time ? new Date(session.start_time) : null;
                        if (!sessionDate || sessionDate > new Date()) continue;
                        
                        try {
                            const resultData = await fetchIRacingData(`/data/results/get?subsession_id=${session.subsession_id}`, req.session.authCookie);
                            if (resultData) {
                                const resultStmt = db.prepare(`
                                    INSERT OR REPLACE INTO cached_data 
                                    (league_id, season_id, data_type, data_key, data, cached_at) 
                                    VALUES (?, ?, ?, ?, ?, ?)
                                `);
                                resultStmt.run(leagueId, seasonId, 'session_result', session.subsession_id.toString(), JSON.stringify(resultData), now);
                            }
                        } catch (error) {
                            console.error(`Error caching session ${session.subsession_id}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error caching sessions:', error);
        }

        // Cache championship standings by calling the championship route internally
        try {
            // Make internal request to championship endpoint to get calculated standings
            // Force fresh calculation by not using cached=true parameter
            const championshipResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/league/${leagueId}/season/${seasonId}/championship`, {
                headers: {
                    'Cookie': req.headers.cookie || ''
                }
            });
            
            if (championshipResponse.ok) {
                const championshipData = await championshipResponse.json();
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO cached_data 
                    (league_id, season_id, data_type, data, cached_at) 
                    VALUES (?, ?, ?, ?, ?)
                `);
                stmt.run(leagueId, seasonId, 'championship', JSON.stringify(championshipData), now);
                console.log('Cached championship data');
            }
        } catch (error) {
            console.error('Error caching championship:', error);
        }

        res.json({ 
            success: true, 
            message: 'Season data cached successfully',
            cached_at: now
        });

    } catch (error) {
        console.error('Cache error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clear cache for a specific league and season
router.delete('/:leagueId/season/:seasonId/cache', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;

        console.log(`Clearing cache for league ${leagueId}, season ${seasonId}`);
        
        // Get database connection
        const db = req.app.locals.db;
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }

        // Clear all cached data for this league and season
        const stmt = db.prepare(`
            DELETE FROM cached_data 
            WHERE league_id = ? AND (season_id = ? OR season_id IS NULL)
        `);
        const result = stmt.run(leagueId, seasonId);
        
        console.log(`Cleared ${result.changes} cached entries for league ${leagueId}, season ${seasonId}`);

        res.json({ 
            success: true, 
            message: `Cache cleared successfully. Removed ${result.changes} cached entries.`,
            cleared_entries: result.changes
        });

    } catch (error) {
        console.error('Clear cache error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 