// ─────────────────────────────────────────────────────────────────────────────
// src/domain/member/memberRegistration.js
//
// Pure business logic — no React, no Supabase.
// ✅ Copy this file as-is into your future React Native project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the registration form data.
 * Returns an error string if invalid, or '' if valid.
 *
 * @param {object} fields
 * @returns {string}
 */
export function validateRegistrationForm(fields) {
  const {
    firstName,
    lastName,
    email,
    studentNumber,
    gender,
    countryOfOrigin,
    educationLevel,
    yearNumber,
  } = fields;

  if (!firstName?.trim()) return 'First name is required';
  if (!lastName?.trim()) return 'Last name is required';
  if (!email?.trim()) return 'Email is required';
  if (!email.includes('@')) return 'Please enter a valid email';
  if (!studentNumber?.trim()) return 'Student number is required';
  if (!gender) return 'Gender is required';
  if (!countryOfOrigin) return 'Nationality is required';
  if (!educationLevel) return 'Programme is required';

  // For foundation, bachelor, master we require a year
  if (educationLevel !== 'alumni' && !yearNumber) {
    return 'Year is required for Foundation, Bachelor and Master students';
  }

  return '';
}

/**
 * Returns the allowed year options for a given education level.
 * Pure function — safe to reuse in React Native.
 *
 * @param {'foundation' | 'bachelor' | 'master' | 'alumni'} educationLevel
 * @returns {number[]}
 */
export function getYearOptions(educationLevel) {
  if (educationLevel === 'foundation') return [1];
  if (educationLevel === 'bachelor') return [1, 2, 3, 4];
  if (educationLevel === 'master') return [1, 2];
  return []; // alumni has no year
}

/**
 * Formats a human-readable label for the programme + year.
 * e.g. formatProgrammeLabel('bachelor', 2) → 'Bachelor – Year 2'
 *
 * @param {string} educationLevel
 * @param {number|null} yearNumber
 * @returns {string}
 */
export function formatProgrammeLabel(educationLevel, yearNumber) {
  if (!educationLevel) return '';

  const level =
    educationLevel.charAt(0).toUpperCase() + educationLevel.slice(1);

  if (educationLevel === 'alumni') return 'Alumni';
  if (yearNumber) return `${level} – Year ${yearNumber}`;
  return level;
}