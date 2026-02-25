require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Availability = require('./models/Availability');

async function debugAvailability() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const email = 'krishna.sunrisemitra@gmail.com';
        const user = await User.findOne({ email });

        if (!user) {
            console.log("no user"); return;
        }

        const slots = await Availability.find({ host: user._id });
        console.log("Availabilities:", JSON.stringify(slots, null, 2));

        const startTime = new Date("2026-02-26T11:30:00.000Z"); // approximate ISO equivalent of 5:00 PM IST
        console.log("Start time day:", startTime.getDay());

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

debugAvailability();
