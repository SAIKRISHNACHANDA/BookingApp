const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail', // Optimization for Gmail
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify connection configuration
transporter.verify(function (error, success) {
    if (error) {
        console.error('[EmailService] SMTP Connection Error:', error);
    } else {
        console.log('[EmailService] SMTP Server is ready to take our messages');
    }
});

/**
 * Send booking confirmation email to customer and host
 * @param {Object} booking - The booking object (populated with host and customer)
 */
exports.sendBookingConfirmation = async (booking) => {
    try {
        const startTime = new Date(booking.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const endTime = new Date(booking.endTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        // 1. Email to Customer
        const customerMailOptions = {
            from: `"Booking Support" <${process.env.EMAIL_USER}>`,
            to: booking.customer.email,
            subject: '✅ Booking Confirmed!',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
                    <h2 style="color: #4CAF50;">Booking Confirmed!</h2>
                    <p>Hi <strong>${booking.customer.name}</strong>,</p>
                    <p>Your booking with <strong>${booking.host.name}</strong> has been successfully confirmed.</p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>📅 Time:</strong> ${startTime} - ${endTime}</p>
                        <p><strong>💰 Amount Paid:</strong> ${booking.currency} ${booking.amount}</p>
                    </div>
                    ${booking.meetingLink ? `<p><strong>🔗 Meeting Link:</strong> <a href="${booking.meetingLink}">${booking.meetingLink}</a></p>` : ''}
                    <p>Thank you for using our platform!</p>
                </div>
            `
        };

        // 2. Email to Host
        const hostMailOptions = {
            from: `"Booking System" <${process.env.EMAIL_USER}>`,
            to: booking.host.email || booking.hostId.email, // Handle different population levels
            subject: '📅 New Booking Received!',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
                    <h2 style="color: #2196F3;">New Booking Alert</h2>
                    <p>Hi ${booking.host.name},</p>
                    <p>You have a new booking from <strong>${booking.customer.name}</strong>.</p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>⏰ Time:</strong> ${startTime} - ${endTime}</p>
                        <p><strong>💵 Amount:</strong> ${booking.currency} ${booking.amount}</p>
                    </div>
                    <p>Check your dashboard for more details.</p>
                </div>
            `
        };

        await Promise.all([
            transporter.sendMail(customerMailOptions),
            transporter.sendMail(hostMailOptions)
        ]);

        console.log(`[EmailService] Confirmation emails sent for booking ${booking._id}`);
    } catch (err) {
        console.error('[EmailService] Error sending confirmation emails:', err);
    }
};

/**
 * Send custom email from host to customer
 */
exports.sendCustomEmail = async (to, subject, body, hostName) => {
    try {
        const mailOptions = {
            from: `"${hostName}" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
                    <p>${body.replace(/\n/g, '<br>')}</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin-top: 20px;">
                    <p style="color: #888; font-size: 12px;">This message was sent by ${hostName} via the Booking App.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`[EmailService] Custom email sent to ${to} from ${hostName}`);
        return true;
    } catch (err) {
        console.error('[EmailService] Error sending custom email:', err);
        throw err;
    }
};

