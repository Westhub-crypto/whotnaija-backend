const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

const SQUAD_BASE_URL = process.env.SQUAD_BASE_URL || 'https://api-d.squadco.com';
const SQUAD_SECRET_KEY = process.env.SQUAD_SECRET_KEY;
const MIN_DEPOSIT = parseInt(process.env.MIN_DEPOSIT) || 1000;
const MIN_WITHDRAWAL = parseInt(process.env.MIN_WITHDRAWAL) || 1000;
const REFERRAL_COMMISSION = 50;

const squadAxios = axios.create({
  baseURL: SQUAD_BASE_URL,
  headers: {
    Authorization: `Bearer ${SQUAD_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Shared logic for completing a successful deposit: credits the wallet,
 * marks the transaction completed, unlocks the welcome bonus, and pays
 * the referrer their commission on the user's FIRST successful deposit.
 * Used by both the user-facing /verify endpoint and the Squad webhook,
 * since either one might be the first (or only) path to see a given
 * payment succeed.
 */
async function completeDeposit(transaction) {
  // Re-check inside here too — guards against the webhook and the
  // user-facing verify call racing each other for the same reference.
  const freshTx = await Transaction.findById(transaction._id);
  if (!freshTx || freshTx.status === 'completed') {
    return { alreadyProcessed: true };
  }

  const user = await User.findById(freshTx.userId);
  if (!user) return { alreadyProcessed: false, error: 'User not found' };

  const isFirstDeposit = !user.wallet.hasDeposited;

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    {
      $inc: { 'wallet.balance': freshTx.amount, 'wallet.totalDeposited': freshTx.amount },
      $set: { 'wallet.hasDeposited': true },
    },
    { new: true }
  );

  await Transaction.findByIdAndUpdate(freshTx._id, {
    status: 'completed',
    balanceAfter: updatedUser.wallet.balance,
    processedAt: new Date(),
  });

  if (isFirstDeposit && user.referral?.referredBy) {
    const referrer = await User.findById(user.referral.referredBy);
    if (referrer) {
      await User.findByIdAndUpdate(referrer._id, {
        $inc: {
          'wallet.balance': REFERRAL_COMMISSION,
          'referral.totalEarned': REFERRAL_COMMISSION,
        },
      });

      await Transaction.create({
        userId: referrer._id,
        type: 'referral-bonus',
        amount: REFERRAL_COMMISSION,
        status: 'completed',
        reference: `ref_commission_${user._id}_${Date.now()}`,
        description: `Referral commission from ${user.username}'s first deposit`,
        metadata: { referredUserId: user._id },
      });
    }
  }

  return { alreadyProcessed: false, updatedUser };
}

// @route   POST /api/payment/initiate-deposit
router.post('/initiate-deposit', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    const depositAmount = parseInt(amount);

    if (!depositAmount || depositAmount < MIN_DEPOSIT) {
      return res.status(400).json({
        success: false,
        message: `Minimum deposit is ₦${MIN_DEPOSIT.toLocaleString()}`,
      });
    }

    if (depositAmount > 500000) {
      return res.status(400).json({ success: false, message: 'Maximum deposit is ₦500,000' });
    }

    const user = await User.findById(req.user._id);
    const reference = `whotnaija_dep_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    // Create pending transaction
    await Transaction.create({
      userId: user._id,
      type: 'deposit',
      amount: depositAmount,
      status: 'pending',
      reference,
      description: `Wallet deposit of ₦${depositAmount.toLocaleString()}`,
      balanceBefore: user.wallet.balance,
    });

    // Initialize Squad payment
    const payload = {
      email: user.email,
      amount: depositAmount * 100, // Squad uses kobo
      initiate_type: 'inline',
      currency: 'NGN',
      transaction_ref: reference,
      callback_url: `${process.env.CLIENT_URL}/payment/verify`,
      metadata: {
        userId: user._id.toString(),
        type: 'deposit',
      },
    };

    const squadResponse = await squadAxios.post('/transaction/initiate', payload);

    if (squadResponse.data?.status === 200 || squadResponse.data?.success) {
      res.json({
        success: true,
        data: {
          checkoutUrl: squadResponse.data.data?.checkout_url,
          reference,
          amount: depositAmount,
          publicKey: process.env.SQUAD_PUBLIC_KEY,
        },
      });
    } else {
      throw new Error('Failed to initialize payment');
    }
  } catch (err) {
    logger.error('Deposit initiation error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to initiate payment. Please try again.' });
  }
});

// @route   POST /api/payment/verify/:reference
router.post('/verify/:reference', protect, async (req, res) => {
  try {
    const { reference } = req.params;
    const transaction = await Transaction.findOne({ reference, userId: req.user._id });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (transaction.status === 'completed') {
      return res.json({ success: true, message: 'Transaction already processed', transaction });
    }

    // Verify with Squad
    const verifyResponse = await squadAxios.get(`/transaction/verify/${reference}`);

    if (verifyResponse.data?.data?.transaction_status === 'Success') {
      const result = await completeDeposit(transaction);

      if (result.alreadyProcessed) {
        return res.json({ success: true, message: 'Transaction already processed' });
      }
      if (result.error) {
        return res.status(500).json({ success: false, message: result.error });
      }

      res.json({
        success: true,
        message: 'Deposit successful',
        amount: transaction.amount,
        newBalance: result.updatedUser.wallet.balance,
      });
    } else {
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: 'failed',
        failureReason: 'Payment verification failed',
      });
      res.status(400).json({ success: false, message: 'Payment verification failed' });
    }
  } catch (err) {
    logger.error('Payment verification error:', err.message);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

// @route   POST /api/payment/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-squad-encrypted-body'];
    const body = req.body.toString();

    // Verify webhook signature
    const expectedSig = crypto
      .createHmac('sha512', process.env.SQUAD_WEBHOOK_SECRET)
      .update(body)
      .digest('hex')
      .toUpperCase();

    if (signature !== expectedSig) {
      logger.warn('Invalid webhook signature');
      return res.status(401).json({ success: false });
    }

    const data = JSON.parse(body);
    const { transaction_ref, transaction_status, amount } = data.body || data;

    if (transaction_status === 'Success') {
      const transaction = await Transaction.findOne({ reference: transaction_ref });
      if (transaction && transaction.status === 'pending') {
        await completeDeposit(transaction);
      }
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Webhook error:', err.message);
    res.status(500).json({ success: false });
  }
});

// @route   POST /api/payment/withdraw
router.post('/withdraw', protect, async (req, res) => {
  try {
    const { amount, bankCode, accountNumber, accountName } = req.body;
    const withdrawAmount = parseInt(amount);

    if (!withdrawAmount || withdrawAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal is ₦${MIN_WITHDRAWAL.toLocaleString()}`,
      });
    }

    const user = await User.findById(req.user._id);

    if (!user.wallet.hasDeposited) {
      return res.status(400).json({
        success: false,
        message: 'You must make a deposit before withdrawing',
      });
    }

    if (user.wallet.balance < withdrawAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    if (!bankCode || !accountNumber || !accountName) {
      return res.status(400).json({ success: false, message: 'Bank details are required' });
    }

    // Deduct immediately (pending)
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'wallet.balance': -withdrawAmount },
    });

    const reference = `whotnaija_wdr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const transaction = await Transaction.create({
      userId: user._id,
      type: 'withdrawal',
      amount: withdrawAmount,
      status: 'processing',
      reference,
      description: `Withdrawal to ${bankCode} - ${accountNumber}`,
      balanceBefore: user.wallet.balance,
      balanceAfter: user.wallet.balance - withdrawAmount,
      metadata: { bankName: accountName, accountNumber, bankCode },
    });

    // Initiate Squad transfer
    try {
      const transferPayload = {
        account_number: accountNumber,
        bank_code: bankCode,
        currency_id: 'NGN',
        amount: withdrawAmount * 100,
        transaction_reference: reference,
        remark: `WhotNaija withdrawal - ${user.username}`,
      };

      const transferResponse = await squadAxios.post('/payout/transfer', transferPayload);

      if (transferResponse.data?.status === 200) {
        await Transaction.findByIdAndUpdate(transaction._id, {
          status: 'completed',
          squadReference: transferResponse.data.data?.transaction_reference,
          processedAt: new Date(),
        });

        await User.findByIdAndUpdate(req.user._id, {
          $inc: { 'wallet.totalWithdrawn': withdrawAmount },
        });

        res.json({ success: true, message: 'Withdrawal initiated successfully', reference });
      } else {
        // Refund on failure
        await User.findByIdAndUpdate(req.user._id, { $inc: { 'wallet.balance': withdrawAmount } });
        await Transaction.findByIdAndUpdate(transaction._id, { status: 'failed', failureReason: 'Transfer failed' });
        res.status(400).json({ success: false, message: 'Withdrawal failed. Your balance has been refunded.' });
      }
    } catch (transferErr) {
      // Refund on exception
      await User.findByIdAndUpdate(req.user._id, { $inc: { 'wallet.balance': withdrawAmount } });
      await Transaction.findByIdAndUpdate(transaction._id, { status: 'failed', failureReason: transferErr.message });
      throw transferErr;
    }
  } catch (err) {
    logger.error('Withdrawal error:', err.message);
    res.status(500).json({ success: false, message: 'Withdrawal failed. Please try again.' });
  }
});

// @route   GET /api/payment/banks
router.get('/banks', protect, async (req, res) => {
  try {
    const response = await squadAxios.get('/transaction/banks');
    res.json({ success: true, banks: response.data?.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch banks' });
  }
});

// @route   POST /api/payment/verify-account
router.post('/verify-account', protect, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;
    const response = await squadAxios.get(`/transaction/bank-account-details?account_number=${accountNumber}&bank_code=${bankCode}`);

    if (response.data?.data?.account_name) {
      res.json({ success: true, accountName: response.data.data.account_name });
    } else {
      res.status(400).json({ success: false, message: 'Could not verify account' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Account verification failed' });
  }
});

module.exports = router;
