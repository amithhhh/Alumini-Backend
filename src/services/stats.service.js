import { User } from '../models/User.js';

const base = { role: 'alumni' };
const countBy = (field) => User.aggregate([{ $match: base }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);

/** One indexed range count per month (<= 36): continuous, zero-filled series without date-operator dependencies. */
function monthlyCounts(since, months) {
  return Promise.all(Array.from({ length: months }, async (_, i) => {
    const from = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i + 1, 1));
    const count = await User.countDocuments({ ...base, registeredAt: { $gte: from, $lt: to } });
    return { period: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`, count };
  }));
}

export async function getDashboardStats({ months = 12 } = {}) {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCMonth(since.getUTCMonth() - (months - 1));

  const [byApproval, byCategory, byProgram, byYear, byWorking, overTime] = await Promise.all([
    countBy('approvalStatus'),
    countBy('category'),
    countBy('program'),
    User.aggregate([
      { $match: base },
      { $group: { _id: { start: '$academicYearStart', end: '$academicYearEnd' }, count: { $sum: 1 } } },
      { $sort: { '_id.end': 1, '_id.start': 1 } },
    ]),
    countBy('workingStatus'),
    monthlyCounts(since, months),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const a = toMap(byApproval);
  const c = toMap(byCategory);

  const registrationsOverTime = overTime;

  return {
    totals: {
      registrations: Object.values(a).reduce((s, n) => s + n, 0),
      pending: a.pending ?? 0,
      approved: a.approved ?? 0,
      rejected: a.rejected ?? 0,
      indian: c.indian ?? 0,
      nri: c.nri ?? 0,
    },
    byProgram: byProgram.map((r) => ({ program: r._id, count: r.count })).sort((x, y) => y.count - x.count),
    byAcademicYear: byYear.map((r) => ({ academicYearStart: r._id.start, academicYearEnd: r._id.end, label: `${r._id.start}-${r._id.end}`, count: r.count })),
    byWorkingStatus: byWorking.map((r) => ({ workingStatus: r._id, count: r.count })).sort((x, y) => y.count - x.count),
    registrationsOverTime,
  };
}
