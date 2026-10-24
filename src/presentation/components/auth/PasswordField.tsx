"use client";

import React, { useState, forwardRef } from "react";
import { cn } from "@/presentation/utils/cn";

export interface PasswordFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label = "Password", error, helperText, className, id = "password", ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
      <div className="space-y-1.5 text-left">
        {label && (
          <div className="flex items-center justify-between">
            <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
              {label}
            </label>
          </div>
        )}
        <div className="relative rounded-lg shadow-2xs">
          <input
            {...props}
            ref={ref}
            id={id}
            type={showPassword ? "text" : "password"}
            autoComplete={props.autoComplete || "current-password"}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${id}-error` : helperText ? `${id}-description` : undefined
            }
            className={cn(
              "block w-full rounded-lg border bg-white px-3.5 py-2.5 pr-10 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-hidden focus:ring-2",
              error
                ? "border-red-300 focus:border-red-500 focus:ring-red-200"
                : "border-slate-300 focus:border-[var(--persona-primary,#7FA8D9)] focus:ring-[var(--persona-secondary,#B8D0EC)]/40",
              className
            )}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={0}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus-visible:outline-hidden focus-visible:text-slate-800 transition-colors cursor-pointer"
          >
            {showPassword ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} className="text-xs text-red-600 font-medium pt-0.5">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={`${id}-description`} className="text-[11px] text-slate-500 pt-0.5">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

PasswordField.displayName = "PasswordField";
