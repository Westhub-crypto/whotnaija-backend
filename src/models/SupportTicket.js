const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'admin'], required: true },
  senderId: mongoose.Schema.Types.ObjectId,
  senderName: String,
  content: { type: String, required: true, maxlength: 2000 },
  attachments: [String],
  readAt: Date,
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  subject: {
    type: String,
    required: true,
    maxlength: 200,
  },
  category: {
    type: String,
    enum: ['payment', 'game-issue', 'account', 'withdrawal', 'technical', 'other'],
    required: true,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open',
  },
  messages: [messageSchema],
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  isLive: { type: Boolean, default: true },
  lastActivityAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  closedAt: Date,
  rating: {
    score: { type: Number, min: 1, max: 5 },
    comment: String,
    ratedAt: Date,
  },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ ticketId: 1 });
supportTicketSchema.index({ lastActivityAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
