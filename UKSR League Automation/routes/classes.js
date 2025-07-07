const express = require('express');
const router = express.Router();

// Get all classes for a league
router.get('/:leagueId/classes', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const db = req.app.locals.db;
        
        // Get classes from database
        const classes = db.prepare(`
            SELECT * FROM classes WHERE league_id = ?
        `).all(leagueId);
        
        res.json({ classes });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ error: 'Failed to fetch classes' });
    }
});

// Create or update a class
router.post('/:leagueId/classes', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const { name, color } = req.body;
        const db = req.app.locals.db;
        
        if (!name || !color) {
            return res.status(400).json({ error: 'Name and color are required' });
        }
        
        // Insert or update class
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO classes (league_id, name, color, created_at, updated_at)
            VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `);
        
        stmt.run(leagueId, name, color);
        
        res.json({ success: true, message: 'Class saved successfully' });
    } catch (error) {
        console.error('Error saving class:', error);
        res.status(500).json({ error: 'Failed to save class' });
    }
});

// Update class name
router.put('/:leagueId/classes/:className', async (req, res) => {
    try {
        const { leagueId, className } = req.params;
        const { newName, color } = req.body;
        const db = req.app.locals.db;
        
        if (!newName) {
            return res.status(400).json({ error: 'New name is required' });
        }
        
        // Update class
        const stmt = db.prepare(`
            UPDATE classes 
            SET name = ?, color = COALESCE(?, color), updated_at = datetime('now')
            WHERE league_id = ? AND name = ?
        `);
        
        const result = stmt.run(newName, color, leagueId, className);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }
        
        res.json({ success: true, message: 'Class updated successfully' });
    } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).json({ error: 'Failed to update class' });
    }
});

// Delete a class
router.delete('/:leagueId/classes/:className', async (req, res) => {
    try {
        const { leagueId, className } = req.params;
        const db = req.app.locals.db;
        
        // Delete class
        const stmt = db.prepare(`
            DELETE FROM classes WHERE league_id = ? AND name = ?
        `);
        
        const result = stmt.run(leagueId, className);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }
        
        res.json({ success: true, message: 'Class deleted successfully' });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({ error: 'Failed to delete class' });
    }
});

// Reassign driver to a different class
router.put('/:leagueId/driver/:custId/class', async (req, res) => {
    try {
        const { leagueId, custId } = req.params;
        const { newClass } = req.body;
        const db = req.app.locals.db;
        
        if (!newClass) {
            return res.status(400).json({ error: 'New class is required' });
        }
        
        // Get current driver info from cached roster
        const cachedRoster = db.prepare(`
            SELECT data FROM cached_data 
            WHERE league_id = ? AND data_type = 'roster'
            ORDER BY cached_at DESC LIMIT 1
        `).get(leagueId);
        
        if (!cachedRoster) {
            return res.status(404).json({ error: 'Roster data not found. Please load roster first.' });
        }
        
        const rosterData = JSON.parse(cachedRoster.data);
        // Handle both array format and object format with roster property
        const roster = Array.isArray(rosterData) ? rosterData : rosterData.roster || rosterData;
        const driver = roster.find(d => d.cust_id == custId);
        
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found in roster' });
        }
        
        // Update driver's nick_name to reflect new class
        const oldNickName = driver.nick_name || '';
        const oldClassMatch = oldNickName.match(/\[([^\]]+)\]/);
        const oldClass = oldClassMatch ? oldClassMatch[1] : null;
        
        // Create new nick_name with new class
        let newNickName;
        if (oldClassMatch) {
            // Replace existing class
            newNickName = oldNickName.replace(/\[([^\]]+)\]/, `[${newClass}]`);
        } else {
            // Add new class
            newNickName = `[${newClass}] ${driver.display_name}`;
        }
        
        // Update the driver in the roster data
        driver.nick_name = newNickName;
        
        // Update cached roster data - maintain the original structure
        let updatedData;
        if (Array.isArray(rosterData)) {
            updatedData = roster;
        } else {
            // Maintain the original object structure
            updatedData = { ...rosterData, roster: roster };
        }
        
        const updateStmt = db.prepare(`
            UPDATE cached_data 
            SET data = ?, cached_at = datetime('now')
            WHERE league_id = ? AND data_type = 'roster'
        `);
        
        updateStmt.run(JSON.stringify(updatedData), leagueId);
        
        // Store the class change in a separate table for tracking
        const classChangeStmt = db.prepare(`
            INSERT OR REPLACE INTO driver_class_changes 
            (league_id, cust_id, old_class, new_class, changed_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `);
        
        classChangeStmt.run(leagueId, custId, oldClass, newClass);
        
        // Clear championship cache to force recalculation
        const clearCacheStmt = db.prepare(`
            DELETE FROM cached_data 
            WHERE league_id = ? AND data_type = 'championship'
        `);
        
        clearCacheStmt.run(leagueId);
        
        res.json({ 
            success: true, 
            message: `Driver reassigned from "${oldClass || 'No Class'}" to "${newClass}". Championship standings will be recalculated.`,
            oldClass: oldClass,
            newClass: newClass
        });
        
    } catch (error) {
        console.error('Error reassigning driver:', error);
        res.status(500).json({ error: 'Failed to reassign driver' });
    }
});

module.exports = router;

// Get driver's multiple class assignments
router.get('/:leagueId/driver/:custId/classes', async (req, res) => {
    try {
        const { leagueId, custId } = req.params;
        const db = req.app.locals.db;
        
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }
        
        const stmt = db.prepare(`
            SELECT class_name, assigned_at FROM driver_class_assignments 
            WHERE league_id = ? AND cust_id = ?
            ORDER BY assigned_at DESC
        `);
        
        const assignments = stmt.all(leagueId, custId);
        
        res.json({ 
            success: true, 
            classes: assignments.map(a => a.class_name),
            assignments: assignments
        });
    } catch (error) {
        console.error('Error getting driver class assignments:', error);
        res.status(500).json({ error: 'Failed to get driver class assignments' });
    }
});

// Add class assignment to driver
router.post('/:leagueId/driver/:custId/classes', async (req, res) => {
    try {
        const { leagueId, custId } = req.params;
        const { className } = req.body;
        const db = req.app.locals.db;
        
        if (!className) {
            return res.status(400).json({ error: 'Class name is required' });
        }
        
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }
        
        // Insert class assignment (will be ignored if already exists due to UNIQUE constraint)
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO driver_class_assignments (league_id, cust_id, class_name, assigned_at)
            VALUES (?, ?, ?, datetime('now'))
        `);
        
        const result = stmt.run(leagueId, custId, className);
        
        // Clear championship cache to force recalculation
        const clearCacheStmt = db.prepare(`
            DELETE FROM cached_data 
            WHERE league_id = ? AND data_type = 'championship'
        `);
        clearCacheStmt.run(leagueId);
        
        if (result.changes > 0) {
            res.json({ 
                success: true, 
                message: `Class "${className}" assigned to driver. Championship standings will be recalculated.`
            });
        } else {
            res.json({ 
                success: true, 
                message: `Driver is already assigned to class "${className}".`
            });
        }
    } catch (error) {
        console.error('Error adding driver class assignment:', error);
        res.status(500).json({ error: 'Failed to add driver class assignment' });
    }
});

// Remove class assignment from driver
router.delete('/:leagueId/driver/:custId/classes/:className', async (req, res) => {
    try {
        const { leagueId, custId, className } = req.params;
        const db = req.app.locals.db;
        
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }
        
        const stmt = db.prepare(`
            DELETE FROM driver_class_assignments 
            WHERE league_id = ? AND cust_id = ? AND class_name = ?
        `);
        
        const result = stmt.run(leagueId, custId, className);
        
        // Clear championship cache to force recalculation
        const clearCacheStmt = db.prepare(`
            DELETE FROM cached_data 
            WHERE league_id = ? AND data_type = 'championship'
        `);
        clearCacheStmt.run(leagueId);
        
        if (result.changes > 0) {
            res.json({ 
                success: true, 
                message: `Class "${className}" removed from driver. Championship standings will be recalculated.`
            });
        } else {
            res.json({ 
                success: false, 
                message: `Driver was not assigned to class "${className}".`
            });
        }
    } catch (error) {
        console.error('Error removing driver class assignment:', error);
        res.status(500).json({ error: 'Failed to remove driver class assignment' });
    }
});

// Get all drivers with their multiple class assignments
router.get('/:leagueId/drivers/classes', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const db = req.app.locals.db;
        
        if (!db) {
            return res.status(500).json({ error: 'Database not available' });
        }
        
        // Get cached roster data
        const cachedRoster = db.prepare(`
            SELECT data FROM cached_data 
            WHERE league_id = ? AND data_type = 'roster'
            ORDER BY cached_at DESC LIMIT 1
        `).get(leagueId);
        
        if (!cachedRoster) {
            return res.status(404).json({ error: 'Roster data not found. Please load roster first.' });
        }
        
        const rosterData = JSON.parse(cachedRoster.data);
        const roster = Array.isArray(rosterData) ? rosterData : rosterData.roster || rosterData;
        
        // Get all class assignments
        const stmt = db.prepare(`
            SELECT cust_id, class_name FROM driver_class_assignments 
            WHERE league_id = ?
            ORDER BY cust_id, class_name
        `);
        
        const assignments = stmt.all(leagueId);
        
        // Group assignments by driver
        const driverAssignments = {};
        assignments.forEach(assignment => {
            if (!driverAssignments[assignment.cust_id]) {
                driverAssignments[assignment.cust_id] = [];
            }
            driverAssignments[assignment.cust_id].push(assignment.class_name);
        });
        
        // Combine with roster data
        const driversWithClasses = roster.map(driver => {
            const nickName = driver.nick_name || '';
            const divisionMatch = nickName.match(/\[([^\]]+)\]/);
            const nickNameClass = divisionMatch ? divisionMatch[1] : null;
            
            return {
                cust_id: driver.cust_id,
                display_name: driver.display_name,
                car_number: driver.car_number,
                nick_name_class: nickNameClass,
                assigned_classes: driverAssignments[driver.cust_id] || [],
                total_classes: (driverAssignments[driver.cust_id] || []).length + (nickNameClass && !driverAssignments[driver.cust_id]?.includes(nickNameClass) ? 1 : 0)
            };
        });
        
        res.json({ 
            success: true, 
            drivers: driversWithClasses
        });
    } catch (error) {
        console.error('Error getting drivers with class assignments:', error);
        res.status(500).json({ error: 'Failed to get drivers with class assignments' });
    }
}); 