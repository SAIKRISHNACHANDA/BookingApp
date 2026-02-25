require('dotenv').config();
const mongoose = require('mongoose');

async function debugBooking() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const hostId = "698c398ff7dc5be9c2d7db4d";
        const startTime = "2026-02-26T11:30:00.000Z";

        const { findMatchingAvailability } = require('./utils/slotUtils');
        const rule = await findMatchingAvailability(hostId, startTime);

        console.log("findMatchingAvailability returned:", rule);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

debugBooking();
