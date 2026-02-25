const mongoose = require('mongoose');
const User = require('../models/User');
const Availability = require('../models/Availability');
const Booking = require('../models/Booking');
const Analytics = require('../models/Analytics');

exports.getDashboard = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.redirect('/login');
    }
    try {
        const hostId = new mongoose.Types.ObjectId(req.session.user._id);
        const hostUser = await User.findById(hostId);

        const availability = await Availability.find({ host: hostId })
            .sort({ specificDate: -1, dayOfWeek: 1 });

        const bookings = await Booking.find({ host: hostId })
            .sort({ startTime: -1 })
            .limit(10);

        const totalEarnings = await Booking.aggregate([
            { $match: { host: hostId, status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        // Analytics Funnel Data
        const analyticsData = await Analytics.aggregate([
            { $match: { host: hostId } },
            {
                $group: {
                    _id: '$event',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Format analytics into a clean object
        const stats = {
            profile_view: 0,
            checkout_view: 0,
            payment_start: 0,
            payment_success: 0
        };
        analyticsData.forEach(item => {
            if (stats.hasOwnProperty(item._id)) {
                stats[item._id] = item.count;
            }
        });

        // Use REAL booking count for success (source of truth)
        const confirmedBookingCount = await Booking.countDocuments({ host: hostId, status: 'confirmed' });
        const successCount = Math.max(stats.payment_success, confirmedBookingCount);

        // Calculate Percentages (Funnel / Drop-off)
        const funnel = {
            views: stats.profile_view,
            checkout: stats.checkout_view,
            payment: stats.payment_start,
            success: successCount,

            checkoutRate: stats.profile_view > 0 ? ((stats.checkout_view / stats.profile_view) * 100).toFixed(1) : 0,
            paymentRate: stats.checkout_view > 0 ? ((stats.payment_start / stats.checkout_view) * 100).toFixed(1) : 0,
            successRate: stats.payment_start > 0 ? ((successCount / stats.payment_start) * 100).toFixed(1) : 0,
            overallConversion: stats.profile_view > 0 ? ((successCount / stats.profile_view) * 100).toFixed(1) : 0
        };

        res.render('dashboard', {
            title: 'Dashboard',
            user: hostUser,
            availability,
            bookings,
            totalEarnings: totalEarnings[0]?.total || 0,
            funnel
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.setAvailability = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { dayOfWeek, specificDate, startTime, endTime, slotDuration, bufferMinutes } = req.body;

    console.log('[setAvailability] Request body:', req.body);

    try {
        // Determine the day of week
        let targetDayOfWeek;
        let targetSpecificDate = null;

        if (specificDate && specificDate.trim() !== '') {
            // Specific date slot
            targetSpecificDate = new Date(specificDate);
            targetDayOfWeek = targetSpecificDate.getDay();
            console.log(`[setAvailability] Creating specific date slot for ${specificDate}, dayOfWeek: ${targetDayOfWeek}`);
        } else if (dayOfWeek !== undefined && dayOfWeek !== '') {
            // Recurring weekly slot
            targetDayOfWeek = parseInt(dayOfWeek);
            if (isNaN(targetDayOfWeek)) {
                throw new Error('Invalid day of week');
            }
            console.log(`[setAvailability] Creating recurring slot for dayOfWeek: ${targetDayOfWeek}`);
        } else {
            throw new Error('Either specificDate or dayOfWeek must be provided');
        }

        // Check for overlapping slots (across both recurring and specific types for this day)
        const overlappingSlot = await Availability.findOne({
            host: req.session.user._id,
            dayOfWeek: targetDayOfWeek,
            $and: [
                {
                    $or: [
                        { specificDate: targetSpecificDate }, // Same specific date
                        { specificDate: null } // Or a recurring slot for the same weekday
                    ]
                },
                {
                    $or: [
                        // New slot starts during existing slot
                        { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
                        // New slot ends during existing slot
                        { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
                        // New slot completely contains existing slot
                        { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
                    ]
                }
            ]
        });

        if (overlappingSlot) {
            console.log('[setAvailability] Overlap detected:', overlappingSlot);
            const slotType = overlappingSlot.specificDate ? 'specific date' : 'recurring';
            return res.status(400).send(`This time slot overlaps with an existing ${slotType} availability slot on the same day. Please choose a different time.`);
        }

        const newSlot = new Availability({
            host: req.session.user._id,
            dayOfWeek: targetDayOfWeek,
            startTime,
            endTime,
            slotDuration: slotDuration || 60,
            bufferMinutes: bufferMinutes || 0,
            specificDate: targetSpecificDate,
            isFree: req.body.isFree === 'true',
            price: req.body.isFree === 'true' ? 0 : (req.body.price || 0),
            priceUsd: req.body.isFree === 'true' ? 0 : (req.body.priceUsd || 0)
        });

        await newSlot.save();
        console.log('[setAvailability] Slot created successfully:', newSlot);
        res.redirect('/hosts/dashboard');
    } catch (err) {
        console.error('[setAvailability] Error:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
};

exports.deleteAvailability = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        await Availability.findByIdAndDelete(req.params.id);
        res.redirect('/hosts/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getHostProfile = async (req, res) => {
    try {
        const host = await User.findOne({ username: req.params.username, role: 'host' });
        if (!host) {
            return res.status(404).render('404', { title: 'Not Found' });
        }
        // Log Profile View Analytics
        const Analytics = require('../models/Analytics');
        await Analytics.create({
            host: host._id,
            event: 'profile_view',
            sessionId: req.sessionID,
            metadata: {
                referrer: req.get('Referrer') || 'Direct',
                path: req.originalUrl
            }
        }).catch(err => console.error('Analytics error:', err));

        res.render('host-profile', { title: host.name, host, user: req.session.user });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getAvailabilityAPI = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            // Return raw availability rules if no date specified
            return res.json(availability);
        }

        const host = await User.findOne({ username: req.params.username });
        if (!host) return res.status(404).json({ error: 'Host not found' });

        const availability = await Availability.find({ host: host._id });

        console.log(`[API] Fetching availability for ${req.params.username}, date: ${date}`);

        if (availability.length === 0) {
            console.log('[API] No availability rules found for this host');
            return res.json({
                date: date,
                hostId: host._id,
                hourlyRate: host.hourlyRate,
                hourlyRateUsd: host.hourlyRateUsd,
                currency: host.currency,
                slots: [],
                message: 'Host has not set any availability yet'
            });
        }

        // Generate actual slots for the specified date
        const { getAvailableSlots } = require('../utils/slotUtils');
        const targetDate = new Date(date);
        console.log(`[API] Generating slots for date: ${targetDate.toISOString()}`);

        const slots = await getAvailableSlots(host._id, targetDate, availability);
        console.log(`[API] Generated ${slots.length} available slots`);

        res.json({
            date: date,
            hostId: host._id,
            hourlyRate: host.hourlyRate,
            hourlyRateUsd: host.hourlyRateUsd,
            currency: host.currency,
            slots: slots.map(slot => ({
                start: slot.start.toISOString(),
                end: slot.end.toISOString(),
                startTime: slot.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                endTime: slot.end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                isFree: slot.isFree,
                price: slot.price,
                priceUsd: slot.priceUsd
            }))
        });
    } catch (err) {
        console.error('[API] Error in getAvailabilityAPI:', err);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
};

exports.getHostSchedule = async (req, res) => {
    try {
        console.log(`[getHostSchedule] Fetching schedule for username: ${req.params.username}`);
        const host = await User.findOne({ username: req.params.username });
        if (!host) return res.status(404).json({ error: 'Host not found' });

        const Availability = require('../models/Availability');
        const rules = await Availability.find({ host: host._id });
        console.log(`[getHostSchedule] Found ${rules.length} rules for host ${host.username}`);

        const recurringDays = [...new Set(rules.filter(r => !r.specificDate).map(r => r.dayOfWeek))];
        const specificDates = rules.filter(r => r.specificDate).map(r => r.specificDate.toISOString().split('T')[0]);

        console.log(`[getHostSchedule] recurringDays: ${JSON.stringify(recurringDays)}, specificDates: ${JSON.stringify(specificDates)}`);

        res.json({
            recurringDays: recurringDays.map(Number), // Ensure they are numbers
            specificDates
        });
    } catch (err) {
        console.error('[getHostSchedule] Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.getMonthAvailability = async (req, res) => {
    try {
        const { year, month } = req.query;
        const host = await User.findOne({ username: req.params.username });
        if (!host) return res.status(404).json({ error: 'Host not found' });

        const Availability = require('../models/Availability');
        const availabilityRules = await Availability.find({ host: host._id });

        const { getAvailableSlots } = require('../utils/slotUtils');
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, parseInt(month) + 1, 0);

        const dailySummary = {};

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            const slots = await getAvailableSlots(host._id, new Date(d), availabilityRules);
            dailySummary[dateStr] = {
                count: slots.length,
                isAvailable: slots.length > 0
            };
        }

        res.json(dailySummary);
    } catch (err) {
        console.error('[getMonthAvailability] Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.sendCustomEmail = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { customerEmail, subject, message } = req.body;

    try {
        const { sendCustomEmail } = require('../utils/emailService');
        await sendCustomEmail(customerEmail, subject, message, req.session.user.name);
        res.json({ success: true, message: 'Email sent successfully!' });
    } catch (err) {
        console.error('[HostController] Error sending custom email:', err);
        res.status(500).json({ error: 'Failed to send email' });
    }
};

exports.getIntelligence = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { generateInsights } = require('../utils/intelligenceEngine');
        const insights = await generateInsights(new mongoose.Types.ObjectId(req.session.user._id));
        res.json(insights);
    } catch (err) {
        console.error('[HostController] Error generating intelligence:', err);
        res.status(500).json({ error: 'Failed to analyze behavior' });
    }
};

exports.seedDemoData = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const hostId = new mongoose.Types.ObjectId(req.session.user._id);
        const Analytics = require('../models/Analytics');

        // Clear old demo data if needed (optional)
        // await Analytics.deleteMany({ host: hostId });

        // Seed Profile Views (High volume in evening)
        for (let i = 0; i < 30; i++) {
            const date = new Date();
            date.setHours(18 + (i % 4)); // Evening hours
            await Analytics.create({
                host: hostId,
                event: 'profile_view',
                sessionId: 'sess_' + i,
                metadata: { referrer: i % 2 === 0 ? 'Twitter' : 'LinkedIn' },
                createdAt: date
            });
        }

        // Seed Checkouts (Low conversion gap)
        for (let i = 0; i < 5; i++) {
            await Analytics.create({
                host: hostId,
                event: 'checkout_view',
                sessionId: 'sess_conv_' + i
            });
        }

        res.json({ success: true, message: 'Demo data seeded! Refresh and click Analyze.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Seeding failed' });
    }
};

const googleCalendarService = require('../services/googleCalendarService');

exports.connectGoogleCalendar = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(403).send('Unauthorized');
    }
    const authUrl = googleCalendarService.generateCalendarAuthUrl(req);
    res.redirect(authUrl);
};

exports.calendarCallback = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'host') {
        return res.status(403).send('Unauthorized');
    }

    const { code } = req.query;
    if (!code) {
        return res.send('No code provided');
    }

    try {
        await googleCalendarService.saveCalendarTokens(req.session.user._id, code, req);
        res.redirect('/hosts/dashboard?msg=calendar_connected');
    } catch (err) {
        console.error('Failed to save calendar tokens:', err);
        res.redirect('/hosts/dashboard?error=calendar_failed');
    }
};

