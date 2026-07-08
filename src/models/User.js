const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters'],
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters'],
  },
  middleName: {
    type: String,
    trim: true,
    maxlength: [50, 'Middle name cannot exceed 50 characters'],
    default: null,
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    lowercase: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^(\+234|0)[789][01]\d{8}$/, 'Please provide a valid Nigerian phone number'],
  },
  country: {
    type: String,
    default: 'Nigeria',
    enum: ['Nigeria'],
  },
  state: {
    type: String,
    required: [true, 'State is required'],
  },
  lga: {
    type: String,
    required: [true, 'LGA is required'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user',
  },
  avatar: {
    type: String,
    default: null,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isBanned: {
    type: Boolean,
    default: false,
  },
  banReason: String,
  wallet: {
    balance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 500 }, // Welcome bonus
    totalDeposited: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    totalWon: { type: Number, default: 0 },
    totalLost: { type: Number, default: 0 },
    hasDeposited: { type: Boolean, default: false },
  },
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    bankCode: String,
    isVerified: { type: Boolean, default: false },
  },
  referral: {
    code: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    totalEarned: { type: Number, default: 0 },
  },
  gameStats: {
    totalGames: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    assistedWinsRemaining: { type: Number, default: 3 }, // First 3 wins assisted
  },
  antiCheat: {
    suspiciousActivityCount: { type: Number, default: 0 },
    lastFlaggedAt: Date,
    flags: [String],
    riskScore: { type: Number, default: 0 },
  },
  emailVerificationToken: String,
  emailVerificationExpire: Date,
  passwordResetToken: String,
  passwordResetExpire: Date,
  lastLogin: Date,
  lastActive: Date,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  onlineStatus: {
    type: String,
    enum: ['online', 'offline', 'in-game', 'in-queue'],
    default: 'offline',
  },
  socketId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ 'referral.code': 1 });
userSchema.index({ onlineStatus: 1 });
userSchema.index({ createdAt: -1 });

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual: total balance (wallet + bonus)
userSchema.virtual('totalBalance').get(function () {
  return this.wallet.balance + (this.wallet.hasDeposited ? this.wallet.bonusBalance : 0);
});

// Pre-save: hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Pre-save: generate referral code
userSchema.pre('save', function (next) {
  if (!this.referral.code) {
    this.referral.code = this.username.toUpperCase().slice(0, 4) +
      Math.random().toString(36).substring(2, 6).toUpperCase();
  }
  next();
});

// Method: compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method: check if account is locked
userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Method: increment login attempts
userSchema.methods.incLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hour lock
  }
  return this.updateOne(updates);
};

// Method: generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
  return token;
};

// Method: generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpire = Date.now() + 60 * 60 * 1000;
  return token;
};

// Method: get available balance (wallet + bonus if eligible)
userSchema.methods.getAvailableBalance = function () {
  const walletBal = this.wallet.balance;
  const bonusBal = this.wallet.hasDeposited ? this.wallet.bonusBalance : 0;
  return walletBal + bonusBal;
};

module.exports = mongoose.model('User', userSchema);
