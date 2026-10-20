# Vercel Deployment & Environment Configuration Guide

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Framework:** Next.js 16.3.4 (App Router + Turbopack)  
**Target Platform:** Vercel Serverless PaaS  
**Database Backend:** Supabase PostgreSQL 17 (`gtwpxjpmwltxwjryazcu` / `ap-northeast-1`)  
**Package Manager:** `pnpm@11.22.0`  

---

## 1. Architecture & Hosting Topology

Campus Plus is built as a 12-factor cloud-ready application. On Vercel:
- **Frontend & Static Pages**: Delivered via Vercel Edge Global CDN.
- **API Route Handlers (`/api/v1/*`)**: Executed as Vercel Serverless Functions (Node.js runtime).
- **Database Connectivity**: Connects to Supabase PostgreSQL 17 using **Supavisor Transaction Connection Pooler** on port `6543` to prevent connection exhaustion in serverless auto-scaling.
- **File Storage**: Private uploads are routed to Supabase Storage bucket `campus-plus-attachments` via pre-signed upload URLs.

---

## 2. Configuration Files in the Repository

| File | Purpose | Location |
| :--- | :--- | :--- |
| `vercel.json` | Vercel deployment settings, build scripts, security headers | Project root |
| `.env.vercel.example` | Production & Preview environment variables reference | Project root |
| `.env.example` | Local development environment template | Project root |

---

## 3. Environment Variables Reference for Vercel

Configure these in the Vercel Dashboard under **Project Settings → Environment Variables**:

| Variable Name | Required Scope | Client/Server | Purpose & Format |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_APP_URL` | Production, Preview | Client | Public application URL (`https://your-domain.vercel.app`) |
| `NEXT_PUBLIC_APP_ENV` | Production, Preview | Client | Environment descriptor (`production` or `staging`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | Client | Supabase HTTPS URL (`https://gtwpxjpmwltxwjryazcu.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | Client | Supabase publishable anonymous JWT key |
| `DATABASE_URL` | Production, Preview | **Server-Only** | Supabase Supavisor Pooler URL (`postgresql://...:6543/postgres`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | **Server-Only** | Supabase service role secret (administrative access) |
| `SUPABASE_JWT_SECRET` | Production, Preview | **Server-Only** | JWT signing secret for token validation |
| `APP_SECRET` | Production, Preview | **Server-Only** | 32+ char random string for cryptographic security |
| `CRON_SECRET` | Production, Preview | **Server-Only** | Bearer secret for automated SLA breach monitors |
| `STORAGE_BUCKET_ATTACHMENTS` | Production, Preview | **Server-Only** | Target storage bucket (`campus-plus-attachments`) |
| `STORAGE_MAX_FILE_SIZE_BYTES` | Production, Preview | **Server-Only** | File upload limit (`5242880` bytes = 5 MB) |
| `NODE_ENV` | Production, Preview | **Server-Only** | `production` |
| `LOG_LEVEL` | Production, Preview | **Server-Only** | `info` or `warn` |

---

## 4. Deploying via Vercel CLI (Step-by-Step)

The Vercel CLI (`54.4.1`) is available globally on the workstation.

### Step 1: Login & Link Project
```bash
# Authenticate with your Vercel account
vercel login

# Link the local workspace to a Vercel project
vercel link
```

### Step 2: Push Environment Variables to Vercel
You can push environment variables directly via the CLI:
```bash
# Add client variables
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add NEXT_PUBLIC_APP_ENV production

# Add server secrets
vercel env add DATABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add APP_SECRET production
vercel env add CRON_SECRET production
```
Or manage them conveniently in bulk through the **Vercel Web Dashboard**.

### Step 3: Trigger Staging Preview Deployment
```bash
vercel
```
This builds and deploys a preview URL without impacting the production alias.

### Step 4: Deploy to Production
```bash
vercel --prod
```

---

## 5. Critical Serverless Considerations with Supabase

1. **Connection Pooling (Port 6543 vs 5432):**
   - In serverless environments like Vercel, requests instantiate stateless function instances. Connecting directly to PostgreSQL on port `5432` will exhaust PostgreSQL's `max_connections` (default 60–100).
   - **Always configure `DATABASE_URL` using the Supavisor Pooler in Transaction Mode (Port `6543`)**.
2. **Zero In-Memory State:**
   - Serverless functions do not share memory between invocations. All session state is validated via Supabase Auth JWTs.
3. **Cold Starts & Build Optimization:**
   - Turbopack compilation is pre-configured via `pnpm build`.
   - Security headers (HSTS, X-Content-Type-Options, X-Frame-Options) are applied at the CDN edge via [`vercel.json`](file:///d:/Deparment%20Project/department%20project/vercel.json).
