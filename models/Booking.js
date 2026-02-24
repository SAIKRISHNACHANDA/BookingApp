const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    host: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    customer: { // Can be null if guest booking, or linked to a user
        name: String,
        email: String,
        whatsapp: String,
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['locked', 'confirmed', 'cancelled', 'completed'],
        default: 'locked'
    },
    amount: Number,
    currency: String,
    razorpayOrderId: String,
    razorpayPaymentId: String,
    payuTxnId: String,
    paymentGateway: {
        type: String,
        enum: ['razorpay', 'payu'],
        default: 'razorpay'
    },
    meetingLink: String
}, { timestamps: true });

// Prevent double booking
bookingSchema.index({ host: 1, startTime: 1 }, { unique: true });

module.exports = mongoose.model('Booking', bookingSchema);
