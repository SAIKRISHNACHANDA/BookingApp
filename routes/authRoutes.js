const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passport = require('../config/passport');

router.get('/signup', authController.signupGet);
router.post('/signup', authController.signupPost);
router.get('/login', authController.loginGet);
router.post('/login', authController.loginPost);
router.get('/logout', authController.logout);

// Google OAuth routes
router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
    (req, res) => {
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
    }
);

module.exports = router;
