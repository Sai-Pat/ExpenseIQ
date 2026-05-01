const mongoose = require('mongoose');

const categorySchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Please add a category name'],
    },
    budget: {
      type: Number,
      required: [true, 'Please add a monthly budget'],
      default: 0,
    },
    icon: {
      type: String,
      default: 'category',
    },
    color: {
      type: String,
      default: '#4CAF50',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Category', categorySchema);
