const express = require('express');
const router = express.Router();
const hostController = require('../controllers/hostController');

// Define routes using the controller functions
router.get('/dashboard', hostController.getDashboard);
router.post('/availability', hostController.setAvailability);
router.post('/availability/delete/:id', hostController.deleteAvailability);
router.post('/send-email', hostController.sendCustomEmail);
// AI Intelligence Route
router.get('/analyze-behavior', hostController.getIntelligence);
router.post('/seed-demo', hostController.seedDemoData);

router.get('/api/hosts/:username/availability', hostController.getAvailabilityAPI);
router.get('/api/hosts/:username/schedule', hostController.getHostSchedule);
router.get('/api/hosts/:username/month-availability', hostController.getMonthAvailability);
router.get('/:username', hostController.getHostProfile);

module.exports = router;
