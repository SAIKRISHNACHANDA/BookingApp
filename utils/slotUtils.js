const Booking = require('../models/Booking');

/**
 * Generate time slots from availability window
 * @param {String} startTime - HH:mm format
 * @param {String} endTime - HH:mm format
 * @param {Number} slotDuration - in minutes
 * @param {Number} bufferMinutes - gap between slots
 * @param {Date} date - target date
 * @param {Object} priceData - {isFree, price, priceUsd}
 * @returns {Array} Array of slots
 */
function generateSlots(startTime, endTime, slotDuration, bufferMinutes, date, priceData) {
    const slots = [];
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let currentTime = new Date(date);
    currentTime.setHours(startHour, startMin, 0, 0);

    const endDateTime = new Date(date);
    endDateTime.setHours(endHour, endMin, 0, 0);

    while (currentTime < endDateTime) {
        const slotEnd = new Date(currentTime.getTime() + slotDuration * 60000);

        if (slotEnd <= endDateTime) {
            slots.push({
                start: new Date(currentTime),
                end: slotEnd,
                isFree: priceData?.isFree || false,
                price: priceData?.price || 0,
                priceUsd: priceData?.priceUsd || 0
            });
        }

        // Move to next slot (duration + buffer)
        currentTime = new Date(slotEnd.getTime() + bufferMinutes * 60000);
    }

    return slots;
}

/**
 * Check if a slot is available (not booked)
 * @param {ObjectId} hostId - Host's ID
 * @param {Date} startTime - Slot start time
 * @param {Date} endTime - Slot end time
 * @returns {Promise<Boolean>} true if available
 */
async function isSlotAvailable(hostId, startTime, endTime) {
    const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const expiryTime = new Date(Date.now() - LOCK_TIMEOUT);

    const overlappingBooking = await Booking.findOne({
        host: hostId,
        $or: [
            { status: 'confirmed' },
            { status: 'locked', createdAt: { $gt: expiryTime } }
        ],
        $or: [
            // New slot starts during existing booking
            { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
            // New slot ends during existing booking
            { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
            // New slot completely contains existing booking
            { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
        ]
    });

    return !overlappingBooking;
}

/**
 * Get available slots for a host on a specific date
 * @param {ObjectId} hostId - Host's ID
 * @param {Date} date - Target date
 * @param {Array} availabilityRules - Host's availability rules
 * @returns {Promise<Array>} Array of available slots
 */
async function getAvailableSlots(hostId, date, availabilityRules) {
    const dayOfWeek = date.getDay();
    const dateString = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

    // Get recurring weekly slots for this day
    const recurringRules = availabilityRules.filter(rule =>
        rule.dayOfWeek === dayOfWeek && !rule.specificDate
    );

    // Get specific date slots for this exact date
    const specificRules = availabilityRules.filter(rule => {
        if (!rule.specificDate) return false;
        const ruleDate = new Date(rule.specificDate).toISOString().split('T')[0];
        return ruleDate === dateString;
    });

    // Combine both types of rules
    const todayRules = [...recurringRules, ...specificRules];

    let allSlots = [];

    for (const rule of todayRules) {
        const slots = generateSlots(
            rule.startTime,
            rule.endTime,
            rule.slotDuration,
            rule.bufferMinutes,
            date,
            { isFree: rule.isFree, price: rule.price, priceUsd: rule.priceUsd }
        );
        allSlots = allSlots.concat(slots);
    }

    // Filter out past slots and booked slots
    const now = new Date();
    const availableSlots = [];

    for (const slot of allSlots) {
        if (slot.start > now) {
            const available = await isSlotAvailable(hostId, slot.start, slot.end);
            if (available) {
                availableSlots.push(slot);
            }
        }
    }

    return availableSlots;
}

/**
 * Find matching availability rule for a specific slot
 */
async function findMatchingAvailability(hostId, startTime) {
    const Availability = require('../models/Availability');
    const date = new Date(startTime);
    const dayOfWeek = date.getDay();
    const startTimeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Create an exact YYYY-MM-DD string
    const targetDateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

    // Find ALL rules for this host
    const allRules = await Availability.find({ host: hostId });

    // 1. Check for specific date rule matches targeting this exactly
    let rule = allRules.find(r => {
        if (!r.specificDate) return false;
        const ruleDateStr = new Date(r.specificDate).toISOString().split('T')[0];
        return ruleDateStr === targetDateStr && r.startTime <= startTimeStr && r.endTime > startTimeStr;
    });

    // 2. Fallback to recurring rule matching day of week
    if (!rule) {
        rule = allRules.find(r =>
            !r.specificDate &&
            r.dayOfWeek === dayOfWeek &&
            r.startTime <= startTimeStr &&
            r.endTime > startTimeStr
        );
    }

    return rule;
}

module.exports = {
    generateSlots,
    isSlotAvailable,
    getAvailableSlots,
    findMatchingAvailability
};
