const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
    host: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    event: {
        type: String,
        enum: ['profile_view', 'checkout_view', 'payment_start', 'payment_success'],
        required: true
    },
    sessionId: String, // To distinguish unique visitors
    metadata: Object
}, { timestamps: true });

// Optimize for dashboard queries
analyticsSchema.index({ host: 1, event: 1, createdAt: -1 });

module.exports = mongoose.model('Analytics', analyticsSchema);
