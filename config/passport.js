const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// Only register Google strategy if credentials are configured
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (googleClientId && googleClientId !== 'YOUR_GOOGLE_CLIENT_ID' && googleClientSecret && googleClientSecret !== 'YOUR_GOOGLE_CLIENT_SECRET') {
    passport.use(new GoogleStrategy({
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            let user = await User.findOne({ googleId: profile.id });
            if (user) return done(null, user);

            user = await User.findOne({ email: profile.emails[0].value });
            if (user) {
                user.googleId = profile.id;
                if (!user.profileImage && profile.photos[0]) {
                    user.profileImage = profile.photos[0].value;
                }
                await user.save();
                return done(null, user);
            }

            user = await User.create({
                name: profile.displayName,
                email: profile.emails[0].value,
                googleId: profile.id,
                profileImage: profile.photos[0] ? profile.photos[0].value : null,
                role: 'customer'
            });
            return done(null, user);
        } catch (err) {
            return done(err, null);
        }
    }));
    console.log('[Passport] Google OAuth strategy registered.');
} else {
    console.warn('[Passport] Google OAuth credentials not set — Google Sign-In disabled.');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;
