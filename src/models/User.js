const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true, trim: true, maxlength: 50 },
  lastName:   { type: String, required: true, trim: true, maxlength: 50 },
  middleName: { type: String, trim: true, maxlength: 50, default: null },
  username: {
    type: String, required: true, unique: true, trim: true, lowercase: true,
    minlength: 3, maxlength: 20,
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores'],
  },
  email: {
    type: String, required: true, unique: true, trim: true, lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
  },
  phone: {
    type: String, required: true, unique: true,
    match: [/^(\+234|0)[789][01]\d{8}$/, 'Invalid Nigerian phone number'],
  },
  country:  { type: String, default: 'Nigeria', enum: ['Nigeria'] },
  state:    { type: String, required: true },
  lga:      { type: String, required: true },
  password: { type: String, required: true, minlength: 8, select: false },

  securityQuestion: { type: String, required: true, minlength: 5, maxlength: 200 },
  securityAnswer:   { type: String, required: true, select: false },

  role:     { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
  avatar:   { type: String, default: null },
  isVerified: { type: Boolean, default: true },
  isActive:   { type: Boolean, default: true },
  isBanned:   { type: Boolean, default: false },
  banReason:  String,

  wallet: {
    balance:        { type: Number, default: 0 },
    bonusBalance:   { type: Number, default: 500 },
    totalDeposited: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    totalWon:       { type: Number, default: 0 },
    totalLost:      { type: Number, default: 0 },
    hasDeposited:   { type: Boolean, default: false },
  },
  bankDetails: {
    accountName: String, accountNumber: String,
    bankName: String, bankCode: String,
    isVerified: { type: Boolean, default: false },
  },
  referral: {
    code:       { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referrals:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    totalEarned: { type: Number, default: 0 },
  },
  gameStats: {
    totalGames:            { type: Number, default: 0 },
    wins:                  { type: Number, default: 0 },
    losses:                { type: Number, default: 0 },
    winStreak:             { type: Number, default: 0 },
    bestWinStreak:         { type: Number, default: 0 },
    level:                 { type: Number, default: 1 },
    xp:                    { type: Number, default: 0 },
    assistedWinsRemaining: { type: Number, default: 3 },
  },
  antiCheat: {
    suspiciousActivityCount: { type: Number, default: 0 },
    lastFlaggedAt: Date,
    flags: [String],
    riskScore: { type: Number, default: 0 },
  },
  passwordResetToken:  String,
  passwordResetExpire: Date,
  lastLogin:      Date,
  lastActive:     Date,
  loginAttempts:  { type: Number, default: 0 },
  lockUntil:      Date,
  onlineStatus:   { type: String, enum: ['online','offline','in-game','in-queue'], default: 'offline' },
  socketId:       String,
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// ── Static list so routes can reference it ────────────────────────────────────

// ── Indexes (only for fields that do NOT already have unique:true in schema) ──
// email, username, phone, referral.code already create their own indexes via unique:true
// We only add extra indexes here for non-unique query patterns
userSchema.index({ onlineStatus: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'antiCheat.riskScore': -1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});
userSchema.virtual('totalBalance').get(function () {
  return this.wallet.balance + (this.wallet.hasDeposited ? this.wallet.bonusBalance : 0);
});

// ── Pre-save hooks ────────────────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('securityAnswer')) return next();
  const salt = await bcrypt.genSalt(10);
  this.securityAnswer = await bcrypt.hash(this.securityAnswer.toLowerCase().trim(), salt);
  next();
});

userSchema.pre('save', function (next) {
  if (!this.referral.code) {
    this.referral.code = this.username.toUpperCase().slice(0, 4) +
      Math.random().toString(36).substring(2, 6).toUpperCase();
  }
  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.compareSecurityAnswer = async function (candidateAnswer) {
  return bcrypt.compare(candidateAnswer.toLowerCase().trim(), this.securityAnswer);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }
  return this.updateOne(updates);
};

userSchema.methods.getAvailableBalance = function () {
  return this.wallet.balance + (this.wallet.hasDeposited ? this.wallet.bonusBalance : 0);
};

module.exports = mongoose.model('User', userSchema);
                     
