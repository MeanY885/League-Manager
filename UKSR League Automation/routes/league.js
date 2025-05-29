const express = require('express');
const { fetchIRacingData } = require('../utils/iracing-api');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// League search endpoint
router.get('/search', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        
        if (!search) {
            return res.status(400).json({ error: 'Search term is required' });
        }
        
        console.log(`🔍 Searching for leagues: "${search}"`);
        
        const data = await fetchIRacingData(`/data/league/directory?search=${encodeURIComponent(search)}&tag=all&restrictToMember=true`, req.session.authCookie);
        
        res.json(data);
        
    } catch (error) {
        console.error('League search error:', error);
        res.status(500).json({ error: 'Failed to search leagues' });
    }
});

// Get league information
router.get('/:leagueId', requireAuth, async (req, res) => {
    try {
        const { leagueId } = req.params;
        
        console.log(`📋 Getting league info for: ${leagueId}`);
        
        const data = await fetchIRacingData(`/data/league/get?league_id=${leagueId}`, req.session.authCookie);
        
        res.json(data);
        
    } catch (error) {
        console.error('League info error:', error);
        res.status(500).json({ error: 'Failed to load league information' });
    }
});

// Get league seasons
router.get('/:leagueId/seasons', requireAuth, async (req, res) => {
    try {
        const { leagueId } = req.params;
        
        console.log(`📅 Getting seasons for league: ${leagueId}`);
        
        const data = await fetchIRacingData(`/data/league/seasons?league_id=${leagueId}`, req.session.authCookie);
        
        res.json(data);
        
    } catch (error) {
        console.error('League seasons error:', error);
        res.status(500).json({ error: 'Failed to load league seasons' });
    }
});

// League roster endpoint
router.get('/:leagueId/roster', requireAuth, async (req, res) => {
    try {
        const { leagueId } = req.params;
        const { cached } = req.query;
        
        // If cached data requested, try to get from database first
        if (cached === 'true') {
            const db = req.app.locals.db;
            if (db) {
                try {
                    const stmt = db.prepare(`
                        SELECT data, cached_at FROM cached_data 
                        WHERE league_id = ? AND data_type = 'roster' 
                        ORDER BY cached_at DESC LIMIT 1
                    `);
                    const result = stmt.get(leagueId);
                    
                    if (result) {
                        const data = JSON.parse(result.data);
                        data.last_updated = result.cached_at;
                        console.log(`Returning cached roster for league ${leagueId}`);
                        return res.json(data);
                    }
                } catch (dbError) {
                    console.error('Database error:', dbError);
                }
            }
        }
        
        console.log(`Fetching roster for league ${leagueId}`);
        
        // Use the correct endpoint with include_roster=1
        const leagueData = await fetchIRacingData(`/data/league/get?league_id=${leagueId}&include_roster=1`, req.session.authCookie);
        
        console.log('League data with roster received');
        
        // Extract just the roster with ONLY the required fields
        if (leagueData && leagueData.roster && Array.isArray(leagueData.roster)) {
            const filteredRoster = leagueData.roster.map(member => {
                // Create a new object with ONLY the 4 fields we want
                const cleanMember = {
                    cust_id: member.cust_id || null,
                    display_name: member.display_name || null,
                    car_number: member.car_number || null,
                    nick_name: member.nick_name || null
                };
                return cleanMember;
            });
            
            console.log(`Filtered roster data: ${filteredRoster.length} members`);
            console.log('Sample member data:', filteredRoster[0]); // Log first member to verify
            
            res.json({ 
                roster: filteredRoster,
                count: filteredRoster.length
            });
        } else {
            console.log('No roster data found in response');
            res.json({ 
                roster: [],
                count: 0
            });
        }
        
    } catch (error) {
        console.error('Roster fetch error:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        
        res.status(500).json({ 
            error: 'Failed to fetch league roster',
            details: error.response?.data || error.message
        });
    }
});

// Get season sessions
router.get('/:leagueId/season/:seasonId/sessions', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;
        const { results_only, upcoming, cached } = req.query;
        
        // If cached data requested, try to get from database first
        if (cached === 'true') {
            const db = req.app.locals.db;
            if (db) {
                try {
                    const stmt = db.prepare(`
                        SELECT data, cached_at FROM cached_data 
                        WHERE league_id = ? AND season_id = ? AND data_type = 'sessions' 
                        ORDER BY cached_at DESC LIMIT 1
                    `);
                    const result = stmt.get(leagueId, seasonId);
                    
                    if (result) {
                        const data = JSON.parse(result.data);
                        let sessions = data.sessions || [];
                        
                        // Apply filters
                        if (results_only === 'true') {
                            const now = new Date();
                            sessions = sessions.filter(session => {
                                const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                                   session.start_time ? new Date(session.start_time) : null;
                                return sessionDate && sessionDate < now;
                            });
                        } else if (upcoming === 'true') {
                            const now = new Date();
                            sessions = sessions.filter(session => {
                                const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                                   session.start_time ? new Date(session.start_time) : null;
                                return sessionDate && sessionDate > now;
                            });
                        }
                        
                        console.log(`Returning cached sessions for league ${leagueId}, season ${seasonId}`);
                        return res.json({ 
                            sessions,
                            last_updated: result.cached_at
                        });
                    }
                } catch (dbError) {
                    console.error('Database error:', dbError);
                }
            }
        }
        
        console.log(`🏁 Getting sessions for league: ${leagueId}, season: ${seasonId}`);
        
        const data = await fetchIRacingData(`/data/league/season_sessions?league_id=${leagueId}&season_id=${seasonId}`, req.session.authCookie);
        
        let sessions = data.sessions || [];
        
        // Filter to only past sessions if results_only is true
        if (results_only === 'true') {
            const now = new Date();
            sessions = sessions.filter(session => {
                const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                   session.start_time ? new Date(session.start_time) : null;
                return sessionDate && sessionDate < now;
            });
        } else if (upcoming === 'true') {
            const now = new Date();
            sessions = sessions.filter(session => {
                const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                   session.start_time ? new Date(session.start_time) : null;
                return sessionDate && sessionDate > now;
            });
        }
        
        res.json({ sessions });
        
    } catch (error) {
        console.error('Season sessions error:', error);
        res.status(500).json({ error: 'Failed to load season sessions' });
    }
});

module.exports = router; 