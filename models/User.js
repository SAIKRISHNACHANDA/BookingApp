const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        // required: true // Made optional for Google Sign-In
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    role: {
        type: String,
        enum: ['customer', 'host', 'admin'],
        default: 'customer'
    },
    // Host specific fields
    username: { // unique slug for host profile
        type: String,
        unique: true,
        sparse: true
    },
    bio: String,
    hourlyRate: Number,
    hourlyRateUsd: Number,
    currency: {
        type: String,
        default: 'INR'
    },
    timezone: {
        type: String,
        default: 'Asia/Kolkata'
    },
    profileImage: String,
    googleCalendarTokens: {
        access_token: String,
        refresh_token: String,
        scope: String,
        token_type: String,
        expiry_date: Number
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
