require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function listUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const users = await User.find({}, 'name email role');
        console.log("Users in DB:");
        users.forEach(u => console.log(`- ${u.name} | ${u.email} | ${u.role}`));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

listUsers();
