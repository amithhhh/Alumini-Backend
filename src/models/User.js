import mongoose from 'mongoose';
import {
  PROGRAMS, WORKING_STATUSES, CATEGORIES, ROLES, APPROVAL_STATUSES, ACCOUNT_STATUSES,
} from '../constants.js';

const { Schema } = mongoose;
const alumniOnly = function () { return this.role === 'alumni'; };

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
    // Optional: accounts created through Google have no password until the user sets one.
    passwordHash: { type: String, select: false },

    phoneCountryCode: { type: String, required: alumniOnly, trim: true },
    phoneNumber: { type: String, required: alumniOnly, trim: true },
    category: { type: String, enum: CATEGORIES, required: alumniOnly },
    academicYearStart: { type: Number, required: alumniOnly },
    academicYearEnd: { type: Number, required: alumniOnly },
    program: { type: String, enum: PROGRAMS, required: alumniOnly },
    workingStatus: { type: String, enum: WORKING_STATUSES, required: alumniOnly },
    companyName: { type: String, trim: true, maxlength: 150 },
    companyWebsite: { type: String, trim: true, maxlength: 300 },
    linkedinUrl: { type: String, trim: true, maxlength: 300 },

    role: { type: String, enum: ROLES, default: 'alumni', required: true },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'pending', required: true },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'active', required: true },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },

    registeredAt: { type: Date, default: Date.now, immutable: true },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    statusChangedAt: Date,
    statusChangedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    statusReason: { type: String, trim: true, maxlength: 1000 },
    lastLoginAt: Date,

    // Incrementing this revokes every outstanding session JWT for the user.
    tokenVersion: { type: Number, default: 0, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: false,
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

// Listing / filtering / dashboard indexes (all admin queries are scoped by role).
userSchema.index({ role: 1, approvalStatus: 1, registeredAt: -1 });
userSchema.index({ role: 1, program: 1 });
userSchema.index({ role: 1, category: 1 });
userSchema.index({ role: 1, academicYearEnd: 1, academicYearStart: 1 });
userSchema.index({ role: 1, workingStatus: 1 });
userSchema.index({ role: 1, fullName: 1 });
userSchema.index({ role: 1, registeredAt: -1 });

export const User = mongoose.model('User', userSchema);
