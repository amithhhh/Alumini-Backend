import { AppError } from '../utils/AppError.js';

export function zodDetails(error, where) {
  return error.issues.map((i) => ({ in: where, path: i.path.join('.'), message: i.message }));
}

/** validate({ body, query, params }) — replaces each part with its parsed (stripped, coerced) value. */
export const validate = (schemas) => (req, _res, next) => {
  const details = [];
  const out = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const r = schemas[part].safeParse(req[part] ?? {});
    if (r.success) out[part] = r.data;
    else details.push(...zodDetails(r.error, part));
  }
  if (details.length) return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
  Object.assign(req, out);
  return next();
};
