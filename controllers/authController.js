const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.signupGet = (req, res) => {
    res.render('signup', { title: 'Sign Up', user: req.session.user });
};

exports.signupPost = async (req, res) => {
    const { name, email, password, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            name,
            email,
            password: hashedPassword,
            role
        });

        if (role === 'host') {
            user.username = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString().slice(-4);
        }

        await user.save();
        req.session.user = user;
        res.redirect(role === 'host' ? '/hosts/dashboard' : '/');
    } catch (err) {
        console.error(err);
        res.render('signup', { title: 'Sign Up', error: 'Error creating account. Email might be in use.', user: null });
    }
};

exports.loginGet = (req, res) => {
    res.render('login', { title: 'Login', user: req.session.user });
};

exports.loginPost = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('login', { title: 'Login', error: 'Invalid email or password', user: null });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { title: 'Login', error: 'Invalid email or password', user: null });
        }

        req.session.user = user;
        const redirectUrl = user.role === 'host' ? '/hosts/dashboard' : '/';
        res.redirect(redirectUrl);
    } catch (err) {
        console.error(err);
        res.render('login', { title: 'Login', error: 'Server error', user: null });
    }
};

exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log(err);
        res.redirect('/');
    });
};
