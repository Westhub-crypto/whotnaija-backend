const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

// Send token response
const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user._id);

  const cookieOptions = {
    expires: new Date(Date.now() + parseInt(process.env.JWT_COOKIE_EXPIRE || 7) * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };

  res.status(statusCode)
    .cookie('token', token, cookieOptions)
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        wallet: user.wallet,
        gameStats: user.gameStats,
        referral: { code: user.referral?.code },
        avatar: user.avatar,
        securityQuestion: user.securityQuestion,
      },
    });
};

// Validation rules for registration
const registerValidation = [
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
  body('username').trim().notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('email').isEmail().withMessage('Invalid email address').normalizeEmail(),
  body('phone').matches(/^(\+234|0)[789][01]\d{8}$/).withMessage('Invalid Nigerian phone number'),
  body('state').notEmpty().withMessage('State is required'),
  body('lga').notEmpty().withMessage('LGA is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase and number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  body('securityQuestion').notEmpty().withMessage('Security question is required')
    .custom((value) => {
      const questions = User.SECURITY_QUESTIONS || [];
      if (!questions.includes(value)) throw new Error('Invalid security question selected');
      return true;
    }),
  body('securityAnswer').trim().notEmpty().withMessage('Security answer is required')
    .isLength({ min: 2, max: 100 }).withMessage('Security answer must be 2-100 characters'),
];

// @route   POST /api/auth/register
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      firstName, lastName, middleName, username, email, phone,
      state, lga, password, referralCode, securityQuestion, securityAnswer,
    } = req.body;

    // Check for existing user
    const existingUser = await User.findOne({
      $or: [{ email }, { username: username.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      let field = 'User';
      if (existingUser.email === email) field = 'Email';
      else if (existingUser.username === username.toLowerCase()) field = 'Username';
      else if (existingUser.phone === phone) field = 'Phone number';
      return res.status(400).json({ success: false, message: `${field} already exists` });
    }

    // Handle referral code
    let referredByUser = null;
    if (referralCode) {
      referredByUser = await User.findOne({ 'referral.code': referralCode.toUpperCase() });
    }

    const user = await User.create({
      firstName,
      lastName,
      middleName: middleName || null,
      username: username.toLowerCase(),
      email,
      phone,
      state,
      lga,
      password,
      securityQuestion,
      securityAnswer, // hashed by the pre-save hook
      referral: {
        referredBy: referredByUser?._id || null,
      },
    });

    // Link referral
    if (referredByUser) {
      await User.findByIdAndUpdate(referredByUser._id, {
        $push: { 'referral.referrals': user._id },
      });
    }

    // Record welcome bonus
    await Transaction.create({
      userId: user._id,
      type: 'welcome-bonus',
      amount: 500,
      status: 'completed',
      reference: `welcome_${user._id}_${Date.now()}`,
      description: 'Welcome bonus for new registration',
      balanceBefore: 0,
      balanceAfter: 500,
    });

    sendTokenResponse(user, 201, res);
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return res.status(400).json({ success: false, message: `${field} already exists` });
    }
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// @route   POST /api/auth/login
router.post('/login', [
  body('identifier').notEmpty().withMessage('Email or username is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { identifier, password } = req.body;

    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
      ],
    }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account temporarily locked due to too many failed login attempts. Try again in 2 hours.',
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: `Your account has been suspended. Reason: ${user.banReason || 'Violation of terms'}`,
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await user.incLoginAttempts();
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Reset login attempts on success
    if (user.loginAttempts > 0) {
      await user.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// @route   POST /api/auth/logout
router.post('/logout', protect, async (req, res) => {
  res.cookie('token', 'none', { expires: new Date(Date.now() + 10 * 1000), httpOnly: true });
  res.json({ success: true, message: 'Logged out successfully' });
});

// @route   GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -securityAnswer');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// @route   GET /api/auth/security-questions
// Returns the list of available security questions for the registration form dropdown
router.get('/security-questions', (req, res) => {
  res.json({ success: true, questions: User.SECURITY_QUESTIONS });
});

// @route   POST /api/auth/forgot-password/verify-identity
// Step 1 — user supplies email + answer to their security question
// Returns a short-lived reset token if the answer is correct
router.post('/forgot-password/verify-identity', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('securityAnswer').trim().notEmpty().withMessage('Security answer is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, securityAnswer } = req.body;

    // Always use the same generic error message to avoid revealing
    // whether the email exists in the system
    const IDENTITY_FAIL = 'Email or security answer is incorrect';

    const user = await User.findOne({ email }).select('+securityAnswer');
    if (!user) {
      return res.status(400).json({ success: false, message: IDENTITY_FAIL });
    }

    const isCorrect = await user.compareSecurityAnswer(securityAnswer);
    if (!isCorrect) {
      return res.status(400).json({ success: false, message: IDENTITY_FAIL });
    }

    // Identity confirmed — issue a single-use reset token (expires in 15 minutes)
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetExpire = Date.now() + 15 * 60 * 1000; // 15 min
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'Identity verified. You may now reset your password.',
      resetToken: rawToken,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
});

// @route   POST /api/auth/forgot-password/get-question
// Helper — given an email, returns that user's security question
// (so the frontend can display the right question before asking for the answer)
router.post('/forgot-password/get-question', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const user = await User.findOne({ email: req.body.email }).select('securityQuestion');

    // Always respond 200 with a question (even if fake) to prevent email enumeration
    const question = user?.securityQuestion || 'What is the name of your first pet?';
    res.json({ success: true, question });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve question.' });
  }
});

// @route   POST /api/auth/reset-password/:token
// Step 2 — user supplies the token from verify-identity + new password
router.post('/reset-password/:token', [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase and number'),
  body('confirmPassword').custom((v, { req }) => {
    if (v !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const crypto = require('crypto');
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset token is invalid or has expired' });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpire = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. Please login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password reset failed. Please try again.' });
  }
});

module.exports = router;
          
