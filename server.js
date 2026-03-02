const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load env FIRST before any module that reads process.env
dotenv.config();
console.log('Loaded MONGODB_URI:', process.env.MONGODB_URI);

const passport = require('./config/passport');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Trust Proxy (Needed for Cloudflare/AWS)
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false // Disabled to prevent blocking Google Login and Razorpay UI
}));

// Apply Rate Limiting
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per minute
    message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
const { MongoStore } = require('connect-mongo');

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/booking_app',
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 14 // 14 days
    }
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

app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy', user: req.session?.user }));
app.get('/terms', (req, res) => res.render('terms', { title: 'Terms & Conditions', user: req.session?.user }));
app.get('/refund', (req, res) => res.render('refund', { title: 'Refund Policy', user: req.session?.user }));

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
