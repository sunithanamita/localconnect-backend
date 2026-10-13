class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { ApiError, asyncHandler, escapeRegex };
