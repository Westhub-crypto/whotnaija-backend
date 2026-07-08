const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const SupportTicket = require('../models/SupportTicket');
const { protect, authorize } = require('../middleware/auth');

// POST /api/support/tickets
router.post('/tickets', protect, async (req, res) => {
  try {
    const { subject, category, message } = req.body;
    if (!subject || !category || !message) {
      return res.status(400).json({ success: false, message: 'Subject, category and message are required' });
    }

    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
    const ticket = await SupportTicket.create({
      ticketId,
      userId: req.user._id,
      subject,
      category,
      messages: [{
        sender: 'user',
        senderId: req.user._id,
        senderName: req.user.username,
        content: message,
      }],
    });

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create ticket' });
  }
});

// GET /api/support/tickets
router.get('/tickets', protect, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id })
      .sort('-lastActivityAt')
      .select('-messages');
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tickets' });
  }
});

// GET /api/support/tickets/:ticketId
router.get('/tickets/:ticketId', protect, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      ticketId: req.params.ticketId,
      userId: req.user._id,
    });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch ticket' });
  }
});

// POST /api/support/tickets/:ticketId/reply
router.post('/tickets/:ticketId/reply', protect, async (req, res) => {
  try {
    const { message } = req.body;
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

    const query = { ticketId: req.params.ticketId };
    if (!isAdmin) query.userId = req.user._id;

    const ticket = await SupportTicket.findOne(query);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (ticket.status === 'closed') return res.status(400).json({ success: false, message: 'Ticket is closed' });

    const msgObj = {
      sender: isAdmin ? 'admin' : 'user',
      senderId: req.user._id,
      senderName: req.user.username,
      content: message.substring(0, 2000),
    };

    ticket.messages.push(msgObj);
    ticket.lastActivityAt = new Date();
    if (ticket.status === 'open') ticket.status = 'in-progress';
    await ticket.save();

    res.json({ success: true, message: msgObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
});

// PATCH /api/support/tickets/:ticketId/close
router.patch('/tickets/:ticketId/close', protect, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOneAndUpdate(
      { ticketId: req.params.ticketId, userId: req.user._id },
      { status: 'closed', closedAt: new Date() },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, message: 'Ticket closed', ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to close ticket' });
  }
});

module.exports = router;
