import React from "react";
import Link from "next/link";
import { BrandShieldIcon, MailIcon, PhoneIcon } from "./LandingIcons";

export const LandingFooter: React.FC = () => {
  return (
    <footer id="help" className="bg-[#0A2540] text-slate-300 py-6 sm:py-7 border-t border-[#082038]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-5 text-xs">
          {/* Left: Brand Monogram & Mission */}
          <div className="flex items-center space-x-3 text-left">
            <BrandShieldIcon className="w-7 h-7 shrink-0 text-white" inverted={true} />
            <div>
              <p className="font-semibold text-white text-xs sm:text-[13px]">
                Campus Plus is built for a better campus experience.
              </p>
              <p className="text-slate-400 text-[10.5px] mt-0.5">
                Your voice matters. We ensure it leads to action.
              </p>
            </div>
          </div>

          {/* Middle: Need Help */}
          <div className="flex items-center space-x-2">
            <MailIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <div>
              <span className="text-slate-400 text-[10px] block leading-none">Need Help?</span>
              <a
                href="mailto:support@campusplus.edu"
                className="text-white text-[11.5px] font-medium hover:underline mt-0.5 block"
              >
                support@campusplus.edu
              </a>
            </div>
          </div>

          {/* Middle-Right: Emergencies */}
          <div className="flex items-center space-x-2">
            <PhoneIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <div>
              <span className="text-slate-400 text-[10px] block leading-none">For Emergencies</span>
              <span className="text-white text-[11.5px] font-medium mt-0.5 block">Contact Your Institution</span>
            </div>
          </div>

          {/* Far Right: Links & Copyright */}
          <div className="text-center md:text-right">
            <div className="flex items-center justify-center md:justify-end space-x-3 text-[11px] mb-1">
              <Link href="/terms" className="text-slate-400 hover:text-white transition-colors">
                Terms of Use
              </Link>
              <span className="text-slate-600">&bull;</span>
              <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">
                Privacy Policy
              </Link>
            </div>
            <div className="text-white text-xs font-semibold">&copy; 2025 Campus Plus</div>
            <div className="text-slate-400 text-[10.5px] mt-0.5">All rights reserved.</div>
          </div>
        </div>
      </div>
    </footer>
  );
};
