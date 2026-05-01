const express = require('express');
const router = express.Router();
const {
  getExpenses,
  createExpense,
  getCategories,
  getSummary,
  getAnalytics,
  getNotifications
} = require('../controllers/mobileController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/expenses')
  .get(getExpenses)
  .post(createExpense);

router.post('/expenses/summary', getSummary);

router.get('/categories', getCategories);

router.get('/analytics/summary', getAnalytics);

router.get('/notifications', getNotifications);

module.exports = router;
