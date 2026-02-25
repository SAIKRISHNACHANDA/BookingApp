const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify SMTP connection on startup
transporter.verify(function (error, success) {
    if (error) {
        console.error('[EmailService] SMTP Connection Error:', error.message);
    } else {
        console.log('[EmailService] ✅ SMTP Server ready');
    }
});

/**
 * Send booking confirmation emails to BOTH customer and host
 * @param {Object} booking - Populated booking object (with host)
 */
exports.sendBookingConfirmation = async (booking) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('[EmailService] EMAIL_USER or EMAIL_PASS not set — skipping emails');
            return;
        }

        const startTime = new Date(booking.startTime).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const endTime = new Date(booking.endTime).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit', minute: '2-digit'
        });

        const amountDisplay = booking.amount === 0
            ? 'FREE'
            : `${booking.currency === 'USD' ? '$' : '₹'}${booking.amount}`;

        const paymentIdLine = booking.razorpayPaymentId
            ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Payment ID</td><td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;">${booking.razorpayPaymentId}</td></tr>`
            : '';

        // ─── 1. Customer Email ────────────────────────────────────
        const customerHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
                <tr><td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;">

                        <!-- Header -->
                        <tr>
                            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:40px 40px 32px;text-align:center;">
                                <div style="font-size:40px;margin-bottom:12px;">✅</div>
                                <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Booking Confirmed!</h1>
                                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Your session has been successfully booked</p>
                            </td>
                        </tr>

                        <!-- Body -->
                        <tr>
                            <td style="padding:36px 40px;">
                                <p style="color:#111827;font-size:16px;margin:0 0 24px;">Hi <strong>${booking.customer.name}</strong> 👋</p>
                                <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 28px;">
                                    Your booking with <strong style="color:#4f46e5;">${booking.host.name}</strong> is confirmed. 
                                    Here are your session details:
                                </p>

                                <!-- Booking Details Box -->
                                <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:28px;">
                                    <table width="100%" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">📅 Date & Time</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${startTime} – ${endTime}</td>
                                        </tr>
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">👤 Host</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${booking.host.name}</td>
                                        </tr>
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">💰 Amount Paid</td>
                                            <td style="padding:8px 0;font-weight:700;font-size:14px;text-align:right;color:#059669;">${amountDisplay}</td>
                                        </tr>
                                        ${paymentIdLine}
                                        ${booking.customer.whatsapp ? `
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">📱 WhatsApp</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${booking.customer.whatsapp}</td>
                                        </tr>` : ''}
                                    </table>
                                </div>

                                ${booking.meetingLink ? `
                                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin-bottom:28px;text-align:center;">
                                    <p style="color:#1d4ed8;font-size:14px;margin:0 0 12px;font-weight:600;">🔗 Meeting Link</p>
                                    <a href="${booking.meetingLink}" style="background:#4f46e5;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Join Session</a>
                                </div>` : ''}

                                <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0;">
                                    If you have any questions, feel free to reach out. We look forward to your session!
                                </p>
                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
                                <p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 Gurubrahma. All rights reserved.</p>
                                <p style="color:#9ca3af;font-size:12px;margin:4px 0 0;">This is an automated confirmation email.</p>
                            </td>
                        </tr>

                    </table>
                </td></tr>
            </table>
        </body>
        </html>`;

        // ─── 2. Host Email ────────────────────────────────────────
        const hostHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
                <tr><td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;">

                        <!-- Header -->
                        <tr>
                            <td style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:40px 40px 32px;text-align:center;">
                                <div style="font-size:40px;margin-bottom:12px;">📅</div>
                                <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">New Booking Received!</h1>
                                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Someone just booked a session with you</p>
                            </td>
                        </tr>

                        <!-- Body -->
                        <tr>
                            <td style="padding:36px 40px;">
                                <p style="color:#111827;font-size:16px;margin:0 0 24px;">Hi <strong>${booking.host.name}</strong> 👋</p>
                                <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 28px;">
                                    Great news! <strong style="color:#0ea5e9;">${booking.customer.name}</strong> has booked a session with you.
                                </p>

                                <!-- Booking Details Box -->
                                <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:28px;">
                                    <p style="font-weight:700;color:#111827;font-size:14px;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.05em;">Session Details</p>
                                    <table width="100%" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">📅 Date & Time</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${startTime} – ${endTime}</td>
                                        </tr>
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">👤 Customer</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${booking.customer.name}</td>
                                        </tr>
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">📧 Email</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${booking.customer.email}</td>
                                        </tr>
                                        ${booking.customer.whatsapp ? `
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">📱 WhatsApp</td>
                                            <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;color:#111827;">${booking.customer.whatsapp}</td>
                                        </tr>` : ''}
                                        <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;"></td></tr>
                                        <tr>
                                            <td style="padding:8px 0;color:#6b7280;font-size:14px;">💰 Amount</td>
                                            <td style="padding:8px 0;font-weight:700;font-size:14px;text-align:right;color:#059669;">${amountDisplay}</td>
                                        </tr>
                                        ${paymentIdLine}
                                    </table>
                                </div>

                                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:28px;">
                                    <p style="color:#15803d;font-size:14px;margin:0;">
                                        💡 <strong>Tip:</strong> Reach out to <strong>${booking.customer.name}</strong> before the session to confirm any details. Their WhatsApp: <strong>${booking.customer.whatsapp || 'Not provided'}</strong>
                                    </p>
                                </div>

                                <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0;">
                                    Check your dashboard for full booking history and analytics.
                                </p>
                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
                                <p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 Gurubrahma. All rights reserved.</p>
                                <p style="color:#9ca3af;font-size:12px;margin:4px 0 0;">This is an automated notification email.</p>
                            </td>
                        </tr>

                    </table>
                </td></tr>
            </table>
        </body>
        </html>`;

        const hostEmail = booking.host?.email || booking.hostId?.email;

        await Promise.all([
            transporter.sendMail({
                from: `"Gurubrahma" <${process.env.EMAIL_USER}>`,
                to: booking.customer.email,
                subject: '✅ Booking Confirmed – Session Details Inside',
                html: customerHtml
            }),
            transporter.sendMail({
                from: `"Gurubrahma" <${process.env.EMAIL_USER}>`,
                to: hostEmail,
                subject: `📅 New Booking from ${booking.customer.name}`,
                html: hostHtml
            })
        ]);

        console.log(`[EmailService] ✅ Confirmation emails sent to customer (${booking.customer.email}) and host (${hostEmail})`);

    } catch (err) {
        console.error('[EmailService] ❌ Error sending emails:', err.message);
    }
};

/**
 * Send custom email from host to customer
 */
exports.sendCustomEmail = async (to, subject, body, hostName) => {
    try {
        await transporter.sendMail({
            from: `"${hostName}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: `
                <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:12px;">
                    <p>${body.replace(/\n/g, '<br>')}</p>
                    <hr style="border:none;border-top:1px solid #eee;margin-top:20px;">
                    <p style="color:#9ca3af;font-size:12px;">This message was sent by ${hostName} via Gurubrahma.</p>
                </div>`
        });
        console.log(`[EmailService] Custom email sent to ${to}`);
        return true;
    } catch (err) {
        console.error('[EmailService] Error sending custom email:', err);
        throw err;
    }
};
