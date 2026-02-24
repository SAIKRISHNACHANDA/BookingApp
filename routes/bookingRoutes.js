const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

router.get('/checkout', bookingController.getBookingPage);
router.post('/create-order', bookingController.createBookingOrder);
router.post('/create-payu-order', bookingController.createPayUOrder);
router.post('/verify-payment', bookingController.verifyPayment);
router.post('/payu-response', bookingController.payuResponse);
router.get('/success', bookingController.getSuccessPage);

module.exports = router;
