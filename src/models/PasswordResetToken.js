import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true }, // SHA-256 of the emailed token; raw token is never stored
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup
schema.index({ userId: 1, usedAt: 1 });

export const PasswordResetToken = mongoose.model('PasswordResetToken', schema);
