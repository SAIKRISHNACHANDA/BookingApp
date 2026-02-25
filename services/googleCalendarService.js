const { google } = require('googleapis');
const User = require('../models/User');

const getOAuth2Client = () => {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.BASE_URL || 'http://localhost:3000') + '/auth/google/calendar/callback'
    );
};

exports.generateCalendarAuthUrl = () => {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Crucial for refresh tokens
        prompt: 'consent', // Force consent so we always get refresh_token
        scope: ['https://www.googleapis.com/auth/calendar.events']
    });
};

exports.saveCalendarTokens = async (userId, code) => {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Update user with new tokens
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // Only update tokens that actually came back (sometimes Google skips refresh_token if consent wasn't given, though prompt: consent above forces it)
    user.googleCalendarTokens = {
        ...user.googleCalendarTokens,
        ...tokens
    };
    await user.save();
    return tokens;
};

exports.createMeetEvent = async (booking) => {
    try {
        const host = await User.findById(booking.host);

        if (!host || !host.googleCalendarTokens || !host.googleCalendarTokens.refresh_token) {
            console.log(`[Google Calendar] Host ${booking.host} has not connected their calendar or is missing a refresh token. Cannot auto-create event.`);
            return null;
        }

        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(host.googleCalendarTokens);

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const eventStartTime = new Date(booking.startTime);
        const eventEndTime = new Date(booking.endTime);
        const participantEmail = booking.customer?.email || 'guest@example.com';
        const referenceId = booking._id.toString().substring(booking._id.toString().length - 6).toUpperCase();

        const event = {
            summary: `1:1 Session with ${host.name}`,
            description: `This is a confirmed 1:1 session between ${host.name} and ${booking.customer?.name || 'Guest'}.\n\nBooking Reference ID: ${referenceId}`,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: host.timezone || 'Asia/Kolkata',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: host.timezone || 'Asia/Kolkata',
            },
            attendees: [
                { email: participantEmail }
            ],
            // Request Google Meet generation
            conferenceData: {
                createRequest: {
                    requestId: booking._id.toString(), // random string, unique per request
                    conferenceSolutionKey: {
                        type: 'hangoutsMeet'
                    }
                }
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 10 },
                ],
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            conferenceDataVersion: 1, // Required to get Meet link
            sendUpdates: 'all' // Sends invite emails to all attendees
        });

        // Save event details back to the booking
        const meetLink = response.data.hangoutLink;
        const calendarEventId = response.data.id;

        booking.meetingLink = meetLink;
        booking.calendarEventId = calendarEventId;
        await booking.save();

        console.log(`[Google Calendar] Event successfully created for booking ${booking._id}. Meet Link: ${meetLink}`);

        return { meetLink, calendarEventId };

    } catch (err) {
        console.error(`[Google Calendar] Failed to create event for booking ${booking._id}:`, err.message);
        return null; // Return null so the standard booking/payment flow doesn't completely blow up
    }
};
