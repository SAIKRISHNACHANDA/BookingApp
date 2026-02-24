const mongoose = require('mongoose');

/**
 * Aggregates analytics and bookings data to provide sales and conversion insights.
 */
exports.generateInsights = async (hostId) => {
    const Analytics = require('../models/Analytics');
    const Booking = require('../models/Booking');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    // 1. Basic Stats
    const stats = await Analytics.aggregate([
        { $match: { host: hostId, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$event', count: { $sum: 1 } } }
    ]);

    const statMap = {};
    stats.forEach(s => statMap[s._id] = s.count);

    // 2. Time-based Performance (Profile Views vs Success)
    const timeAnalysis = await Analytics.aggregate([
        { $match: { host: hostId, event: { $in: ['profile_view', 'payment_success'] } } },
        {
            $project: {
                event: 1,
                hour: { $hour: { date: '$createdAt', timezone: 'Asia/Kolkata' } },
                dayType: {
                    $cond: {
                        if: { $in: [{ $dayOfWeek: '$createdAt' }, [1, 7]] }, // 1=Sun, 7=Sat
                        then: 'weekend',
                        else: 'weekday'
                    }
                }
            }
        },
        {
            $group: {
                _id: { hour: '$hour', dayType: '$dayType', event: '$event' },
                count: { $sum: 1 }
            }
        }
    ]);

    // 3. Price-point Performance
    const pricePerformance = await Booking.aggregate([
        { $match: { host: hostId, status: 'confirmed' } },
        {
            $group: {
                _id: { isFree: { $eq: ['$amount', 0] } },
                count: { $sum: 1 },
                avgAmount: { $avg: '$amount' }
            }
        }
    ]);

    // 4. Source Attribution (CMO Gap)
    const sources = await Analytics.aggregate([
        { $match: { host: hostId, event: 'profile_view' } },
        { $group: { _id: '$metadata.referrer', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
    ]);
    const topSource = sources.length > 0 ? sources[0]._id : 'Direct/Search';

    // --- Logic for Personalized CMO Note ---
    let recommendations = [];
    let observations = [];

    // Check Time Patterns
    const eveningViews = timeAnalysis.filter(t => t._id.event === 'profile_view' && t._id.hour >= 17).reduce((a, b) => a + b.count, 0);
    const morningViews = timeAnalysis.filter(t => t._id.event === 'profile_view' && t._id.hour < 12).reduce((a, b) => a + b.count, 0);

    if (eveningViews > morningViews * 1.5) {
        observations.push("Your profile gets 50% more traffic in the evenings.");
        recommendations.push("🚀 Strategy: Open more slots between 6 PM - 9 PM to capture high evening traffic.");
    }

    // Check Drop-off (Gap Analysis)
    const checkoutRate = statMap.profile_view ? (statMap.checkout_view / statMap.profile_view) : 0;
    if (statMap.profile_view > 0 && checkoutRate < 0.2) {
        observations.push("High drop-off detected on your profile page.");
        recommendations.push("💡 Tip: Your profile has high views but low clicks. Try adding a profile picture or a more punchy bio to build trust.");
    }

    // Check availability Gaps
    const availabilityCount = await require('../models/Availability').countDocuments({ host: hostId });
    if (availabilityCount < 3) {
        observations.push("You have very limited slots open.");
        recommendations.push("💰 Sales Driver: You are missing out on potential 'Impulse Bookings'. Try adding at least 5 different time slots per week.");
    }

    if (topSource && topSource !== 'Direct') {
        observations.push(`Most of your clients are finding you through ${topSource}.`);
    }

    // Summary Note
    const summaryNote = {
        title: "CMO Growth Strategy",
        personalizedNote: observations.length > 0
            ? `Observation: ${observations.join(' ')}`
            : "We are tracking your traffic. Share your link on social media to see real-time source attribution!",
        topAction: recommendations[0] || "Continue monitoring your funnel to identify drop-off points.",
        allRecommendations: recommendations,
        stats: {
            peakHour: eveningViews > morningViews ? "Evening" : "Morning/Afternoon",
            bestDay: topSource || "N/A",
            conversionHealth: checkoutRate > 0.4 ? "Excellent" : (checkoutRate > 0.1 ? "Healthy" : "Needs Attention")
        }
    };

    return summaryNote;
};
