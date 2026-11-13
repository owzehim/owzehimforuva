// src/hooks/useRegisterMember.js
//
// React-specific orchestration hook.
// ❌ Do NOT copy to React Native — rewrite with RN patterns.
// But the logic flow (validate → register → show "check email") is the same.

import { useState } from 'react';
import { normalizeGenderForDb, validateRegistrationForm } from '../domain/member/memberRegistration';
import { changeUnconfirmedRegistrationEmail, registerMember } from '../api/memberRepository';

const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  firstNameKorean: '',
  lastNameKorean: '',
  email: '',
  password: '',
  confirmPassword: '',
  studentNumber: '',
  yearOfBirth: '',
  gender: '',
  countryOfOrigin: '',
  university: '',
  major: '',
  educationLevel: '',
  yearNumber: '',
};

export function useRegisterMember() {
  // 'about' | 'personal' | 'academic' | 'account' | 'email'
  const [step, setStep] = useState('about');
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');
  const [confirmationReturnToken, setConfirmationReturnToken] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Generic field change ────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // ── Reset year when education level changes ─────────────────────────────
  const handleEducationLevelChange = (e) => {
    const level = e.target.value;
    setFormData((prev) => ({
      ...prev,
      educationLevel: level,
      yearNumber: '',
    }));
  };

  // ── Step navigation ─────────────────────────────────────────────────────
  const goNext = () => {
    setStep((prev) => {
      if (prev === 'about') return 'academic';
      if (prev === 'academic') return 'account';
      return prev;
    });
  };

  const goBack = () => {
    setStep((prev) => {
      if (prev === 'account') return 'academic';
      if (prev === 'academic') return 'about';
      return prev;
    });
  };

  const editEmail = () => {
    setStep('account');
  };

  // ── Final submit (after step 3) ─────────────────────────────────────────
  const handleSubmit = async (e, options = {}) => {
    e.preventDefault();
    setError('');

    if (!options.legalAccepted) {
      setError('Please read and accept the Terms, Privacy Policy, and Community Guidelines');
      return;
    }
    if (options.ageConfirmed !== true) {
      setError(options.ageConfirmationError || 'Please confirm that you are at least 16 years old.');
      return;
    }

    // Client-side password checks
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    const genderForDb = normalizeGenderForDb(formData.gender);

    const validationError = validateRegistrationForm({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      studentNumber: formData.studentNumber,
      gender: genderForDb,
      countryOfOrigin: formData.countryOfOrigin,
      educationLevel: formData.educationLevel,
      yearNumber: formData.yearNumber || null,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = formData.email.trim().toLowerCase();
      const returnToken = crypto.randomUUID();

      if (pendingConfirmationEmail && normalizedEmail !== pendingConfirmationEmail) {
        await changeUnconfirmedRegistrationEmail({
          currentEmail: pendingConfirmationEmail,
          newEmail: normalizedEmail,
          password: formData.password,
          captchaToken: options.captchaToken,
          returnToken,
        });
        setPendingConfirmationEmail(normalizedEmail);
        setConfirmationReturnToken(returnToken);
        setStep('email');
        return;
      }

      // Create the Auth user. Profile images are uploaded later from Settings,
      // after the account exists and owner-scoped storage authorization applies.
      await registerMember({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        firstNameKorean: formData.firstNameKorean,
        lastNameKorean: formData.lastNameKorean,
        studentNumber: formData.studentNumber,
        yearOfBirth: formData.yearOfBirth
          ? Number(formData.yearOfBirth)
          : null,
        gender: genderForDb,
        countryOfOrigin: formData.countryOfOrigin,
        university: formData.university,
        major: formData.major,
        educationLevel: formData.educationLevel,
        yearNumber: formData.yearNumber
          ? Number(formData.yearNumber)
          : null,
        legalDocumentsVersion: options.legalDocumentsVersion,
        ageConfirmed: options.ageConfirmed,
        captchaToken: options.captchaToken,
        returnToken,
      });

      // Account created — now tell user to check their email.
      setPendingConfirmationEmail(normalizedEmail);
      setConfirmationReturnToken(returnToken);
      setStep('email');
    } catch (err) {
      setError(
        err.message || 'Registration failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return {
    step,
    formData,
    confirmationReturnToken,
    setConfirmationReturnToken,
    loading,
    error,
    handleChange,
    handleEducationLevelChange,
    handleSubmit,
    goNext,
    goBack,
    editEmail,
  };
}
