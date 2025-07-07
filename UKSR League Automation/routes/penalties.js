const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Fuse = require('fuse.js');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');
const { getPenalties, savePenalty, deletePenalty } = require('../utils/penalties');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'penalties-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'text/csv' || path.extname(file.originalname).toLowerCase() === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Helper function to clear championship cache when penalties change
function clearChampionshipCache(leagueId, seasonId, db) {
    if (db) {
        try {
            const stmt = db.prepare(`
                DELETE FROM cached_data 
                WHERE league_id = ? AND season_id = ? AND data_type = 'championship'
            `);
            stmt.run(leagueId, seasonId);
            console.log(`🗑️ Cleared championship cache for league ${leagueId}, season ${seasonId} due to penalty change`);
        } catch (error) {
            console.error('Error clearing championship cache:', error);
        }
    }
}

// Helper function to parse CSV content
function parseCSV(csvContent) {
    const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line);
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim().replace(/"/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim().replace(/"/g, ''));
        
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            rows.push({ ...row, lineNumber: i + 1 });
        }
    }
    
    return rows;
}

// Helper function to find best match using fuzzy search
function findBestMatch(query, options, keys, threshold = 0.6) {
    if (!query || !options || options.length === 0) return null;
    
    const fuse = new Fuse(options, {
        keys: keys,
        threshold: threshold,
        includeScore: true
    });
    
    const results = fuse.search(query);
    return results.length > 0 ? results[0].item : null;
}

// Helper function to clean driver names for better matching
function cleanDriverName(name) {
    if (!name) return '';
    return name
        .replace(/[^\w\s]/g, ' ')    // Replace special characters with spaces
        .replace(/\s+/g, ' ')        // Normalize whitespace
        .trim()
        .toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv)\b/g, '') // Remove suffixes
        .replace(/\b(the|von|van|de|da|del|della)\b/g, '') // Remove common prefixes
        .trim();
}

// Helper function to extract penalty points from penalty string
function extractPenaltyPoints(penaltyStr) {
    if (!penaltyStr) return 0;
    
    const lowerPenalty = penaltyStr.toLowerCase();
    
    // Skip warnings
    if (lowerPenalty.includes('warning')) {
        return 0;
    }
    
    // Extract number from penalty string
    const match = penaltyStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

// Helper function to search for track names online
async function searchTrackName(trackName) {
    try {
        const searchQuery = `${trackName} iracing track circuit`;
        const response = await axios.get(`https://api.duckduckgo.com/`, {
            params: {
                q: searchQuery,
                format: 'json',
                no_html: 1,
                skip_disambig: 1
            },
            timeout: 5000
        });
        
        if (response.data && response.data.AbstractText) {
            const abstractText = response.data.AbstractText.toLowerCase();
            // Look for common track name patterns
            const trackPatterns = [
                /(\w+\s+(?:circuit|speedway|raceway|international|motor|park|ring))/gi,
                /(\w+\s+(?:grand prix|gp))/gi
            ];
            
            for (const pattern of trackPatterns) {
                const matches = abstractText.match(pattern);
                if (matches && matches.length > 0) {
                    return matches[0].trim();
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error searching for track name:', error);
        return null;
    }
}

// Enhanced track matching function
async function findTrackMatch(trackName, sessions) {
    console.log(`🔍 Starting track match for: "${trackName}"`);
    console.log(`Available sessions: ${sessions.length}`);
    
    // Log some session examples for debugging
    if (sessions.length > 0) {
        console.log(`Sample session names: ${sessions.slice(0, 3).map(s => s.session_name || s.private_session_name).join(', ')}`);
        console.log(`Sample track names: ${sessions.slice(0, 3).map(s => s.track?.track_name || s.track_name || 'Unknown').join(', ')}`);
    }
    
    // First try direct fuzzy matching with lower threshold
    let match = findBestMatch(trackName, sessions, ['session_name', 'private_session_name', 'track.track_name', 'track_name'], 0.3);
    
    if (match) {
        console.log(`✅ Direct fuzzy match found: ${match.session_name || match.private_session_name}`);
        return match;
    }
    
    // Try matching with common track name variations
    const trackVariations = [
        trackName,
        trackName.toLowerCase(),
        trackName.toUpperCase(),
        `${trackName} Circuit`,
        `${trackName} International`,
        `${trackName} Speedway`,
        `${trackName} Motor Speedway`,
        `${trackName} Raceway`
    ];
    
    for (const variation of trackVariations) {
        match = findBestMatch(variation, sessions, ['session_name', 'private_session_name', 'track.track_name', 'track_name'], 0.3);
        if (match) {
            console.log(`✅ Variation match found with "${variation}": ${match.session_name || match.private_session_name}`);
            return match;
        }
    }
    
    // If no match found, try web search for better track name
    console.log(`🔍 Searching online for track: "${trackName}"`);
    const searchResult = await searchTrackName(trackName);
    
    if (searchResult) {
        console.log(`🌐 Found potential track name: "${searchResult}"`);
        match = findBestMatch(searchResult, sessions, ['session_name', 'private_session_name', 'track.track_name', 'track_name'], 0.3);
        
        if (match) {
            console.log(`✅ Matched "${trackName}" to session via web search`);
            return match;
        }
    }
    
    console.log(`❌ No match found for track: "${trackName}"`);
    return null;
}

// Test route to verify path structure
router.get('/penalties/test', (req, res) => {
    res.json({ message: 'Penalties route is working!' });
});

// CSV Upload route
router.post('/penalties/upload-csv', requireAuth, (req, res, next) => {
    upload.single('csvFile')(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err);
            return res.status(400).json({ error: `File upload error: ${err.message}` });
        }
        next();
    });
}, async (req, res) => {
    console.log('📄 CSV Upload route hit!');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    
    try {
        const { leagueId, seasonId } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }
        
        if (!leagueId || !seasonId) {
            return res.status(400).json({ error: 'League ID and Season ID are required' });
        }
        
        console.log(`📄 Processing CSV upload for league ${leagueId}, season ${seasonId}`);
        
        // Read and parse CSV file
        const csvContent = fs.readFileSync(req.file.path, 'utf8');
        const csvRows = parseCSV(csvContent);
        
        if (csvRows.length === 0) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'CSV file is empty or invalid' });
        }
        
        // Get current season sessions and roster for matching
        const { fetchIRacingData } = require('../utils/iracing-api');
        
        let sessions = [];
        let roster = [];
        
        try {
            // Get sessions
            const sessionsData = await fetchIRacingData(`/data/league/season_sessions?league_id=${leagueId}&season_id=${seasonId}`, req.session.authCookie);
            sessions = sessionsData.sessions || [];
            
            // Get roster - iRacing API returns a data_url that we need to fetch
            const rosterResponse = await fetchIRacingData(`/data/league/roster?league_id=${leagueId}`, req.session.authCookie);
            console.log(`📋 Roster response:`, rosterResponse);
            
            if (rosterResponse.data_url) {
                console.log(`📋 Fetching roster data from: ${rosterResponse.data_url}`);
                const axios = require('axios');
                const rosterDataResponse = await axios.get(rosterResponse.data_url);
                console.log(`📋 Raw roster response:`, JSON.stringify(rosterDataResponse.data, null, 2));
                
                // Try different possible data structures
                if (Array.isArray(rosterDataResponse.data)) {
                    roster = rosterDataResponse.data;
                } else if (rosterDataResponse.data && Array.isArray(rosterDataResponse.data.roster)) {
                    roster = rosterDataResponse.data.roster;
                } else if (rosterDataResponse.data && Array.isArray(rosterDataResponse.data.data)) {
                    roster = rosterDataResponse.data.data;
                } else {
                    console.log(`📋 Unexpected roster data structure:`, rosterDataResponse.data);
                    roster = [];
                }
                
                console.log(`📋 Found ${roster.length} drivers in roster`);
                if (roster.length > 0) {
                    console.log(`Sample drivers: ${roster.slice(0, 5).map(d => d.display_name || d.name || 'Unknown').join(', ')}`);
                }
            } else {
                roster = rosterResponse.roster || [];
                console.log(`📋 Found ${roster.length} drivers in roster (direct)`);
            }
            
        } catch (error) {
            console.error('Error fetching league data:', error);
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: 'Failed to fetch league data for matching' });
        }
        
        // Process each CSV row
        const results = {
            processed: 0,
            skipped: 0,
            errors: []
        };
        
        for (const row of csvRows) {
            try {
                // Extract data from CSV row
                const race = row['Race'] || '';
                const summary = row['Summary'] || '';
                const driverName = row['Driver name'] || row['Driver Name'] || '';
                const infringement = row['Infringement'] || '';
                const penalty = row['Penalty'] || '';
                
                console.log(`Processing line ${row.lineNumber}: Race="${race}", Driver="${driverName}", Penalty="${penalty}"`);
                
                // Skip if essential data is missing
                if (!race || !driverName || !penalty) {
                    results.errors.push({
                        line: row.lineNumber,
                        message: 'Missing required fields (Race, Driver name, or Penalty)'
                    });
                    continue;
                }
                
                // Extract penalty points
                const penaltyPoints = extractPenaltyPoints(penalty);
                console.log(`Extracted penalty points: ${penaltyPoints}`);
                if (penaltyPoints === 0) {
                    console.log(`Skipping line ${row.lineNumber}: Warning or invalid penalty`);
                    results.skipped++;
                    continue; // Skip warnings or invalid penalties
                }
                
                // Find matching session using fuzzy search
                console.log(`Looking for session match for: "${race}"`);
                const sessionMatch = await findTrackMatch(race, sessions);
                
                if (!sessionMatch) {
                    console.log(`❌ No session match found for: "${race}"`);
                    results.errors.push({
                        line: row.lineNumber,
                        message: `Could not find matching session for race: "${race}"`
                    });
                    continue;
                } else {
                    console.log(`✅ Found session match: ${sessionMatch.session_name || sessionMatch.private_session_name} (${sessionMatch.subsession_id})`);
                }
                
                // Find matching driver using simple closest match
                console.log(`Looking for driver match for: "${driverName}"`);
                
                // Safety check - ensure roster is an array
                if (!Array.isArray(roster)) {
                    console.log(`❌ Roster is not an array:`, typeof roster, roster);
                    results.errors.push({
                        line: row.lineNumber,
                        message: `Roster data is not available for matching`
                    });
                    continue;
                }
                
                let bestMatch = null;
                let bestScore = 0;
                
                // Simple matching algorithm - find the closest match
                for (const rosterDriver of roster) {
                    const rosterName = rosterDriver.display_name || rosterDriver.name || '';
                    if (!rosterName) continue;
                    
                    // Calculate similarity score
                    let score = 0;
                    
                    // Exact match (case insensitive) gets highest score
                    if (rosterName.toLowerCase() === driverName.toLowerCase()) {
                        score = 100;
                    } else {
                        // Calculate word-based similarity
                        const csvWords = driverName.toLowerCase().split(/\s+/);
                        const rosterWords = rosterName.toLowerCase().split(/\s+/);
                        
                        let matchingWords = 0;
                        for (const csvWord of csvWords) {
                            for (const rosterWord of rosterWords) {
                                if (csvWord === rosterWord) {
                                    matchingWords += 2; // Exact word match
                                } else if (csvWord.includes(rosterWord) || rosterWord.includes(csvWord)) {
                                    matchingWords += 1; // Partial word match
                                }
                            }
                        }
                        
                        // Score based on percentage of matching words
                        score = (matchingWords / (csvWords.length + rosterWords.length)) * 100;
                    }
                    
                    console.log(`  Comparing "${driverName}" vs "${rosterName}" - Score: ${score.toFixed(1)}`);
                    
                    if (score > bestScore && score > 30) { // Minimum 30% similarity
                        bestScore = score;
                        bestMatch = rosterDriver;
                    }
                }
                
                if (bestMatch) {
                    console.log(`✅ Best match found: "${bestMatch.display_name || bestMatch.name}" (Score: ${bestScore.toFixed(1)})`);
                } else {
                    console.log(`❌ No suitable match found for: "${driverName}"`);
                    results.errors.push({
                        line: row.lineNumber,
                        message: `Could not find matching driver for: "${driverName}"`
                    });
                    continue;
                }
                
                // Combine infringement and summary for reason
                let reason = '';
                if (infringement && summary) {
                    reason = `${infringement}: ${summary}`;
                } else if (infringement) {
                    reason = infringement;
                } else if (summary) {
                    reason = summary;
                }
                
                // Save penalty
                savePenalty(leagueId, seasonId, sessionMatch.subsession_id.toString(), bestMatch.cust_id.toString(), penaltyPoints, reason);
                
                console.log(`✅ Added penalty: ${penaltyPoints} points to ${bestMatch.display_name} for session ${sessionMatch.subsession_id}`);
                results.processed++;
                
            } catch (error) {
                console.error(`Error processing row ${row.lineNumber}:`, error);
                results.errors.push({
                    line: row.lineNumber,
                    message: `Processing error: ${error.message}`
                });
            }
        }
        
        // Clear championship cache since penalties affect standings
        clearChampionshipCache(leagueId, seasonId, req.app.locals.db);
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        console.log(`📊 CSV processing complete: ${results.processed} processed, ${results.skipped} skipped, ${results.errors.length} errors`);
        
        res.json({
            success: true,
            results: results
        });
        
    } catch (error) {
        console.error('CSV upload error:', error);
        
        // Clean up uploaded file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ error: `Failed to process CSV: ${error.message}` });
    }
});

// Penalty management endpoints
router.get('/:leagueId/season/:seasonId/penalties', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;
        const { cached } = req.query;
        
        // Get penalties using hybrid approach (always returns current data)
        const penalties = getPenalties(leagueId, seasonId);
        
        // Add last_updated timestamp if available
        const response = { penalties };
        if (cached === 'true') {
            response.last_updated = new Date().toISOString();
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('Get penalties error:', error);
        res.status(500).json({ error: 'Failed to load penalties' });
    }
});

router.post('/:leagueId/season/:seasonId/penalties', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;
        const { subsessionId, custId, penaltyPoints, reason } = req.body;
        
        console.log('Penalty request received:', { leagueId, seasonId, subsessionId, custId, penaltyPoints, reason });
        
        if (!subsessionId || !custId) {
            return res.status(400).json({ error: 'Session ID and Customer ID are required' });
        }
        
        // Parse values to ensure they're correct types
        const parsedSubsessionId = String(subsessionId);
        const parsedCustId = String(custId);
        const penalty = parseInt(penaltyPoints) || 0;
        
        if (penalty < 0) {
            return res.status(400).json({ error: 'Penalty points cannot be negative' });
        }
        
        console.log('Parsed values:', { parsedSubsessionId, parsedCustId, penalty });
        
        // Save penalty using hybrid approach
        savePenalty(leagueId, seasonId, parsedSubsessionId, parsedCustId, penalty, reason || '');
        
        // Clear championship cache since penalties affect standings
        clearChampionshipCache(leagueId, seasonId, req.app.locals.db);
        
        console.log(`⚠️ Applied penalty: ${penalty} points to customer ${parsedCustId} in session ${parsedSubsessionId}`);
        
        res.json({ 
            success: true, 
            penalty: {
                points: penalty,
                reason: reason || '',
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Save penalty error:', error);
        res.status(500).json({ error: `Failed to save penalty: ${error.message}` });
    }
});

router.delete('/:leagueId/season/:seasonId/penalties/:subsessionId/:custId', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId, subsessionId, custId } = req.params;
        
        console.log('Delete penalty request:', { leagueId, seasonId, subsessionId, custId });
        
        // Delete penalty using hybrid approach
        deletePenalty(leagueId, seasonId, subsessionId, custId);
        
        // Clear championship cache since penalties affect standings
        clearChampionshipCache(leagueId, seasonId, req.app.locals.db);
        
        console.log(`❌ Removed penalty for customer ${custId} in session ${subsessionId}`);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Delete penalty error:', error);
        res.status(500).json({ error: `Failed to delete penalty: ${error.message}` });
    }
});

module.exports = router; 