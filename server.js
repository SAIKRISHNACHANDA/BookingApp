const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

// Load env FIRST before any module that reads process.env
dotenv.config();
console.log('Loaded MONGODB_URI:', process.env.MONGODB_URI);

const passport = require('./config/passport');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Routes
const authRoutes = require('./routes/authRoutes');
const hostRoutes = require('./routes/hostRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');

app.use('/', authRoutes);
app.use('/hosts', hostRoutes);
app.use('/bookings', bookingRoutes);
app.use('/admin', adminRoutes);

const User = require('./models/User');

app.get('/', async (req, res) => {
    try {
        const hosts = await User.find({ role: 'host' }).select('name email hourlyRate currency username');
        res.render('index', { title: 'Welcome', user: req.session.user, hosts });
    } catch (err) {
        console.error(err);
        res.status(500).send(`Server Error: ${err.message}`);
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Efficient Buffer Manager: Cleanup expired locks every 5 minutes
    const bufferManager = require('./utils/bufferManager');
    setInterval(async () => {
        const deleted = await bufferManager.cleanupExpiredLocks();
        if (deleted > 0) console.log(`[BufferManager] Cleaned up ${deleted} expired locks`);
    }, 5 * 60 * 1000);
});
