import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['google'], required: true },
    // Google "sub": the only stable identifier. Email can change and is never used for identity.
    subject: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    name: String,
    lastLoginAt: Date,
  },
  { timestamps: true },
);

schema.index({ provider: 1, subject: 1 }, { unique: true });
schema.index({ userId: 1, provider: 1 }, { unique: true }); // one identity per provider per user

export const ExternalIdentity = mongoose.model('ExternalIdentity', schema);
