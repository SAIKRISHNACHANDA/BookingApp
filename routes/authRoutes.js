const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passport = require('../config/passport');

router.get('/signup', authController.signupGet);
router.post('/signup', authController.signupPost);
router.get('/login', authController.loginGet);
router.post('/login', authController.loginPost);
router.get('/logout', authController.logout);

// Helper: check if Google OAuth strategy is registered
const isGoogleConfigured = () => {
    try {
        // passport._strategies is the internal registry
        return !!passport._strategies['google'];
    } catch (e) {
        return false;
    }
};

// Google OAuth routes — only active when credentials are configured
router.get('/auth/google', (req, res, next) => {
    if (!isGoogleConfigured()) {
        return res.redirect('/login?error=google_not_configured');
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
    if (!isGoogleConfigured()) {
        return res.redirect('/login?error=google_not_configured');
    }
    passport.authenticate('google', { failureRedirect: '/login?error=google_failed' })(req, res, (err) => {
        if (err) return next(err);
        // Set session user to match existing session format
        req.session.user = {
            _id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role,
            profileImage: req.user.profileImage
        };
        // Redirect based on role
        if (req.user.role === 'host') {
            res.redirect('/hosts/dashboard');
        } else {
            res.redirect('/');
        }
    });
});

module.exports = router;
