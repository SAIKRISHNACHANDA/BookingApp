const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.get('/login', adminController.loginGet);
router.post('/login', adminController.loginPost);
router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.get('/bookings', adminController.getBookings);
router.get('/logout', adminController.logout);

module.exports = router;
