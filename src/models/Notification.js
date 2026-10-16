import mongoose from 'mongoose';
import { NOTIFICATION_TYPES, NOTIFICATION_AUDIENCES } from '../constants.js';

const schema = new mongoose.Schema(
  {
    // Every notification has exactly one recipient; broadcasts are fanned out per recipient so
    // read-state is per user and access control is a single equality check.
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    audience: { type: String, enum: NOTIFICATION_AUDIENCES, default: 'user' }, // how it was addressed
    broadcastId: { type: mongoose.Schema.Types.ObjectId }, // groups the copies of one announcement
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    isRead: { type: Boolean, default: false },
    readAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_d, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.recipient;
        delete ret.createdBy;
        delete ret.broadcastId;
        return ret;
      },
    },
  },
);

schema.index({ recipient: 1, isRead: 1, createdAt: -1 });
schema.index({ recipient: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', schema);
