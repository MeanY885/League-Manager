// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    if (!req.session.authCookie) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

module.exports = {
    requireAuth
}; 