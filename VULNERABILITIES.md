# Intentional Vulnerabilities — Athena Notes

For DevSecOps practice. Find, exploit, and fix these.

---

## 1. NoSQL Injection (backend/server.js — `/api/login`)

`User.findOne({ username })` — `username` comes directly from `req.body` with no type check.

**Exploit:**
```bash
curl -X POST http://localhost:4000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": {"$gt": ""}, "password": "anything"}'
```
MongoDB operator bypasses the username match and returns the first user.

**Fix:** Validate that `username` is a string before querying.

---

## 2. Stored XSS (backend/server.js + frontend/src/app/page.js)

Note `content` stored as raw string. Frontend renders it with `dangerouslySetInnerHTML`.

**Exploit:** Create a note with content:
```html
<img src=x onerror="alert('XSS: ' + document.cookie)">
```

**Fix:** Sanitize HTML server-side (DOMPurify/sanitize-html) before storing; strip on render.

---

## 3. Hardcoded Secrets (.env + docker-compose.yml)

- `JWT_SECRET=supersecret123` committed in `.env` and `docker-compose.yml`
- `MONGO_URI` with plaintext password in both files

**Fix:** Use Docker secrets or a vault. Add `.env` to `.gitignore`. Rotate credentials.

---

## 4. Missing Authorization Check (backend/server.js — `DELETE /api/notes/:id`)

Any authenticated user can delete any note — no ownership check.

**Exploit:**
```bash
# Log in as user A, get token. Delete a note belonging to user B.
curl -X DELETE http://localhost:4000/api/notes/<ANY_NOTE_ID> \
  -H "Authorization: Bearer <USER_A_TOKEN>"
```

**Fix:** Add `{ _id: req.params.id, userId: req.user.id }` to the delete query.

---

## 5. Unauthenticated Debug Endpoint (backend/server.js — `GET /api/debug/users`)

Returns all usernames and IDs with no auth.

**Exploit:**
```bash
curl http://localhost:4000/api/debug/users
```

**Fix:** Remove in production. Add `auth` middleware if kept for dev.

---

## 6. Verbose Error Responses (backend/server.js)

All catch blocks return `err.stack` to the client, leaking file paths and internal logic.

**Fix:** Log stack server-side only. Return generic `"Internal server error"` to client.

---

## 7. Wildcard CORS (backend/server.js)

`app.use(cors())` allows any origin to call the API with credentials.

**Fix:** `cors({ origin: "http://your-frontend-domain.com" })`

---

## 8. MongoDB Port Exposed to Host (docker-compose.yml)

`27017:27017` lets anyone on the host network connect to MongoDB directly.

**Fix:** Remove the `ports` mapping from the `mongo` service. Containers communicate over the internal Docker network.
