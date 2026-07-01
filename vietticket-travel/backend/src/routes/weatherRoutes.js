const express = require('express');
const { getWeather } = require('../controllers/weatherController');

const router = express.Router();

// Public: dự báo thời tiết theo toạ độ ?lat=&lng=
router.get('/', getWeather);

module.exports = router;
