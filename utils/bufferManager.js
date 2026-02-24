const Booking = require('../models/Booking');

/**
 * BufferManager handles slot locking and expiration for high-traffic booking.
 * It ensures that slots are not permanently locked if a booking fails or is abandoned.
 */
class BufferManager {
    constructor(lockTimeoutMinutes = 5) {
        this.lockTimeout = lockTimeoutMinutes * 60 * 1000;
    }

    /**
     * Attempts to acquire a lock on a slot.
     * If an expired lock exists, it removes it.
     * @param {String} hostId 
     * @param {Date} startTime 
     * @param {Date} endTime 
     * @returns {Promise<Boolean>} True if lock acquired, False if slot is unavailable
     */
    async acquireLock(hostId, startTime, endTime) {
        const expiryTime = new Date(Date.now() - this.lockTimeout);

        // 1. Clean up expired locks for this specific slot to prevent unique index collisions
        await Booking.deleteMany({
            host: hostId,
            startTime: startTime,
            status: 'locked',
            createdAt: { $lt: expiryTime }
        });

        // 2. Check for active bookings (confirmed or fresh locks)
        const overlappingBooking = await Booking.findOne({
            host: hostId,
            $or: [
                { status: 'confirmed' },
                { status: 'locked', createdAt: { $gt: expiryTime } }
            ],
            $or: [
                { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
                { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
                { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
            ]
        });

        if (overlappingBooking) {
            return false;
        }

        return true;
    }

    /**
     * Periodically clean up all expired locks in the system.
     * Can be called by a cron job or background worker.
     */
    async cleanupExpiredLocks() {
        const expiryTime = new Date(Date.now() - this.lockTimeout);
        const result = await Booking.deleteMany({
            status: 'locked',
            createdAt: { $lt: expiryTime }
        });
        return result.deletedCount;
    }
}

module.exports = new BufferManager();
