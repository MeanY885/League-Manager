const express = require('express');
const { fetchIRacingData } = require('../utils/iracing-api');
const { requireAuth } = require('../middleware/auth');
const { getPointsConfig } = require('../utils/points-config');
const { getPenalties } = require('../utils/penalties');
const { getDatabase } = require('../config/database');

const router = express.Router();

// Championship standings endpoint with drop weeks, fastest lap, pole position, and penalties support
router.get('/:leagueId/season/:seasonId/championship', requireAuth, async (req, res) => {
    try {
        const { leagueId, seasonId } = req.params;
        const { division, cached } = req.query;
        
        // If cached data requested, try to get from database first
        if (cached === 'true') {
            const db = req.app.locals.db;
            if (db) {
                try {
                    const stmt = db.prepare(`
                        SELECT data, cached_at FROM cached_data 
                        WHERE league_id = ? AND season_id = ? AND data_type = 'championship' 
                        ORDER BY cached_at DESC LIMIT 1
                    `);
                    const result = stmt.get(leagueId, seasonId);
                    
                    if (result) {
                        console.log(`✅ Returning cached championship for league ${leagueId}, season ${seasonId}${division ? `, division ${division}` : ''}`);
                        const data = JSON.parse(result.data);
                        data.last_updated = result.cached_at;
                        
                        // Filter by division if requested
                        if (division && data.standings[division]) {
                            return res.json({
                                division: division,
                                standings: { [division]: data.standings[division] },
                                all_divisions: data.all_divisions,
                                points_config: data.points_config,
                                last_updated: result.cached_at
                            });
                        }
                        
                        return res.json(data);
                    }
                } catch (dbError) {
                    console.error('Database error:', dbError);
                }
            }
        }
        
        console.log(`🏆 Getting championship standings for league ${leagueId}, season ${seasonId}, division: ${division || 'all'}`);
        
        // Get points configuration using hybrid approach
        const pointsConfig = getPointsConfig(leagueId);
        
        const dropWeeks = pointsConfig.dropWeeks || 0;
        const fastestLapPoints = pointsConfig.fastestLapPoints || 0;
        const polePositionPoints = pointsConfig.polePositionPoints || 0;
        
        // Get penalties using hybrid approach
        const seasonPenalties = getPenalties(leagueId, seasonId);
        
        // Get all sessions for the season
        const sessionsData = await fetchIRacingData(`/data/league/season_sessions?league_id=${leagueId}&season_id=${seasonId}`, req.session.authCookie);
        const sessions = sessionsData.sessions || [];
        
        // Get league roster to map customer IDs to divisions
        const rosterData = await fetchIRacingData(`/data/league/get?league_id=${leagueId}&include_roster=1`, req.session.authCookie);
        const roster = rosterData.roster || [];
        
        // Create a map of customer ID to division
        const customerDivisionMap = {};
        
        // Get manual class assignments from database
        const dbConnection = req.app.locals.db;
        let manualAssignments = {};
        let multipleClassAssignments = {};
        if (dbConnection) {
            try {
                // Get single class assignments (legacy system)
                const stmt = dbConnection.prepare(`
                    SELECT cust_id, new_class FROM driver_class_changes 
                    WHERE league_id = ? 
                    ORDER BY changed_at DESC
                `);
                const assignments = stmt.all(leagueId);
                assignments.forEach(assignment => {
                    // Only keep the most recent assignment for each driver
                    if (!manualAssignments[assignment.cust_id]) {
                        manualAssignments[assignment.cust_id] = assignment.new_class;
                    }
                });
                
                // Get multiple class assignments (new tagging system)
                const multiStmt = dbConnection.prepare(`
                    SELECT cust_id, class_name FROM driver_class_assignments 
                    WHERE league_id = ? 
                    ORDER BY assigned_at DESC
                `);
                const multiAssignments = multiStmt.all(leagueId);
                multiAssignments.forEach(assignment => {
                    if (!multipleClassAssignments[assignment.cust_id]) {
                        multipleClassAssignments[assignment.cust_id] = [];
                    }
                    multipleClassAssignments[assignment.cust_id].push(assignment.class_name);
                });
                
                console.log(`📋 Found ${Object.keys(manualAssignments).length} single class assignments and ${Object.keys(multipleClassAssignments).length} drivers with multiple class assignments`);
            } catch (error) {
                console.error('Error loading manual class assignments:', error);
            }
        }
        
        roster.forEach(member => {
            const nickName = member.nick_name || '';
            const divisionMatch = nickName.match(/\[([^\]]+)\]/);
            const nickNameDivision = divisionMatch ? divisionMatch[1] : null;
            
            // Determine driver's classes
            let driverClasses = [];
            
            // Check for multiple class assignments first (new system)
            if (multipleClassAssignments[member.cust_id] && multipleClassAssignments[member.cust_id].length > 0) {
                driverClasses = multipleClassAssignments[member.cust_id];
            }
            // Fall back to single class assignment (legacy system)
            else if (manualAssignments[member.cust_id]) {
                driverClasses = [manualAssignments[member.cust_id]];
            }
            // Fall back to nick_name prefix
            else if (nickNameDivision) {
                driverClasses = [nickNameDivision];
            }
            
            // Check if driver is excluded from championship calculations
            const isExcluded = driverClasses.some(className => 
                className.toUpperCase() === 'EXCLUDED' || 
                className.toUpperCase() === 'EXCLUDE' ||
                className.toUpperCase() === 'NON-COMPETING' ||
                className.toUpperCase() === 'NON_COMPETING'
            );
            
            if (isExcluded) {
                console.log(`⚠️ Driver ${member.display_name} (${member.cust_id}) excluded from championship calculations due to EXCLUDED class`);
                return; // Skip this driver entirely from championship calculations
            }
            
            // Store driver info for each class they're assigned to
            if (driverClasses.length > 0) {
                driverClasses.forEach(className => {
                    customerDivisionMap[`${member.cust_id}_${className}`] = {
                        cust_id: member.cust_id,
                        division: className,
                        display_name: member.display_name,
                        car_number: member.car_number,
                        manual_assignment: !!(multipleClassAssignments[member.cust_id] || manualAssignments[member.cust_id]),
                        multiple_classes: driverClasses.length > 1,
                        all_classes: driverClasses,
                        primary_class: driverClasses[0] || 'No Class'
                    };
                });
                
                // Also add to "Overall" championship (all drivers regardless of class)
                customerDivisionMap[`${member.cust_id}_Overall`] = {
                    cust_id: member.cust_id,
                    division: 'Overall',
                    display_name: member.display_name,
                    car_number: member.car_number,
                    manual_assignment: !!(multipleClassAssignments[member.cust_id] || manualAssignments[member.cust_id]),
                    multiple_classes: driverClasses.length > 1,
                    all_classes: driverClasses,
                    primary_class: driverClasses[0] || 'No Class'
                };
            } else {
                // Even drivers without specific class assignments should be in Overall championship
                customerDivisionMap[`${member.cust_id}_Overall`] = {
                    cust_id: member.cust_id,
                    division: 'Overall',
                    display_name: member.display_name,
                    car_number: member.car_number,
                    manual_assignment: false,
                    multiple_classes: false,
                    all_classes: ['No Class'],
                    primary_class: 'No Class'
                };
                console.log(`⚠️ Driver ${member.display_name} (${member.cust_id}) has no specific class but included in Overall championship`);
            }
        });
        
        const totalRosterSize = roster.length;
        const includedDrivers = Object.keys(customerDivisionMap).length;
        const excludedDrivers = totalRosterSize - includedDrivers;
        console.log(`📊 Roster processing: ${includedDrivers} drivers included, ${excludedDrivers} drivers excluded (no division)`);
        
        const db = getDatabase();
        console.log(`📊 Processing ${sessions.length} sessions for championship calculations (Drop weeks: ${dropWeeks}, Fastest lap: ${fastestLapPoints}pts, Pole: ${polePositionPoints}pts, Penalties from ${db ? 'database' : 'memory'})`);
        
        // Championship standings by division
        const championshipData = {};
        
        // Process each session
        for (const session of sessions) {
            if (!session.subsession_id) continue;
            
            // Only process past sessions
            const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                               session.start_time ? new Date(session.start_time) : null;
            if (!sessionDate || sessionDate > new Date()) continue;
            
            try {
                // Get session results
                const resultsData = await fetchIRacingData(`/data/results/get?subsession_id=${session.subsession_id}`, req.session.authCookie);
                
                if (!resultsData.session_results) {
                    console.log(`⚠️ No results found for session ${session.subsession_id}`);
                    continue;
                }
                
                // Log available session types for debugging
                const sessionTypes = resultsData.session_results.map(s => s.simsession_name).join(', ');
                console.log(`📋 Session ${session.subsession_id} contains: ${sessionTypes}`);
                
                // Find the race session - must be exactly "RACE"
                const raceSession = resultsData.session_results.find(s => 
                    s.simsession_name === "RACE"
                );
                
                if (!raceSession || !raceSession.results) {
                    console.log(`⚠️ No race results found for session ${session.subsession_id}`);
                    continue;
                }
                
                const sessionResults = raceSession.results;
                
                // Group results by division
                const divisionResults = {};
                
                sessionResults.forEach(result => {
                    // Find all divisions this driver is assigned to
                    const driverEntries = Object.entries(customerDivisionMap).filter(([key, info]) => 
                        info.cust_id == result.cust_id
                    );
                    
                    driverEntries.forEach(([key, customerInfo]) => {
                        const resultDivision = customerInfo.division;
                        
                        if (!divisionResults[resultDivision]) {
                            divisionResults[resultDivision] = [];
                        }
                        
                        divisionResults[resultDivision].push({
                            ...result,
                            division_key: key,
                            division: resultDivision,
                            multiple_classes: customerInfo.multiple_classes,
                            all_classes: customerInfo.all_classes,
                            primary_class: customerInfo.primary_class
                        });
                    });
                });
                
                // Award points within each division
                Object.keys(divisionResults).forEach(resultDivision => {
                    // Sort by finishing position within division
                    const divisionFinishers = divisionResults[resultDivision].sort((a, b) => a.finish_position - b.finish_position);
                    
                    // Find fastest lap in this division (if fastest lap points are enabled)
                    let fastestLapDriver = null;
                    if (fastestLapPoints > 0) {
                        let fastestTime = Number.MAX_VALUE;
                        divisionFinishers.forEach(result => {
                            if (result.best_lap_time > 0 && result.best_lap_time < fastestTime) {
                                fastestTime = result.best_lap_time;
                                fastestLapDriver = result.cust_id;
                            }
                        });
                    }
                    
                    // Find pole position in this division (if pole position points are enabled)
                    let polePositionDriver = null;
                    if (polePositionPoints > 0) {
                        // Look for qualifying session in the same subsession
                        const qualifyingSession = resultsData.session_results.find(sessionResult => 
                            sessionResult.simsession_name === "QUALIFY"
                        );
                        
                        if (qualifyingSession && qualifyingSession.results) {
                            // Filter qualifying results to this division only
                            const divisionQualifyingResults = qualifyingSession.results.filter(result => {
                                // Check if this driver is in this division
                                const driverEntries = Object.entries(customerDivisionMap).filter(([key, info]) => 
                                    info.cust_id == result.cust_id && info.division === resultDivision
                                );
                                return driverEntries.length > 0;
                            });
                            
                            // Sort qualifying results: drivers with times first (by time), then drivers without times
                            const sortedQualifyingResults = divisionQualifyingResults.sort((a, b) => {
                                const aHasTime = a.best_qual_lap_time > 0;
                                const bHasTime = b.best_qual_lap_time > 0;
                                
                                // If both have times, sort by time (fastest first)
                                if (aHasTime && bHasTime) {
                                    return a.best_qual_lap_time - b.best_qual_lap_time;
                                }
                                
                                // If only one has a time, that one goes first
                                if (aHasTime && !bHasTime) return -1;
                                if (!aHasTime && bHasTime) return 1;
                                
                                // If neither has a time, maintain original order
                                return 0;
                            });
                            
                            // Pole position goes to the fastest qualifier (first in sorted list with a time)
                            if (sortedQualifyingResults.length > 0 && sortedQualifyingResults[0].best_qual_lap_time > 0) {
                                polePositionDriver = sortedQualifyingResults[0].cust_id;
                                console.log(`🏁 Division ${resultDivision} pole: Customer ${polePositionDriver} with time ${sortedQualifyingResults[0].best_qual_lap_time}`);
                            } else {
                                console.log(`⚠️ No valid qualifying times found in division ${resultDivision} for subsession ${session.subsession_id}`);
                            }
                        } else {
                            console.log(`⚠️ No qualifying session found for subsession ${session.subsession_id}`);
                        }
                    }
                    
                    // Initialize division championship if not exists
                    if (!championshipData[resultDivision]) {
                        championshipData[resultDivision] = {};
                    }
                    
                    // Award points
                    divisionFinishers.forEach((result, index) => {
                        const divisionPosition = index + 1;
                        const positionPoints = pointsConfig.points[divisionPosition] || 0;
                        const fastestLapBonus = (fastestLapPoints > 0 && result.cust_id === fastestLapDriver) ? fastestLapPoints : 0;
                        const polePositionBonus = (polePositionPoints > 0 && result.cust_id === polePositionDriver) ? polePositionPoints : 0;
                        
                        // Apply penalties from hybrid storage
                        const penalty = seasonPenalties[session.subsession_id]?.[result.cust_id]?.points || 0;
                        const penaltyReason = seasonPenalties[session.subsession_id]?.[result.cust_id]?.reason || '';
                        
                        const totalPoints = positionPoints + fastestLapBonus + polePositionBonus - penalty;
                        
                        // Use division_key to ensure unique entries for drivers in multiple classes
                        const driverKey = result.division_key || `${result.cust_id}_${resultDivision}`;
                        
                        if (!championshipData[resultDivision][driverKey]) {
                            championshipData[resultDivision][driverKey] = {
                                cust_id: result.cust_id,
                                display_name: result.display_name,
                                car_number: result.car_number,
                                division: resultDivision,
                                multiple_classes: result.multiple_classes || false,
                                all_classes: result.all_classes || [resultDivision],
                                primary_class: result.primary_class || resultDivision,
                                total_points: 0,
                                races: []
                            };
                        }
                        
                        championshipData[resultDivision][driverKey].races.push({
                            session_name: session.session_name,
                            track_name: session.track?.track_name || 'Unknown Track',
                            date: session.launch_at,
                            division_position: divisionPosition,
                            overall_position: result.finish_position,
                            starting_position: result.starting_position + 1,
                            position_points: positionPoints,
                            fastest_lap_points: fastestLapBonus,
                            pole_position_points: polePositionBonus,
                            penalty_points: penalty,
                            penalty_reason: penaltyReason,
                            points: totalPoints,
                            fastest_lap: result.cust_id === fastestLapDriver,
                            pole_position: result.cust_id === polePositionDriver,
                            best_lap_time: result.best_lap_time,
                            car_name: result.car_name || 'Unknown Car',
                            subsession_id: session.subsession_id
                        });
                    });
                });
                
            } catch (error) {
                console.error(`❌ Error processing session ${session.subsession_id}:`, error.message);
            }
        }
        
        // Calculate final standings with drop weeks
        const standings = {};
        Object.keys(championshipData).forEach(divisionName => {
            const drivers = Object.values(championshipData[divisionName]);
            
            // Get all sessions for this season for missed race tracking
            const allSessionIds = new Set();
            sessions.forEach(session => {
                if (session.subsession_id) {
                    const sessionDate = session.launch_at ? new Date(session.launch_at) : 
                                       session.start_time ? new Date(session.start_time) : null;
                    if (sessionDate && sessionDate <= new Date()) {
                        allSessionIds.add(session.subsession_id);
                    }
                }
            });
            
            // Apply drop weeks logic and include missed races
            drivers.forEach(driver => {
                // Create full race record including missed races (always, not just for drop weeks)
                const fullRaceRecord = [];
                const attendedSessions = new Set(driver.races.map(race => race.subsession_id));
                
                // Add attended races
                driver.races.forEach(race => {
                    fullRaceRecord.push({
                        ...race,
                        attended: true
                    });
                });
                
                // Add missed races as 0-point entries
                allSessionIds.forEach(sessionId => {
                    if (!attendedSessions.has(sessionId)) {
                        const sessionData = sessions.find(s => s.subsession_id === sessionId);
                        if (sessionData) {
                            fullRaceRecord.push({
                                session_name: sessionData.session_name,
                                track_name: sessionData.track?.track_name || 'Unknown Track',
                                date: sessionData.launch_at,
                                division_position: null,
                                overall_position: null,
                                starting_position: null,
                                position_points: 0,
                                fastest_lap_points: 0,
                                pole_position_points: 0,
                                penalty_points: 0,
                                penalty_reason: '',
                                points: 0,
                                fastest_lap: false,
                                pole_position: false,
                                best_lap_time: 0,
                                car_name: 'No Car (Did Not Participate)',
                                subsession_id: sessionId,
                                attended: false
                            });
                        }
                    }
                });
                
                // Sort races by date to maintain chronological order
                fullRaceRecord.sort((a, b) => new Date(a.date) - new Date(b.date));
                
                if (dropWeeks > 0 && fullRaceRecord.length > 0) {
                    // Apply drop logic: prioritize non-attendance, then lowest scores (including negative from penalties)
                    if (fullRaceRecord.length > dropWeeks) {
                        // Sort races: non-attended first (0 points from missing), then by points ascending (including penalties)
                        const sortedRaces = [...fullRaceRecord].sort((a, b) => {
                            // Non-attended races (0 points from missing) should be dropped first
                            if (!a.attended && b.attended) return -1;
                            if (a.attended && !b.attended) return 1;
                            
                            // If both attended or both missed, sort by points (penalties can make this negative)
                            return a.points - b.points;
                        });
                        
                        const racesToDrop = Math.min(dropWeeks, fullRaceRecord.length);
                        const droppedRaces = sortedRaces.slice(0, racesToDrop);
                        const countedRaces = sortedRaces.slice(racesToDrop);
                        
                        // Mark which races are dropped (including missed races)
                        fullRaceRecord.forEach(race => {
                            race.dropped = droppedRaces.some(dropped => 
                                dropped.subsession_id === race.subsession_id
                            );
                        });
                        
                        // Calculate total from non-dropped attended races only
                        driver.total_points = countedRaces
                            .filter(race => race.attended)
                            .reduce((sum, race) => sum + race.points, 0);
                        
                        driver.dropped_races = racesToDrop;
                    } else {
                        // No drops needed
                        driver.total_points = fullRaceRecord
                            .filter(race => race.attended)
                            .reduce((sum, race) => sum + race.points, 0);
                        driver.dropped_races = 0;
                        fullRaceRecord.forEach(race => race.dropped = false);
                    }
                } else {
                    // No drops configured - just calculate total from attended races
                    driver.total_points = fullRaceRecord
                        .filter(race => race.attended)
                        .reduce((sum, race) => sum + race.points, 0);
                    driver.dropped_races = 0;
                    fullRaceRecord.forEach(race => race.dropped = false);
                }
                
                // Replace driver.races with the full record (including missed races)
                driver.races = fullRaceRecord;
            });
            
            // Sort by total points and assign championship positions
            standings[divisionName] = drivers
                .sort((a, b) => b.total_points - a.total_points)
                .map((driver, index) => ({
                    ...driver,
                    championship_position: index + 1
                }));
        });
        
        // Filter by division if requested
        if (division && standings[division]) {
            return res.json({
                division: division,
                standings: { [division]: standings[division] },
                all_divisions: Object.keys(standings),
                points_config: pointsConfig
            });
        }
        
        res.json({
            standings: standings,
            all_divisions: Object.keys(standings),
            points_config: pointsConfig
        });
        
    } catch (error) {
        console.error('❌ Championship standings error:', error);
        res.status(500).json({ error: 'Failed to calculate championship standings' });
    }
});

module.exports = router; 