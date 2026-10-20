# Campus Plus — Campus Complaint & Grievance Resolution System

[![Phase 03 Verified](https://img.shields.io/badge/Phase%2003-Verified-emerald.svg)](#)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.3.4-black.svg)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2.8-blue.svg)](https://react.dev/)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9.3-3178C6.svg)](https://www.typescriptlang.org/)
[![Vitest 5.0](https://img.shields.io/badge/Vitest-5.0.0-yellow.svg)](https://vitest.dev/)
[![pnpm 11.22](https://img.shields.io/badge/pnpm-11.22.0-orange.svg)](https://pnpm.io/)

> **Campus Plus** is an enterprise-grade grievance management and complaint resolution platform designed specifically for higher education institutions. It provides transparent complaint tracking, multi-tier escalation, verifiable resolutions, privacy-preserving anonymity, and actionable campus intelligence.

---

## 1. Architectural Blueprint

Campus Plus is constructed as a **Domain-Centric Modular Monolith** adhering to strict Clean Architecture boundaries:

```
src/
├── config/             # Zod-validated environment schema & boundary enforcement
├── domain/             # Enterprise business rules, entities, and state machines
│   ├── common/         # Result monad, Entity base, DomainEvent contract
│   └── complaint/      # ComplaintStatus (FSM), priorities, categories, SLA rules
├── application/        # Application use cases, DTOs, and port interfaces
│   ├── common/         # UseCase contract
│   └── ports/          # Repositories, storage, and notification contracts
├── infrastructure/     # External adapters, persistence implementations, logging
│   ├── database/       # DB client contract & stub (Phase 04+ Ready)
│   ├── storage/        # In-memory / S3-compatible storage adapter
│   └── logging/        # Structured JSON logger with automated PII scrubbing
├── presentation/       # UI components and layout primitives
│   └── components/     # Clean, composable UI building blocks
├── shared/             # Cross-cutting error taxonomy, types, and utilities
│   ├── errors/         # AppError hierarchy, status codes, and serialization
│   ├── types/          # Common types (Pagination, Sorting, IDs)
│   └── utils/          # PII redactors, correlation ID generator
└── app/                # Next.js App Router (Pages, Layouts, API endpoints)
    └── api/health/     # Decoupled liveness & readiness health check endpoint
```

---

## 2. Prerequisites & Toolchain

| Tool | Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.19.0` (Verified on `24.13.0`) | JavaScript runtime engine |
| **pnpm** | `>= 10.0.0` (Verified on `11.22.0`) | Fast, disk-efficient package manager |
| **TypeScript** | `5.9.3` | Strict static typing (`strict: true`, `noEmit`) |
| **Vitest** | `5.0.0` | High-speed unit and integration test runner |
| **Next.js** | `16.3.4` (App Router + Turbopack) | Full-stack React framework |

---

## 3. Quick Start & Local Setup

### Step 1: Clone and Enter Workspace
```bash
git clone <repository-url>
cd "department project"
```

### Step 2: Configure Environment Variables
```bash
# Copy the environment template
copy .env.example .env.local    # Windows PowerShell / CMD
# or: cp .env.example .env.local # macOS / Linux
```

> **Security Notice**: `.env.example` contains safe non-production dummy values. Never commit live production credentials, service role keys, or database secrets to Git.

### Step 3: Install Dependencies
```bash
pnpm install
```

### Step 4: Run the Quality Gate
Verify code formatting, typing, test suite, and production build:
```bash
pnpm verify
```

### Step 5: Start Local Development Server
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Quality & Verification Commands

All quality scripts in `package.json` are strictly verified and execute real tooling:

| Command | Action | Verification Scope |
| :--- | :--- | :--- |
| `pnpm dev` | Start development server | Next.js App Router with hot reloading |
| `pnpm build` | Production compilation | Next.js Turbopack build with static analysis |
| `pnpm start` | Production server | Serves optimized production build |
| `pnpm lint` | Code linting | ESLint 9 with Next.js & TypeScript rules |
| `pnpm lint:fix`| Auto-fix linting | Automatically rectifies auto-fixable lint issues |
| `pnpm typecheck`| Type validation | `tsc --noEmit` validating strict TypeScript |
| `pnpm test` | Run test suite | Vitest unit test suite (domain, errors, config) |
| `pnpm test:watch`| Test watcher | Vitest interactive test watcher |
| **`pnpm verify`**| **Aggregate Gate** | **Runs typecheck + lint + test + build sequentially** |

---

## 5. Observability & Health Endpoints

Campus Plus includes an unauthenticated, decoupled health check endpoint:

* **Liveness Probe**: `GET /api/health` or `GET /api/health?type=liveness`
  * Returns process status, version, uptime, and environment.
* **Readiness Probe**: `GET /api/health?type=readiness`
  * Returns detailed memory metrics (heap, RSS) and configuration readiness.

---

## 6. Vercel Deployment & Cloud Environment Setup

Campus Plus is production-ready for deployment on **Vercel** paired with **Supabase PostgreSQL 17**.

### 1. Vercel Configuration & Environment Templates
- **[`vercel.json`](file:///d:/Deparment%20Project/department%20project/vercel.json)**: Contains build presets, Turbopack scripts, and security headers (HSTS, X-Content-Type-Options, X-Frame-Options, CSP, and Referrer-Policy).
- **[`.env.vercel.example`](file:///d:/Deparment%20Project/department%20project/.env.vercel.example)**: Comprehensive mapping of all client (`NEXT_PUBLIC_`) and server-only variables for Vercel Project Settings.
- **Detailed Documentation**: See [**`docs/engineering/infrastructure/VERCEL-ENVIRONMENT-SETUP.md`**](file:///d:/Deparment%20Project/department%20project/docs/engineering/infrastructure/VERCEL-ENVIRONMENT-SETUP.md).

### 2. Required Environment Variables for Vercel
Configure in **Vercel Dashboard → Project Settings → Environment Variables**:
- `NEXT_PUBLIC_APP_URL`: Production URL (e.g. `https://campus-plus.vercel.app`)
- `NEXT_PUBLIC_APP_ENV`: `production` or `staging`
- `NEXT_PUBLIC_SUPABASE_URL`: Target Supabase HTTPS URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase publishable anonymous key
- `DATABASE_URL`: Supabase Transaction Pooler URL (`aws-0-*.pooler.supabase.com:6543/postgres`)
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only administrative key
- `APP_SECRET`: 32+ character random encryption secret
- `CRON_SECRET`: Random secret for authorized SLA monitors
- `STORAGE_BUCKET_ATTACHMENTS`: `campus-plus-attachments`

### 3. Deploy via Vercel CLI
```bash
# Link repository to Vercel
vercel link

# Pull environment variables locally
vercel env pull

# Deploy staging preview
vercel

# Deploy to production
vercel --prod
```

---

## 7. Engineering Roadmap

- [x] **Phase 00**: Forensic Reconnaissance & Toolchain Audit
- [x] **Phase 01**: Requirements Engineering & Traceability Matrix (38 MUST Requirements)
- [x] **Phase 02**: Architecture Definition & Technical Blueprint (12 ADRs)
- [x] **Phase 03**: Engineering Foundation & Project Initialization
- [ ] **Phase 04**: Database Modeling, Migrations & Supabase RLS Schema
- [ ] **Phase 05**: Domain Core & State Machine Implementation
- [ ] **Phase 06**: Application Services & API Route Handlers
- [ ] **Phase 07**: Presentation Layer & User Portals
- [ ] **Phase 08**: Security Hardening, Audit Trail & Role-Based Access Control
- [ ] **Phase 09**: QA, Performance Benchmarking & E2E Validation
- [ ] **Phase 10**: Production Deployment & Institutional Readiness

---

## 7. License & Compliance

Confidential and proprietary software for academic institutions. All rights reserved. Refer to [SECURITY.md](file:///d:/Deparment%20Project/department%20project/SECURITY.md) for vulnerability reporting procedures.
