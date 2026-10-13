const { ApiError } = require('../utils/helpers');

// usage: validate(zodSchema, 'body' | 'query'); parsed data lands in req.valid
module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return next(new ApiError(400, msg));
  }
  req.valid = result.data;
  next();
};
