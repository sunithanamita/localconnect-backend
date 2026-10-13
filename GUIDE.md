# LocalConnect: Build Guide (Backend → Frontend → Payments → Analytics → Deploy)

This guide goes with the backend in this folder. Follow it top to bottom.

---

## 0. Decisions already made for you (and why)

| Decision | Choice | Reason |
|---|---|---|
| Database | **MongoDB (Mongoose)** | Built-in geospatial queries (`2dsphere` + `$geoNear`) make "providers near me" a few lines of code. PostgreSQL needs the PostGIS extension for the same thing. |
| Payments | **Razorpay** (with a built-in **mock mode**) | Works with Indian cards/UPI and has a free test mode. Mock mode lets you finish the whole flow with no gateway account. |
| Validation | Zod | One schema per endpoint, clean error messages. |
| Realtime | Socket.io, one private room per user | Provider gets a live "new booking"; customer gets live "accepted / confirmed". |
| Analytics | MongoDB aggregation for the live admin page, plus an NDJSON export to **BigQuery → Looker Studio** | Gives you both an in-app dashboard and a proper data-warehouse story. |

---

## 1. Tools to install (30 min)

1. **Node.js 22 LTS**: https://nodejs.org (check: `node -v`)
2. **MongoDB**: easiest is a free **MongoDB Atlas** cluster (cloud.mongodb.com). Copy its connection string. Or install MongoDB Community locally.
3. **VS Code** + **Postman** (or Thunder Client extension) + **Git** and a GitHub repo.
4. Optional later: Razorpay test account, Google Maps API key, Google Cloud account.

---

## 2. Run the backend (15 min)

```bash
cd localconnect-backend
npm install
cp .env.example .env        # then edit .env
```

Edit `.env`:
- `MONGO_URI`: your Atlas string (add `/localconnect` as the DB name) or `mongodb://127.0.0.1:27017/localconnect`
- `JWT_SECRET`: any long random string
- `SEED_LAT` / `SEED_LNG`: **coordinates of your own city** (Google Maps → right-click a spot → click the coordinates). Seed providers are scattered about 4 km around this point.
- Leave `RAZORPAY_*` empty for now (mock mode).

```bash
npm run seed     # creates admin, a demo customer, categories, 12 providers
npm run dev      # API at http://localhost:5000
```

Check `http://localhost:5000/health` returns `{"status":"ok"}`.

Seed logins (password `Test@12345`, admin uses `ADMIN_PASSWORD` from `.env`):
`admin@localconnect.dev`, `customer@localconnect.dev`, `provider1@localconnect.dev` … `provider12@localconnect.dev`

---

## 3. How the backend is organised

```
src/
  server.js          starts HTTP + Socket.io + DB
  app.js             middleware stack, routes, error handling
  config/db.js       Mongo connection
  models/            User, Category, ProviderProfile, Booking, Payment, Review
  controllers/       business logic (one file per area)
  routes/index.js    every endpoint in one readable file
  middleware/        auth (JWT + role guard), validate (Zod), error
  sockets/index.js   JWT-authenticated socket rooms + notify()
  seed/seed.js       demo data
scripts/exportBookings.js   Mongo → NDJSON for BigQuery
```

### The booking state machine (the heart of the project, explain this in your viva)

```
pending ──provider accepts──▶ accepted ──customer pays (verified)──▶ confirmed ──provider marks done──▶ completed ──▶ review
   │                              │
   ├─provider rejects─▶ rejected  └─customer cancels─▶ cancelled
   └─customer cancels─▶ cancelled
```

Rules enforced in code: only the right person can make each move; a provider cannot have two accepted/confirmed jobs within one hour; payment is only possible for `accepted` bookings; reviews only for `completed` bookings, one per booking.

### Endpoint list

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/api/auth/register` | public | `{name,email,password,role: customer\|provider}` |
| POST | `/api/auth/login` | public | returns JWT |
| GET | `/api/auth/me` | any | current user |
| GET | `/api/categories` | public | list |
| POST | `/api/categories` | admin | create |
| PUT | `/api/providers/me` | provider | create/update own profile (unverified until admin approves) |
| GET | `/api/providers/me/dashboard` | provider | counts by status + earnings |
| GET | `/api/providers?lat&lng&radiusKm&category&minRating&q&page&limit` | public | **geo search** (verified only, nearest first, includes `distanceMeters`) |
| GET | `/api/providers/:id` , `/:id/reviews` | public | profile, reviews |
| POST | `/api/bookings` | customer | request a booking |
| GET | `/api/bookings?status=` | customer/provider | my bookings |
| PATCH | `/api/bookings/:id/status` | customer/provider | `{action: accept\|reject\|cancel\|complete}` |
| POST | `/api/payments/order` | customer | create gateway order |
| POST | `/api/payments/verify` | customer | verify signature → booking becomes `confirmed` |
| POST | `/api/reviews` | customer | `{bookingId,rating,comment}` |
| GET | `/api/admin/providers?verified=false` | admin | approval queue |
| PATCH | `/api/admin/providers/:id/verify` | admin | `{isVerified:true}` |
| GET | `/api/admin/analytics` | admin | dashboard numbers |

---

## 4. Test the whole flow in Postman / curl (45 min)

Do this before writing any frontend. Replace `<…>` with real values. Use header `Authorization: Bearer <token>` where needed.

```bash
B=http://localhost:5000/api

# 1. Customer logs in (copy the token)
curl -s -X POST $B/auth/login -H "Content-Type: application/json" \
  -d '{"email":"customer@localconnect.dev","password":"Test@12345"}'

# 2. Search near your seed point (use your SEED_LAT / SEED_LNG)
curl -s "$B/providers?lat=<LAT>&lng=<LNG>&radiusKm=10&category=plumber"
#    -> copy a provider "_id"

# 3. Customer books it
curl -s -X POST $B/bookings -H "Authorization: Bearer <CUSTOMER_TOKEN>" -H "Content-Type: application/json" \
  -d '{"providerId":"<PROVIDER_ID>","scheduledAt":"2030-01-01T10:00:00Z","address":"12 Test Street"}'
#    -> copy booking "_id"

# 4. Log in as the provider that owns it (providerN@localconnect.dev, N = their position in the seed), then accept
curl -s -X PATCH $B/bookings/<BOOKING_ID>/status -H "Authorization: Bearer <PROVIDER_TOKEN>" \
  -H "Content-Type: application/json" -d '{"action":"accept"}'

# 5. Customer creates a payment order, then verifies it (mock mode: signature must be "mock_signature")
curl -s -X POST $B/payments/order -H "Authorization: Bearer <CUSTOMER_TOKEN>" -H "Content-Type: application/json" \
  -d '{"bookingId":"<BOOKING_ID>"}'
curl -s -X POST $B/payments/verify -H "Authorization: Bearer <CUSTOMER_TOKEN>" -H "Content-Type: application/json" \
  -d '{"bookingId":"<BOOKING_ID>","razorpay_order_id":"<ORDER_ID>","razorpay_payment_id":"pay_mock1","razorpay_signature":"mock_signature"}'

# 6. Provider completes, customer reviews
curl -s -X PATCH $B/bookings/<BOOKING_ID>/status -H "Authorization: Bearer <PROVIDER_TOKEN>" \
  -H "Content-Type: application/json" -d '{"action":"complete"}'
curl -s -X POST $B/reviews -H "Authorization: Bearer <CUSTOMER_TOKEN>" -H "Content-Type: application/json" \
  -d '{"bookingId":"<BOOKING_ID>","rating":5,"comment":"Great work"}'

# 7. Admin analytics
curl -s $B/admin/analytics -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Also try the **failure cases** (they make good viva demos): pay before accept, accept twice, review before completion, customer calling an admin route, booking the same hour twice.

> Commit to GitHub now. Backend done = about 40% of the project.

---

## 5. Frontend (React + Vite)

```bash
npm create vite@latest localconnect-frontend -- --template react
cd localconnect-frontend
npm i axios react-router-dom socket.io-client @react-google-maps/api recharts
```

`.env` → `VITE_API_URL=http://localhost:5000/api`, `VITE_GOOGLE_MAPS_KEY=...`

### Folder layout
```
src/
  api.js                 axios instance + token header
  context/AuthContext.jsx   user, token, login(), logout()  (token in localStorage)
  context/SocketContext.jsx connects with {auth:{token}}
  components/ProtectedRoute.jsx   checks role
  pages/
    Login.jsx, Register.jsx
    Home.jsx              category chips + "use my location" + results list/map
    ProviderDetail.jsx    profile, services, reviews, "Book" form
    MyBookings.jsx        customer: status badges, Pay button, Review button
    provider/Profile.jsx  create/update profile (pick location on map)
    provider/Dashboard.jsx  incoming requests (accept/reject), earnings
    admin/Verify.jsx      approval queue
    admin/Analytics.jsx   recharts from /admin/analytics
```

### Build order (each step is demo-able)
1. **Auth**: register/login, store token, `ProtectedRoute` by role.
2. **Home search**: browser geolocation → call `/providers`:
   ```js
   navigator.geolocation.getCurrentPosition(({ coords }) =>
     api.get('/providers', { params: { lat: coords.latitude, lng: coords.longitude, radiusKm: 10, category } })
        .then(r => setProviders(r.data.providers)));
   ```
   Show `distanceMeters / 1000` as "2.3 km away". Add Google Map markers using `provider.location.coordinates` (**[lng, lat]**, flip for the map).
3. **Provider profile page + booking form**.
4. **Provider dashboard**: list `GET /bookings?status=pending`, buttons call `PATCH /bookings/:id/status`.
5. **Realtime**: in `SocketContext`:
   ```js
   const socket = io(import.meta.env.VITE_API_URL.replace('/api',''), { auth: { token } });
   socket.on('booking:new', () => refetch());       // provider
   socket.on('booking:updated', () => refetch());   // both
   ```
6. **Payment button** (works in both modes):
   ```js
   const { data } = await api.post('/payments/order', { bookingId });
   if (data.mock) {
     await api.post('/payments/verify', { bookingId, razorpay_order_id: data.order.id,
       razorpay_payment_id: 'pay_mock', razorpay_signature: 'mock_signature' });
   } else {
     // add <script src="https://checkout.razorpay.com/v1/checkout.js"> to index.html
     new window.Razorpay({
       key: data.keyId, amount: data.order.amount, currency: 'INR', order_id: data.order.id,
       handler: (r) => api.post('/payments/verify', { bookingId, ...r }),
     }).open();
   }
   ```
7. **Reviews**: star input shown only for `completed` bookings.
8. **Admin pages**: verification queue and recharts charts (bar by category, line per day, pie by status).

---

## 6. Real payments (Razorpay test mode)

1. Sign up at razorpay.com → switch to **Test Mode** → Settings → API Keys → generate.
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the backend `.env` and restart. Mock mode switches off automatically.
3. Test card/UPI details are on Razorpay's docs ("Test Card Details"). No real money moves in test mode.
4. **Never** put the key *secret* in the frontend. The backend verifies the HMAC signature (`order_id|payment_id`), which is what stops someone faking a "paid" booking. Mention this in your report.

---

## 7. Analytics: BigQuery + Looker Studio

1. In the backend folder: `npm run export:bq` → creates `bookings.ndjson`.
2. In BigQuery: create dataset `localconnect`, then
   ```bash
   bq load --autodetect --source_format=NEWLINE_DELIMITED_JSON localconnect.bookings bookings.ndjson
   ```
   (or use "Create table → Upload" in the console).
3. In Looker Studio, connect the `bookings` table and build: bookings by category, by city, daily trend, revenue by category, average rating, cancellation rate.
4. Sample SQL for the report:
   ```sql
   SELECT category, COUNT(*) bookings, SUM(price) value, AVG(rating) avg_rating
   FROM `localconnect.bookings` WHERE status IN ('confirmed','completed')
   GROUP BY category ORDER BY bookings DESC;
   ```
5. Re-run the export to refresh. For a "live" upgrade, schedule it (Cloud Scheduler → Cloud Run job) and mention that as future work.

To get meaningful charts, write a small script (or reuse the seed) that generates 300 to 500 fake bookings across dates, categories and statuses.

---

## 8. Deployment

**Database:** MongoDB Atlas (allow access from anywhere `0.0.0.0/0` for the demo).

**Backend → Cloud Run** (a `Dockerfile` is included):
```bash
gcloud run deploy localconnect-api --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,CLIENT_URL=https://<your-vercel-app>.vercel.app \
  --set-env-vars MONGO_URI=...,JWT_SECRET=...
```
Cloud Run supplies `PORT` automatically (the server reads it). Move secrets to Secret Manager if you have time. Socket.io works over WebSockets on Cloud Run.

**Frontend → Vercel:** push to GitHub, import the repo, set `VITE_API_URL=https://<cloud-run-url>/api` and the Maps key, deploy.

After deploy, run the seed against Atlas once (`MONGO_URI` pointing to Atlas), and re-test the full flow on the live URLs.

---

## 9. Suggested timeline (10 weeks, adjust to your deadline)

| Week | Goal |
|---|---|
| 1 | Setup, run backend, read every file, test in Postman |
| 2 | Auth + roles in frontend, protected routes |
| 3 | Search page, geolocation, map markers |
| 4 | Provider profile + booking form |
| 5 | Provider dashboard, accept/reject, Socket.io live updates |
| 6 | Payments (mock then Razorpay test) |
| 7 | Reviews and ratings, provider earnings |
| 8 | Admin verify + analytics page; BigQuery export + Looker report |
| 9 | Deployment, bug fixing, input validation edge cases |
| 10 | Report, PPT, demo video, viva rehearsal |

---

## 10. Report and viva tips

- Draw 3 diagrams: **architecture**, **ER diagram** (6 collections), **booking state machine** (above). These are the pages evaluators remember.
- Be ready to explain: why JWT + role guard, why GeoJSON is `[lng, lat]`, why the payment signature is verified on the server, why the rating is recomputed with an aggregation, how double-booking is prevented.
- Honest limitations to list: no OTP phone verification, no refunds/payouts, no chat, notifications are not stored, single-region. Then list them as **future work**.
- Add small extras if time allows: unit tests (Jest + Supertest), Swagger docs, image upload for provider photos (Cloudinary), email notifications, provider availability calendar.
