/**
 * Seed script to create the initial admin account
 * Run with: npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const existingAdmin = await User.findOne({ email: process.env.ADMIN_EMAIL });
    if (existingAdmin) {
      console.log('Admin already exists');
      process.exit(0);
    }

    const admin = await User.create({
      firstName: 'WhotNaija',
      lastName: 'Admin',
      username: process.env.ADMIN_USERNAME || 'whotnaija_admin',
      email: process.env.ADMIN_EMAIL,
      phone: '+2348000000000',
      state: 'Lagos',
      lga: 'Lagos Island',
      password: process.env.ADMIN_PASSWORD,
      role: 'superadmin',
      isVerified: true,
    });

    console.log('Admin created successfully:', admin.email);
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
}

seedAdmin();
