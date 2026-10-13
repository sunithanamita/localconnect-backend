exports.notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.code === 11000) { status = 409; message = 'Duplicate value: ' + Object.keys(err.keyValue || {}).join(', '); }
  if (err.name === 'CastError') { status = 400; message = `Invalid ${err.path}`; }
  if (err.name === 'ValidationError') { status = 400; }
  if (status === 500) console.error(err);
  res.status(status).json({ success: false, message });
};
