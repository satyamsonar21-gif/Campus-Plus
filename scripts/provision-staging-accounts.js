/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Campus Plus — Staging Account Provisioning Script
 * 
 * Safely provisions the 5 dedicated staging personas into Supabase Auth (auth.users)
 * linking them to their authoritative records in PostgreSQL (public.users & user_roles).
 * 
 * Usage: node scripts/provision-staging-accounts.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs");
const path = require("node:path");

// Automatically load .env.local if present
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gtwpxjpmwltxwjryazcu.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const stagingPassword = process.env.STAGING_USER_PASSWORD || "CampusPlus2026!";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STAGING_PERSONAS = [
  {
    id: "00000000-0000-0000-0000-000000001001",
    email: "student.a@synthetic.campusplus.internal",
    role: "ROLE_STUDENT",
    label: "Student / Complainant",
  },
  {
    id: "00000000-0000-0000-0000-000000001003",
    email: "handler.it1@synthetic.campusplus.internal",
    role: "ROLE_HANDLER",
    label: "Complaint Handler (IT Dept)",
  },
  {
    id: "00000000-0000-0000-0000-000000001005",
    email: "hod.it@synthetic.campusplus.internal",
    role: "ROLE_DEPT_HEAD",
    label: "Department Head (IT Dept)",
  },
  {
    id: "00000000-0000-0000-0000-000000001006",
    email: "management@synthetic.campusplus.internal",
    role: "ROLE_MANAGEMENT",
    label: "Campus Management",
  },
  {
    id: "00000000-0000-0000-0000-000000001007",
    email: "sysadmin@synthetic.campusplus.internal",
    role: "ROLE_ADMIN",
    label: "System Administrator",
  },
];

async function provisionAll() {
  console.log("=== Provisioning Staging Demonstration Accounts ===");
  console.log(`Supabase URL: ${supabaseUrl}`);

  for (const persona of STAGING_PERSONAS) {
    try {
      // Check if user already exists
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(persona.id);
      
      if (userData && userData.user) {
        // Update password and ensure confirmed
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(persona.id, {
          email: persona.email,
          password: stagingPassword,
          email_confirm: true,
        });
        if (updateError) {
          console.error(`[-] Failed to update ${persona.email}:`, updateError.message);
        } else {
          console.log(`[✓] Updated existing staging user: ${persona.label} (${persona.email})`);
        }
      } else {
        // Create new user with fixed UUID
        const { error: createError } = await supabaseAdmin.auth.admin.createUser({
          id: persona.id,
          email: persona.email,
          password: stagingPassword,
          email_confirm: true,
        });
        if (createError) {
          console.error(`[-] Failed to create ${persona.email}:`, createError.message);
        } else {
          console.log(`[✓] Created staging user: ${persona.label} (${persona.email})`);
        }
      }
    } catch (err) {
      console.error(`[!] Error provisioning ${persona.email}:`, err);
    }
  }

  console.log("=== Provisioning Complete ===");
}

provisionAll();
