const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema({
    host: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    dayOfWeek: {
        type: Number, // 0-6 (Sun-Sat)
        required: true
    },
    startTime: {
        type: String, // HH:mm format
        required: true
    },
    endTime: {
        type: String, // HH:mm format
        required: true
    },
    slotDuration: {
        type: Number, // in minutes (15, 30, 60)
        default: 60
    },
    bufferMinutes: {
        type: Number, // gap between slots
        default: 0
    },
    specificDate: {
        type: Date, // for one-time slots instead of recurring
        default: null
    },
    isFree: {
        type: Boolean,
        default: false
    },
    price: {
        type: Number,
        default: 0
    },
    priceUsd: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Availability', availabilitySchema);
