const router = require('express').Router();
const { protect, restrictTo } = require('../middleware/auth');
const validate = require('../middleware/validate');
const auth = require('../controllers/authController');
const cat = require('../controllers/categoryController');
const prov = require('../controllers/providerController');
const book = require('../controllers/bookingController');
const pay = require('../controllers/paymentController');
const rev = require('../controllers/reviewController');
const admin = require('../controllers/adminController');

// ---- auth ----
router.post('/auth/register', validate(auth.registerSchema), auth.register);
router.post('/auth/login', validate(auth.loginSchema), auth.login);
router.get('/auth/me', protect, auth.me);

// ---- categories ----
router.get('/categories', cat.list);
router.post('/categories', protect, restrictTo('admin'), validate(cat.createSchema), cat.create);

// ---- providers ----
router.get('/providers', validate(prov.searchSchema, 'query'), prov.search);
router.get('/providers/me/dashboard', protect, restrictTo('provider'), prov.myDashboard);
router.put('/providers/me', protect, restrictTo('provider'), validate(prov.profileSchema), prov.upsertMyProfile);
router.get('/providers/:id', prov.getById);
router.get('/providers/:id/reviews', prov.getReviews);

// ---- bookings ----
router.post('/bookings', protect, restrictTo('customer'), validate(book.createSchema), book.create);
router.get('/bookings', protect, restrictTo('customer', 'provider'), book.listMine);
router.patch('/bookings/:id/status', protect, restrictTo('customer', 'provider'), validate(book.statusSchema), book.updateStatus);

// ---- payments ----
router.post('/payments/order', protect, restrictTo('customer'), validate(pay.orderSchema), pay.createOrder);
router.post('/payments/verify', protect, restrictTo('customer'), validate(pay.verifySchema), pay.verify);

// ---- reviews ----
router.post('/reviews', protect, restrictTo('customer'), validate(rev.createSchema), rev.create);

// ---- admin ----
router.get('/admin/providers', protect, restrictTo('admin'), admin.listProviders);
router.patch('/admin/providers/:id/verify', protect, restrictTo('admin'), validate(admin.verifySchema), admin.setVerified);
router.get('/admin/analytics', protect, restrictTo('admin'), admin.analytics);

module.exports = router;
