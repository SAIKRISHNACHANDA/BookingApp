const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

router.get('/checkout', bookingController.getBookingPage);
router.post('/create-order', bookingController.createBookingOrder);
router.post('/create-payu-order', bookingController.createPayUOrder);
router.post('/verify-payment', bookingController.verifyPayment);

// ✅ Mobile redirect route — Razorpay POSTs here on mobile after payment
router.post('/verify-payment-redirect', bookingController.verifyPaymentRedirect);

router.post('/payu-response', bookingController.payuResponse);
router.get('/success', bookingController.getSuccessPage);

// Payment failed fallback page
router.get('/payment-failed', (req, res) => {
    res.render('success', {
        title: 'Payment Failed',
        user: req.session.user,
        failed: true,
        reason: req.query.reason || 'unknown'
    });
});

module.exports = router;

