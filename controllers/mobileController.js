const Expense = require('../models/Expense');
const Category = require('../models/Category');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// Simple in-memory cache for analytics
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

// @desc    Get expenses (paginated + sync support)
// @route   GET /api/m/expenses
// @access  Private
const getExpenses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const since = req.query.since ? new Date(req.query.since) : null;

    const query = { user: req.user._id };
    if (since) {
      query.updatedAt = { $gt: since };
    }

    const expenses = await Expense.find(query)
      .populate('category', 'name icon color')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      count: expenses.length,
      data: expenses.map(exp => ({
        id: exp._id,
        title: exp.title,
        amount: exp.amount,
        category: exp.category?.name || 'Uncategorized',
        date: exp.date,
        isDeleted: exp.isDeleted
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create expense + Budget alert logic
// @route   POST /api/m/expenses
// @access  Private
const createExpense = async (req, res) => {
  try {
    const { title, amount, categoryId, date, description } = req.body;

    const expense = await Expense.create({
      user: req.user._id,
      category: categoryId,
      title,
      amount,
      date,
      description
    });

    // Budget Alert Logic
    const category = await Category.findById(categoryId);
    if (category && category.budget > 0) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const totalSpent = await Expense.aggregate([
        {
          $match: {
            user: req.user._id,
            category: new mongoose.Types.ObjectId(categoryId),
            date: { $gte: startOfMonth },
            isDeleted: false
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      const spent = totalSpent.length > 0 ? totalSpent[0].total : 0;
      const usagePercent = (spent / category.budget) * 100;

      if (usagePercent >= 80) {
        await Notification.create({
          user: req.user._id,
          title: 'Budget Alert',
          message: `You have spent ${usagePercent.toFixed(1)}% of your ${category.name} budget.`,
          type: 'budget_alert'
        });
      }
    }

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Get categories
// @route   GET /api/m/categories
// @access  Private
const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ user: req.user._id }).lean();
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get summary (today, week, month)
// @route   POST /api/m/expenses/summary
// @access  Private
const getSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    
    const todayStart = new Date(now).setHours(0,0,0,0);
    const weekStart = new Date(now).setDate(now.getDate() - now.getDay());
    const monthStart = new Date(now).setDate(1);

    const getAggregate = async (start) => {
      const result = await Expense.aggregate([
        { $match: { user: userId, date: { $gte: new Date(start) }, isDeleted: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      return result.length > 0 ? result[0].total : 0;
    };

    const [today, week, month] = await Promise.all([
      getAggregate(todayStart),
      getAggregate(weekStart),
      getAggregate(monthStart)
    ]);

    res.json({
      success: true,
      data: { today, week, month }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Home screen analytics
// @route   GET /api/m/analytics/summary
// @access  Private
const getAnalytics = async (req, res) => {
  const cacheKey = `analytics_${req.user._id}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
    return res.json({ success: true, data: cachedData.data, cached: true });
  }

  try {
    const userId = req.user._id;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0,0,0,0);

    // Monthly total
    const monthlyTotalRes = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: monthStart }, isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const monthlyTotal = monthlyTotalRes.length > 0 ? monthlyTotalRes[0].total : 0;

    // Top 3 categories
    const topCategories = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: monthStart }, isDeleted: false } },
      { $group: { _id: '$category', amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: '$categoryInfo' },
      {
        $project: {
          name: '$categoryInfo.name',
          amount: 1
        }
      }
    ]);

    // 7-day breakdown
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const dailyBreakdown = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: sevenDaysAgo }, isDeleted: false } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const result = {
      monthlyTotal,
      topCategories,
      dailyBreakdown
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get notifications
// @route   GET /api/m/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getExpenses,
  createExpense,
  getCategories,
  getSummary,
  getAnalytics,
  getNotifications
};
