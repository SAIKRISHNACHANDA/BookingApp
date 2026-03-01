// cspell:ignore payu txnid udf1 surl furl productinfo firstname
const Booking = require('../models/Booking');
const User = require('../models/User');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const bufferManager = require('../utils/bufferManager');

// Lazy Razorpay initialization — only creates instance when needed
// Prevents server crash if keys are not in .env
function getRazorpayInstance(currency = 'INR') {
    const keyId = currency === 'USD'
        ? (process.env.RAZORPAY_KEY_ID_USD || process.env.RAZORPAY_KEY_ID)
        : process.env.RAZORPAY_KEY_ID;

    const keySecret = currency === 'USD'
        ? (process.env.RAZORPAY_KEY_SECRET_USD || process.env.RAZORPAY_KEY_SECRET)
        : process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error('Razorpay keys not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
    }

    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

exports.getBookingsHome = async (req, res) => {
    try {
        let defaultHost = await User.findOne({ role: 'host' })
            .select('name bio hourlyRate currency username')
            .sort({ createdAt: -1 });

        // Fallback for quick setup: if no host exists, use latest user so checkout can proceed.
        if (!defaultHost) {
            defaultHost = await User.findOne({})
                .select('name bio hourlyRate currency username')
                .sort({ createdAt: -1 });
        }

        res.render('bookings', {
            title: 'Bookings',
            user: req.session?.user,
            defaultHost,
            upiVpa: process.env.UPI_VPA || '',
            upiName: process.env.UPI_NAME || 'Gurubrahma'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.createFindHostAppointment = async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({ error: 'Please log in first' });
        }

        const { hostId, date, time, duration } = req.body;
        if (!hostId || !date || !time || !duration) {
            return res.status(400).json({ error: 'Missing appointment details' });
        }

        const host = await User.findOne({ _id: hostId, role: 'host' });
        if (!host) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const startTime = new Date(`${date}T${time}:00`);
        if (Number.isNaN(startTime.getTime())) {
            return res.status(400).json({ error: 'Invalid date/time' });
        }

        const durationMinutes = Number(duration);
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
            return res.status(400).json({ error: 'Invalid duration' });
        }

        const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
        const customerUser = await User.findById(req.session.user._id).select('name email');
        const customerName = customerUser?.name || req.session.user.name || 'Guest';
        const customerEmail = customerUser?.email || req.session.user.email || 'guest@example.com';
        const amount = ((host.hourlyRate || 0) / 60) * durationMinutes;

        const booking = new Booking({
            host: host._id,
            customer: {
                name: customerName,
                email: customerEmail,
                user_id: req.session.user._id
            },
            startTime,
            endTime,
            status: 'confirmed',
            amount,
            currency: host.currency || 'INR'
        });

        await booking.save();
        return res.json({ success: true, bookingId: booking._id });
    } catch (err) {
        if (err?.code === 11000) {
            return res.status(409).json({ error: 'This slot is already booked' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server Error' });
    }
};

exports.getBookingPage = async (req, res) => {
    try {
        const { startTime, endTime } = req.query;
        const hostId = req.query.hostId || req.query.host;

        if (!hostId) {
            return res.redirect('/');
        }

        const host = await User.findById(hostId);
        if (!host) return res.status(404).send('Host not found');

        const hostProfileUrl = host.username ? `/hosts/${host.username}` : '/';
        if (!startTime || !endTime) {
            return res.redirect(hostProfileUrl);
        }

        const start = new Date(startTime);
        const end = new Date(endTime);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            return res.redirect(hostProfileUrl);
        }
        const durationMinutes = (end - start) / 60000;

        // Fetch price and isFree from availability rule
        const { findMatchingAvailability } = require('../utils/slotUtils');
        const rule = await findMatchingAvailability(hostId, startTime);

        // Calculate amount based on duration if rule price is not specified
        const calculateFee = (baseRate, rulePrice) => {
            if (rulePrice) return rulePrice; // If rule specifies a fixed price, use it
            return (baseRate / 60) * durationMinutes;
        };

        const amount = rule ? (rule.isFree ? 0 : calculateFee(host.hourlyRate || 0, rule.price)) : ((host.hourlyRate || 0) / 60) * durationMinutes;
        const amountUsd = rule ? (rule.isFree ? 0 : calculateFee(host.hourlyRateUsd || 0, rule.priceUsd)) : ((host.hourlyRateUsd || 0) / 60) * durationMinutes;

        // Unified free booking check: rule said so, OR price is 0.
        const isFree = (rule ? rule.isFree : false) || amount === 0;

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
            user: req.session?.user,
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
    const isFree = rule ? rule.isFree : false;

    const durationMinutes = (end - start) / 60000;
    let amount = 0;
    let selectedCurrency = 'INR';

    if (!isFree) {
        if (currency === 'USD') {
            const baseRate = host.hourlyRateUsd || 0;
            amount = (rule ? rule.priceUsd : null) || (baseRate / 60) * durationMinutes;
            selectedCurrency = 'USD';
        } else {
            const baseRate = host.hourlyRate || 0;
            amount = (rule ? rule.price : null) || (baseRate / 60) * durationMinutes;
            selectedCurrency = 'INR';
        }
    }
    const effectiveIsFree = isFree || amount === 0;

    // Set test amount to ₹1 as requested
    amount = 1;

    const key_id = selectedCurrency === 'USD'
        ? (process.env.RAZORPAY_KEY_ID_USD || process.env.RAZORPAY_KEY_ID)
        : process.env.RAZORPAY_KEY_ID;

    // Log Payment Start Analytics
    const Analytics = require('../models/Analytics');
    await Analytics.create({
        host: hostId,
        event: 'payment_start',
        sessionId: req.sessionID,
        metadata: { startTime, amount: amount, currency: selectedCurrency }
    }).catch(err => console.error('Analytics error:', err));


    console.log(`[createBookingOrder] Price calculation: isFree=${effectiveIsFree}, amount=${amount}, currency=${selectedCurrency}`);

    if (effectiveIsFree) {
        // FREE BOOKING: Save directly as confirmed
        const booking = new Booking({
            host: hostId,
            customer: {
                name: customerName || (req.session?.user ? req.session.user.name : "Guest"),
                email: customerEmail || (req.session?.user ? req.session.user.email : "guest@example.com"),
                whatsapp: customerWhatsapp || "",
                user_id: req.session?.user ? req.session.user._id : null
            },
            startTime: start,
            endTime: end,
            status: 'confirmed',
            amount: 0,
            currency: selectedCurrency
        });
        await booking.save();

        // Populate host for emails and calendar trigger
        const populatedBooking = await Booking.findById(booking._id).populate('host');

        // Generate Google Meet Link
        const { createMeetEvent } = require('../services/googleCalendarService');
        await createMeetEvent(populatedBooking);

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

    const { paymentMethod } = req.body;

    try {
        const instance = getRazorpayInstance(selectedCurrency);

        // --- QR CODE FLOW ---
        if (paymentMethod === 'qr_code') {
            console.log(`[createBookingOrder] Creating Razorpay QR Code for amount: ${amount}`);

            // Note: QR Code API expects amount in smallest unit (paisa)
            const qrOptions = {
                type: 'upi_qr',
                name: "Booking Payment",
                usage: 'single_use',
                fixed_amount: true,
                payment_amount: Math.round(amount * 100),
                description: `Booking for ${customerName} with ${host.name}`,
                notes: {
                    hostId: hostId.toString(),
                    customerEmail: customerEmail
                }
            };

            const qrCode = await instance.qrCode.create(qrOptions);
            console.log(`[createBookingOrder] QR Code created: ${qrCode.id}`);

            const booking = new Booking({
                host: hostId,
                customer: {
                    name: customerName || (req.session?.user ? req.session.user.name : "Guest"),
                    email: customerEmail || (req.session?.user ? req.session.user.email : "guest@example.com"),
                    whatsapp: customerWhatsapp || "",
                    user_id: req.session?.user ? req.session.user._id : null
                },
                startTime: start,
                endTime: end,
                status: 'locked',
                amount: amount,
                currency: selectedCurrency,
                razorpayQrId: qrCode.id,
                razorpayQrData: qrCode.image_url, // image_url contains the QR data image
                paymentMethod: 'qr_code'
            });
            await booking.save();

            return res.json({
                success: true,
                isFree: false,
                qrCode: {
                    id: qrCode.id,
                    image_url: qrCode.image_url,
                    payment_data: qrCode.payment_data // UPI intent URL
                },
                bookingId: booking._id
            });
        }

        // --- STANDARD CHECKOUT FLOW ---
        const order = await instance.orders.create(options);
        console.log(`[createBookingOrder] Razorpay order created: ${order.id}`);

        // 4. Create Locked Booking for Paid Session
        const booking = new Booking({
            host: hostId,
            customer: {
                name: customerName || (req.session?.user ? req.session.user.name : "Guest"),
                email: customerEmail || (req.session?.user ? req.session.user.email : "guest@example.com"),
                whatsapp: customerWhatsapp || "",
                user_id: req.session?.user ? req.session.user._id : null
            },
            startTime: start,
            endTime: end,
            status: 'locked',
            amount: amount,
            currency: selectedCurrency,
            razorpayOrderId: order.id,
            paymentMethod: 'checkout'
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

        // Generate Google Meet Link
        const { createMeetEvent } = require('../services/googleCalendarService');
        await createMeetEvent(booking);

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

// ✅ Mobile Redirect Handler — Razorpay POSTs here after redirect-based payment on phones
exports.verifyPaymentRedirect = async (req, res) => {
    console.log('[verifyPaymentRedirect] Mobile redirect callback received:', req.body);

    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    } = req.body;

    // booking_id comes as a query param (appended to callback_url)
    const booking_id = req.query.booking_id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id) {
        console.error('[verifyPaymentRedirect] Missing required fields', { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id });
        return res.redirect('/bookings/payment-failed?reason=missing_fields');
    }

    try {
        const booking = await Booking.findById(booking_id).populate('host');
        if (!booking) {
            console.error('[verifyPaymentRedirect] Booking not found:', booking_id);
            return res.redirect('/bookings/payment-failed?reason=booking_not_found');
        }

        // Already confirmed? (duplicate callback guard)
        if (booking.status === 'confirmed') {
            console.log('[verifyPaymentRedirect] Booking already confirmed, redirecting to success');
            return res.redirect('/bookings/success');
        }

        // Select Secret based on Currency
        let secret = process.env.RAZORPAY_KEY_SECRET;
        if (booking.currency === 'USD') {
            secret = process.env.RAZORPAY_KEY_SECRET_USD || process.env.RAZORPAY_KEY_SECRET;
        }

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            console.error('[verifyPaymentRedirect] Signature mismatch!');
            return res.redirect('/bookings/payment-failed?reason=signature_mismatch');
        }

        // ✅ Signature valid — confirm the booking
        booking.status = 'confirmed';
        booking.razorpayPaymentId = razorpay_payment_id;
        await booking.save();
        console.log('[verifyPaymentRedirect] Booking confirmed:', booking._id);

        // Generate Google Meet Link
        const { createMeetEvent } = require('../services/googleCalendarService');
        await createMeetEvent(booking);

        // Send Confirmation Emails
        const { sendBookingConfirmation } = require('../utils/emailService');
        sendBookingConfirmation(booking).catch(err => console.error('Email failed:', err));

        // Log Analytics
        const Analytics = require('../models/Analytics');
        await Analytics.create({
            host: booking.host._id,
            event: 'payment_success',
            sessionId: req.sessionID,
            metadata: { bookingId: booking_id, amount: booking.amount, via: 'mobile_redirect' }
        }).catch(err => console.error('Analytics error:', err));

        return res.redirect('/bookings/success');

    } catch (err) {
        console.error('[verifyPaymentRedirect] Error:', err);
        return res.redirect('/bookings/payment-failed?reason=server_error');
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

    let amount = 0;
    if (currency === 'USD') {
        amount = (rule ? rule.priceUsd : null) || host.hourlyRateUsd || 0;
    } else {
        amount = (rule ? rule.price : null) || host.hourlyRate || 0;
    }

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
    const firstname = customerName ? customerName.split(' ')[0] : (req.session?.user ? req.session.user.name.split(' ')[0] : 'Guest');
    const email = customerEmail || (req.session?.user ? req.session.user.email : 'guest@example.com');
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
            name: customerName || (req.session?.user ? req.session.user.name : "Guest"),
            email: customerEmail || (req.session?.user ? req.session.user.email : "guest@example.com"),
            whatsapp: customerWhatsapp || "",
            user_id: req.session?.user ? req.session.user._id : null
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
        const booking = await Booking.findOne({ payuTxnId: txnid }).populate('host');
        if (booking) {
            booking.status = 'confirmed';
            await booking.save();

            // Generate Google Meet Link
            const { createMeetEvent } = require('../services/googleCalendarService');
            await createMeetEvent(booking);

            // Email Logic
            const { sendBookingConfirmation } = require('../utils/emailService');
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

exports.checkQrPaymentStatus = async (req, res) => {
    const { bookingId } = req.body;
    try {
        const booking = await Booking.findById(bookingId).populate('host');
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        if (booking.status === 'confirmed') {
            return res.json({ success: true, status: 'confirmed' });
        }

        if (!booking.razorpayQrId) {
            return res.status(400).json({ error: 'No QR code found for this booking' });
        }

        const instance = getRazorpayInstance(booking.currency);
        const qrCode = await instance.qrCode.fetch(booking.razorpayQrId);

        console.log(`[checkQrPaymentStatus] QR Code status for ${booking.razorpayQrId}: ${qrCode.status}, payments_received: ${qrCode.payments_received}`);

        // If at least one payment is received, mark as confirmed
        if (qrCode.payments_received > 0) {
            booking.status = 'confirmed';
            await booking.save();

            // Trigger post-payment logic (Meet link, email, analytics)
            const { createMeetEvent } = require('../services/googleCalendarService');
            await createMeetEvent(booking);

            const { sendBookingConfirmation } = require('../utils/emailService');
            sendBookingConfirmation(booking).catch(console.error);

            const Analytics = require('../models/Analytics');
            await Analytics.create({
                host: booking.host._id,
                event: 'payment_success',
                metadata: { bookingId: booking._id, amount: booking.amount, via: 'qr_code' }
            }).catch(console.error);

            return res.json({ success: true, status: 'confirmed' });
        }

        return res.json({ success: false, status: 'pending' });
    } catch (err) {
        console.error('[checkQrPaymentStatus] Error:', err);
        res.status(500).json({ error: 'Failed to check QR status' });
    }
};

exports.getSuccessPage = (req, res) => {
    res.render('success', { title: 'Booking Confirmed', user: req.session?.user });
};
