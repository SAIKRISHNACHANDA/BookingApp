require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Availability = require('./models/Availability');

async function updatePrices() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const email = 'krishna.sunrisemitra@gmail.com';
        const user = await User.findOne({ email });

        if (!user) {
            console.log(`User with email ${email} not found.`);
            process.exit(1);
        }

        console.log(`Found user: ${user.name} (${user._id})`);

        // Update User hourly rate
        user.hourlyRate = 1;
        user.hourlyRateUsd = 0.012; // Approx 1 INR in USD, or just 1 if they meant 1 unit. let's stick to 1 for now as per "1 unit" testing usually. 
        // actually user said "1 ruppes". so USD should probably be low. But previously code forced 1 USD. 
        // I will set priceUsd to 1 as well to be safe with the "1 unit" request from previous context.
        user.hourlyRateUsd = 1;

        await user.save();
        console.log('Updated User hourlyRate to 1');

        // Update all Availability slots for this host
        const result = await Availability.updateMany(
            { host: user._id },
            { $set: { price: 1, priceUsd: 1 } }
        );

        console.log(`Updated ${result.modifiedCount} availability slots to price 1.`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

updatePrices();
