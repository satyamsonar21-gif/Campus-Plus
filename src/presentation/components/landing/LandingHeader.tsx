"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BrandShieldIcon } from "./LandingIcons";

export const LandingHeader: React.FC = () => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Brand Logo & Tagline */}
        <Link
          href="/"
          className="flex items-center space-x-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B3C78] rounded"
        >
          <BrandShieldIcon className="w-7 h-7 text-[#0B3C78]" />
          <div className="flex flex-col">
            <span className="font-bold text-slate-900 text-[17px] sm:text-[18px] tracking-tight leading-tight">
              Campus Plus
            </span>
            <span className="text-[10.5px] font-medium text-slate-500 tracking-normal leading-none mt-0.5">
              Accountable. Transparent. Together.
            </span>
          </div>
        </Link>

        {/* Center: Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center space-x-7 text-[13.5px] font-medium text-slate-700">
          <Link
            href="/"
            className="text-[#0B3C78] font-semibold border-b-2 border-[#0B3C78] pb-0.5 transition-colors"
          >
            Home
          </Link>
          <a
            href="#how-it-works"
            className="hover:text-slate-950 transition-colors pb-0.5 border-b-2 border-transparent"
          >
            How It Works
          </a>
          <a
            href="#roles"
            className="hover:text-slate-950 transition-colors pb-0.5 border-b-2 border-transparent"
          >
            Roles
          </a>
          <a
            href="#transparency"
            className="hover:text-slate-950 transition-colors pb-0.5 border-b-2 border-transparent"
          >
            Transparency
          </a>
          <Link
            href="/help"
            className="hover:text-slate-950 transition-colors pb-0.5 border-b-2 border-transparent"
          >
            Help &amp; Support
          </Link>
        </nav>

        {/* Right: Authentication Action Buttons */}
        <div className="hidden sm:flex items-center space-x-2.5">
          <Link
            href="/login"
            className="px-4 py-1.5 rounded-md border border-[#0B3C78] text-[#0B3C78] font-semibold text-xs sm:text-[13px] hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B3C78]"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-4 py-1.5 rounded-md bg-[#0B3C78] hover:bg-[#082C59] text-white font-semibold text-xs sm:text-[13px] shadow-2xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B3C78]"
          >
            Create Account
          </Link>
        </div>

        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="lg:hidden p-1.5 rounded-md text-slate-700 hover:bg-slate-100 focus:outline-hidden"
          aria-label="Toggle navigation menu"
          aria-expanded={isMobileOpen}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isMobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="lg:hidden bg-white border-b border-slate-200 px-4 pt-3 pb-5 space-y-3">
          <div className="flex flex-col space-y-2 text-sm font-medium text-slate-700">
            <Link
              href="/"
              onClick={() => setIsMobileOpen(false)}
              className="px-3 py-1.5 rounded-md bg-blue-50 text-[#0B3C78] font-semibold"
            >
              Home
            </Link>
            <a
              href="#how-it-works"
              onClick={() => setIsMobileOpen(false)}
              className="px-3 py-1.5 rounded-md hover:bg-slate-50"
            >
              How It Works
            </a>
            <a
              href="#roles"
              onClick={() => setIsMobileOpen(false)}
              className="px-3 py-1.5 rounded-md hover:bg-slate-50"
            >
              Roles
            </a>
            <a
              href="#transparency"
              onClick={() => setIsMobileOpen(false)}
              className="px-3 py-1.5 rounded-md hover:bg-slate-50"
            >
              Transparency
            </a>
            <Link
              href="/help"
              onClick={() => setIsMobileOpen(false)}
              className="px-3 py-1.5 rounded-md hover:bg-slate-50"
            >
              Help &amp; Support
            </Link>
          </div>
          <div className="pt-3 border-t border-slate-100 flex flex-col space-y-2">
            <Link
              href="/login"
              onClick={() => setIsMobileOpen(false)}
              className="w-full text-center px-4 py-2 rounded-md border border-[#0B3C78] text-[#0B3C78] font-semibold text-xs sm:text-sm hover:bg-slate-50"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              onClick={() => setIsMobileOpen(false)}
              className="w-full text-center px-4 py-2 rounded-md bg-[#0B3C78] text-white font-semibold text-xs sm:text-sm shadow-xs"
            >
              Create Account
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
