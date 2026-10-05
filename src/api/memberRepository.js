// ─────────────────────────────────────────────────────────────────────────────
// src/api/memberRepository.js
//
// All Supabase calls for member registration.
// ✅ Copy this file as-is into your future React Native project
// (Supabase JS client works in React Native too).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase';

export const ALREADY_REGISTERED_MESSAGE =
  '\uC774\uBBF8 \uAC00\uC785\uB41C \uD68C\uC6D0\uC785\uB2C8\uB2E4. \uB85C\uADF8\uC778\uD558\uAC70\uB098 \uC774\uBA54\uC77C \uC778\uC99D\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.';

export async function changeUnconfirmedRegistrationEmail({ currentEmail, newEmail, password }) {
  const { data, error } = await supabase.functions.invoke('change-pending-email', {
    body: { currentEmail, newEmail, password },
  });

  if (error) throw new Error(error.message || 'Unable to change the email address.');
  if (!data?.success) throw new Error(data?.message || 'Unable to change the email address.');
}

function isAlreadyRegisteredError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return (
    code === '23505' ||
    message.includes('duplicate key') ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('members_user_id_key') ||
    message.includes('members_use_id_key')
  );
}

/**
 * Creates a Supabase Auth account and stores only pending profile metadata.
 * The members row is created server-side after the email is confirmed.
 *
 * @param {{
 *  email: string,
 *  password: string,
 *  firstName: string,
 *  lastName: string,
 *  firstNameKorean?: string,
 *  lastNameKorean?: string,
 *  studentNumber: string,
 *  yearOfBirth: number | null,
 *  gender: string,
 *  countryOfOrigin: string,
 *  university: string,
 *  major: string,
 *  educationLevel: 'foundation' | 'bachelor' | 'master' | 'alumni',
 *  yearNumber: number | null,
 *  legalDocumentsVersion?: string,
 * }} payload
 *
 * @returns {Promise<{ userId: string }>}
 */
export async function registerMember(payload) {
  const {
    email,
    password,
    firstName,
    lastName,
    firstNameKorean,
    lastNameKorean,
    studentNumber,
    yearOfBirth,
    gender,
    countryOfOrigin,
    university,
    major,
    educationLevel,
    yearNumber,
    legalDocumentsVersion,
  } = payload;

  const normalizedEmail = email.trim().toLowerCase();

  // Preflight with the submitted password. If this succeeds, or Supabase says
  // the email exists but is not confirmed, stop before sending another signup email.
  const { data: existingLogin, error: existingLoginError } =
    await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

  if (existingLogin?.user) {
    await supabase.auth.signOut();
    throw new Error(ALREADY_REGISTERED_MESSAGE);
  }

  if (
    existingLoginError &&
    String(existingLoginError.message || '').toLowerCase().includes('email not confirmed')
  ) {
    throw new Error(ALREADY_REGISTERED_MESSAGE);
  }

  // Create the Auth user. The requested profile is untrusted pending data;
  // only the server creates the members row after Supabase confirms the email.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      emailRedirectTo:
        'https://app.uva-in.nl/email-confirmed',
      // You can pass extra metadata here if needed
      data: {
        first_name: firstName,
        last_name: lastName,
        registration: {
          first_name: firstName,
          last_name: lastName,
          first_name_korean: firstNameKorean || null,
          last_name_korean: lastNameKorean || null,
          student_number: studentNumber,
          year_of_birth: yearOfBirth,
          gender,
          country_of_origin: countryOfOrigin,
          university,
          major,
          education_level: educationLevel,
          year_number: yearNumber,
          privacy_policy_version: legalDocumentsVersion || null,
          legal_documents: {
            terms: legalDocumentsVersion || null,
            privacy: legalDocumentsVersion || null,
            community: legalDocumentsVersion || null,
          },
        },
      },
    },
  });

  if (authError) {
    if (isAlreadyRegisteredError(authError)) {
      throw new Error(ALREADY_REGISTERED_MESSAGE);
    }
    throw new Error(authError.message);
  }

  const userId = authData.user?.id;
  if (!userId) {
    throw new Error(
      'Account was created but user ID is missing. Please contact support.'
    );
  }

  const identities = authData.user?.identities;
  if (Array.isArray(identities) && identities.length === 0) {
    throw new Error(ALREADY_REGISTERED_MESSAGE);
  }

  return { userId };
}
