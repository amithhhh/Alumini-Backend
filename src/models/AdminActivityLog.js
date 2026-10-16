import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, trim: true },
    resourceType: { type: String, required: true, trim: true },
    resourceId: { type: String, trim: true },
    details: { type: mongoose.Schema.Types.Mixed },
    requestId: { type: String, trim: true },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false }, versionKey: false },
);

schema.index({ timestamp: -1 });
schema.index({ adminId: 1, timestamp: -1 });
schema.index({ action: 1, timestamp: -1 });
schema.index({ resourceType: 1, resourceId: 1 });

// Append-only: application code cannot update or delete audit entries.
const blocked = () => {
  throw new Error('AdminActivityLog is append-only');
};
schema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'replaceOne', 'deleteMany'],
  blocked,
);
schema.pre('deleteOne', { document: true, query: true }, blocked);
schema.pre('save', function () {
  if (!this.isNew) blocked();
});

export const AdminActivityLog = mongoose.model('AdminActivityLog', schema);
