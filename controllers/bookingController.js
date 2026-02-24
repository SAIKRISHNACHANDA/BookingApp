const Booking = require('../models/Booking');
const User = require('../models/User');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const bufferManager = require('../utils/bufferManager');

// Initialize Razorpay instances for different currencies
const instanceInr = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID, // Default/INR Key
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const instanceUsd = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID_USD || process.env.RAZORPAY_KEY_ID, // Fallback or USD Key
    key_secret: process.env.RAZORPAY_KEY_SECRET_USD || process.env.RAZORPAY_KEY_SECRET
});

exports.getBookingPage = async (req, res) => {
    try {
        const { hostId, startTime, endTime } = req.query;
        const host = await User.findById(hostId);
        if (!host) return res.status(404).send('Host not found');

        const start = new Date(startTime);
        const end = new Date(endTime);
        const durationMinutes = (end - start) / 60000;

        // Fetch price and isFree from availability rule
        const { findMatchingAvailability } = require('../utils/slotUtils');
        const rule = await findMatchingAvailability(hostId, startTime);

        const amount = rule ? (rule.isFree ? 0 : 1) : 1; // Force 1 Rupee display for testing
        const amountUsd = rule ? (rule.isFree ? 0 : 1) : 1; // Force 1 USD display for testing
        const isFree = rule ? rule.isFree : false;

        // Log Checkout View Analytics
        const Analytics = require('../models/Analytics');
        await Analytics.create({
            host: hostId,
            event: 'checkout_view',
            sessionId: req.sessionID,
            metadata: { startTime, isFree }
        }).catch(err => console.error('Analytics error:', err));

        res.render('checkout', {
            title: 'Checkout',
            host,
            user: req.session.user,
            startTime,
            endTime,
            start: start.toLocaleString(),
            end: end.toLocaleString(),
            duration: durationMinutes,
            amount,     // INR Price
            amountUsd,  // USD Price
            isFree,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            razorpayKeyIdUsd: process.env.RAZORPAY_KEY_ID_USD
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.createBookingOrder = async (req, res) => {
    const { hostId, startTime, endTime, currency, customerName, customerEmail, customerWhatsapp } = req.body;

    // 1. Check Availability and Acquire Lock using BufferManager
    const start = new Date(startTime);
    const end = new Date(endTime);

    console.log(`[createBookingOrder] Checking availability and acquiring lock for host ${hostId} from ${start} to ${end}`);
    const lockAcquired = await bufferManager.acquireLock(hostId, start, end);

    if (!lockAcquired) {
        console.log(`[createBookingOrder] Slot NOT available or currently locked`);
        return res.status(400).json({ error: 'Slot already booked or currently being booked by someone else' });
    }

    // 2. Calculate Price based on Rule
    const host = await User.findById(hostId);
    if (!host) {
        console.log(`[createBookingOrder] Host ${hostId} not found`);
        return res.status(404).json({ error: 'Host not found' });
    }

    const { findMatchingAvailability } = require('../utils/slotUtils');
    const rule = await findMatchingAvailability(hostId, startTime);

    if (!rule) {
        return res.status(400).json({ error: 'Could not find the price for this slot. Please try again.' });
    }

    const isFree = rule.isFree;

    // Force 1 unit (Rupee/USD) for testing "everywhere" as requested
    let amount = 1;
    let selectedCurrency = 'INR';
    let instance = instanceInr;
    let key_id = process.env.RAZORPAY_KEY_ID;

    if (!isFree) {
        if (currency === 'USD') {
            // amount = rule.priceUsd || 0; // Commented out for testing
            amount = 1; // Force 1 USD
            selectedCurrency = 'USD';
            instance = instanceUsd;
            key_id = process.env.RAZORPAY_KEY_ID_USD;
        } else {
            // amount = rule.price || 0; // Commented out for testing
            amount = 1; // Force 1 INR
            selectedCurrency = 'INR';
            instance = instanceInr;
            key_id = process.env.RAZORPAY_KEY_ID;
        }
    }

    // Log Payment Start Analytics
    const Analytics = require('../models/Analytics');
    await Analytics.create({
        host: hostId,
        event: 'payment_start',
        sessionId: req.sessionID,
        metadata: { startTime, amount: amount, currency: selectedCurrency }
    }).catch(err => console.error('Analytics error:', err));


    console.log(`[createBookingOrder] Price calculation: isFree=${isFree}, amount=${amount}, currency=${selectedCurrency}`);

    if (isFree || amount === 0) {
        // FREE BOOKING: Save directly as confirmed
        const booking = new Booking({
            host: hostId,
            customer: {
                name: customerName || (req.session.user ? req.session.user.name : "Guest"),
                email: customerEmail || (req.session.user ? req.session.user.email : "guest@example.com"),
                whatsapp: customerWhatsapp || "",
                user_id: req.session.user ? req.session.user._id : null
            },
            startTime: start,
            endTime: end,
            status: 'confirmed',
            amount: 0,
            currency: selectedCurrency
        });
        await booking.save();

        // Populate host for emails
        const populatedBooking = await Booking.findById(booking._id).populate('host');

        // Send emails
        const { sendBookingConfirmation } = require('../utils/emailService');
        sendBookingConfirmation(populatedBooking).catch(err => console.error('Free booking email failed:', err));

        // Log Success Analytics for Free Booking
        const Analytics = require('../models/Analytics');
        await Analytics.create({
            host: hostId,
            event: 'payment_success',
            sessionId: req.sessionID,
            metadata: { bookingId: booking._id, amount: 0, isFree: true }
        }).catch(err => console.error('Analytics error:', err));

        return res.json({ success: true, isFree: true, bookingId: booking._id });
    }

    // 3. Create Razorpay Order for Paid Sessions
    const options = {
        amount: Math.round(amount * 100), // Convert to smallest unit (paisa/cents)
        currency: selectedCurrency,
        receipt: "receipt_" + Date.now()
    };

    console.log(`[createBookingOrder] Razorpay options:`, options);

    try {
        const order = await instance.orders.create(options);
        console.log(`[createBookingOrder] Razorpay order created: ${order.id}`);

        // 4. Create Locked Booking for Paid Session
        const booking = new Booking({
            host: hostId,
            customer: {
                name: customerName || (req.session.user ? req.session.user.name : "Guest"),
                email: customerEmail || (req.session.user ? req.session.user.email : "guest@example.com"),
                whatsapp: customerWhatsapp || "",
                user_id: req.session.user ? req.session.user._id : null
            },
            startTime: start,
            endTime: end,
            status: 'locked',
            amount: amount,
            currency: selectedCurrency,
            razorpayOrderId: order.id
        });
        await booking.save();
        console.log(`[createBookingOrder] Booking saved: ${booking._id}`);

        res.json({ success: true, isFree: false, order, bookingId: booking._id, key_id: key_id });
    } catch (err) {
        console.error(`[createBookingOrder] Error creating Razorpay order:`, err);
        res.status(500).json({ error: 'Order creation failed: ' + (err.description || err.message || 'Unknown error') });
    }
};

exports.verifyPayment = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;

    // Fetch booking to know the currency/secret
    const booking = await Booking.findById(booking_id).populate('host');
    if (!booking) {
        return res.status(404).send('Booking not found');
    }

    // Select Secret based on Currency
    let secret = process.env.RAZORPAY_KEY_SECRET; // Default INR
    if (booking.currency === 'USD') {
        secret = process.env.RAZORPAY_KEY_SECRET_USD || process.env.RAZORPAY_KEY_SECRET;
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(body.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        // Payment Success
        booking.status = 'confirmed';
        booking.razorpayPaymentId = razorpay_payment_id;
        await booking.save();

        // Send Confirmation Emails
        const { sendBookingConfirmation } = require('../utils/emailService');
        sendBookingConfirmation(booking).catch(err => console.error('Email sending failed:', err));

        // Log Payment Success Analytics
        const Analytics = require('../models/Analytics');
        await Analytics.create({
            host: booking.host._id,
            event: 'payment_success',
            sessionId: req.sessionID,
            metadata: { bookingId: booking_id, amount: booking.amount }
        }).catch(err => console.error('Analytics error:', err));

        return res.status(200).json({ success: true });
    } else {
        return res.status(400).send('Payment Verification Failed');
    }
};

exports.createPayUOrder = async (req, res) => {
    const { hostId, startTime, endTime, currency, customerName, customerEmail, customerWhatsapp } = req.body;

    // 1. Check Availability and Acquire Lock
    const start = new Date(startTime);
    const end = new Date(endTime);
    const lockAcquired = await bufferManager.acquireLock(hostId, start, end);

    if (!lockAcquired) {
        return res.status(400).json({ error: 'Slot already booked' });
    }

    // 2. Fetch Host and Price
    const host = await User.findById(hostId);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    const { findMatchingAvailability } = require('../utils/slotUtils');
    const rule = await findMatchingAvailability(hostId, startTime);
    if (!rule) return res.status(400).json({ error: 'Slot validation failed' });

    let amount = 1; // Force 1 unit for testing as requested
    /*
    if (currency === 'USD') {
        amount = rule.priceUsd || 0;
    } else {
        amount = rule.price || 0;
    }
    */

    const txnid = 'txn_' + Date.now();
    let payuKey = process.env.PAYU_MERCHANT_KEY;
    let payuSalt = process.env.PAYU_SALT;

    console.log('Request Body Currency:', currency);

    if (currency === 'USD') {
        payuKey = process.env.PAYU_MERCHANT_KEY_USD || payuKey;
        payuSalt = process.env.PAYU_SALT_USD || payuSalt;
        console.log('Using USD Keys');
    } else {
        console.log('Using INR Keys');
    }
    console.log('Selected PayU Key:', payuKey);

    const payuUtils = require('../utils/payuUtils');
    const productinfo = 'Session Booking';
    const firstname = customerName ? customerName.split(' ')[0] : (req.session.user ? req.session.user.name.split(' ')[0] : 'Guest');
    const email = customerEmail || (req.session.user ? req.session.user.email : 'guest@example.com');
    const phone = customerWhatsapp || '9999999999';

    // Hash Sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
    // Note: Use crypto directly or the util
    const formattedAmount = parseFloat(amount).toFixed(2);
    // Hash Sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
    // Note: Use crypto directly or the util
    // We pass currency as udf1
    const udf1 = currency || 'INR';
    const hashString = `${payuKey}|${txnid}|${formattedAmount}|${productinfo}|${firstname}|${email}|${udf1}||||||||||${payuSalt}`;
    console.log('PayU Hash String:', hashString);
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    console.log('PayU Generated Hash:', hash);


    // 4. Create Locked Booking
    const booking = new Booking({
        host: hostId,
        customer: {
            name: customerName || (req.session.user ? req.session.user.name : "Guest"),
            email: customerEmail || (req.session.user ? req.session.user.email : "guest@example.com"),
            whatsapp: customerWhatsapp || "",
            user_id: req.session.user ? req.session.user._id : null
        },
        startTime: start,
        endTime: end,
        status: 'locked',
        amount: amount,
        currency: currency || 'INR',
        payuTxnId: txnid,
        paymentGateway: 'payu'
    });
    await booking.save();

    // Return params for form submission
    res.json({
        success: true,
        action: 'https://test.payu.in/_payment', // Use test URL for now
        params: {
            // Standard PayParams
            key: payuKey,
            txnid: txnid,
            amount: formattedAmount,
            productinfo: productinfo,
            firstname: firstname,
            email: email,
            phone: phone,
            surl: `http://localhost:3000/bookings/payu-response`,
            furl: `http://localhost:3000/bookings/payu-response`,
            hash: hash,
            udf1: udf1,
            currency_code: currency || 'INR',
            currency: currency || 'INR'
        }
    });
};

exports.payuResponse = async (req, res) => {
    const { txnid, status, hash, amount, productinfo, firstname, email, key, udf1 } = req.body;

    // Verify Hash
    let payuSalt = process.env.PAYU_SALT;
    if (udf1 === 'USD') {
        payuSalt = process.env.PAYU_SALT_USD || payuSalt;
    }
    // Hash Sequence: salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const str = `${payuSalt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    const calculatedHash = crypto.createHash('sha512').update(str).digest('hex');

    if (calculatedHash !== hash) {
        console.error('Hash mismatch');
        return res.status(400).send('Security Error: Hash Mismatch');
    }

    if (status === 'success') {
        const booking = await Booking.findOne({ payuTxnId: txnid });
        if (booking) {
            booking.status = 'confirmed';
            await booking.save();

            // Email Logic
            const { sendBookingConfirmation } = require('../utils/emailService');
            // Populate Host for email
            await booking.populate('host');
            sendBookingConfirmation(booking).catch(console.error);

            // Analytics
            const Analytics = require('../models/Analytics');
            await Analytics.create({
                host: booking.host._id,
                event: 'payment_success',
                metadata: { bookingId: booking._id, amount: booking.amount, gateway: 'payu' }
            }).catch(console.error);

            res.redirect('/bookings/success');
        } else {
            res.status(404).send('Booking not found');
        }
    } else {
        res.status(400).send('Payment Failed');
    }
};

exports.getSuccessPage = (req, res) => {
    res.render('success', { title: 'Booking Confirmed', user: req.session.user });
};
