const User = require('../models/User');
const Booking = require('../models/Booking');

exports.loginGet = (req, res) => {
    res.render('admin/login', { title: 'Admin Login', error: null });
};

exports.loginPost = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email, role: 'admin' });

        if (!user || password !== 'admin123') { // Simple password check for demo
            return res.render('admin/login', {
                title: 'Admin Login',
                error: 'Invalid credentials or not an admin'
            });
        }

        req.session.admin = user;
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.render('admin/login', { title: 'Admin Login', error: 'Server error' });
    }
};

exports.getDashboard = async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }

    try {
        const totalUsers = await User.countDocuments();
        const totalHosts = await User.countDocuments({ role: 'host' });
        const totalBookings = await Booking.countDocuments();

        const totalRevenue = await Booking.aggregate([
            { $match: { status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const recentBookings = await Booking.find()
            .populate('host', 'name email')
            .sort({ createdAt: -1 })
            .limit(10);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            admin: req.session.admin,
            stats: {
                totalUsers,
                totalHosts,
                totalBookings,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            recentBookings
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getUsers = async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }

    try {
        const { role } = req.query;
        const filter = role ? { role } : {};
        const users = await User.find(filter).sort({ createdAt: -1 });

        res.render('admin/users', {
            title: 'User Management',
            admin: req.session.admin,
            users,
            selectedRole: role || 'all'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getBookings = async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }

    try {
        const { status } = req.query;
        const filter = status ? { status } : {};
        const bookings = await Booking.find(filter)
            .populate('host', 'name email')
            .sort({ createdAt: -1 });

        res.render('admin/bookings', {
            title: 'Booking Management',
            admin: req.session.admin,
            bookings,
            selectedStatus: status || 'all'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log(err);
        res.redirect('/admin/login');
    });
};
