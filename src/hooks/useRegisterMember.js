// src/hooks/useRegisterMember.js
//
// React-specific orchestration hook.
// ❌ Do NOT copy to React Native — rewrite with RN patterns.
// But the logic flow (validate → register → show "check email") is the same.

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { validateRegistrationForm } from '../domain/member/memberRegistration';
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

const normalizeGenderForDb = (gender) => {
  const normalized = String(gender || '').trim().toLowerCase();
  const map = {
    female: 'female',
    male: 'male',
    other: 'other',
    'non-binary': 'other',
    'prefer not to say': 'other',
    '\uC5EC\uC131': 'female',
    '\uB0A8\uC131': 'male',
    '\uB17C\uBC14\uC774\uB108\uB9AC': 'other',
    '\uC751\uB2F5 \uAC70\uC808': 'other',
  };
  return map[normalized] || 'other';
};

// ── Helper: compress image in browser ───────────────────────────────────────
async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          quality
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    img.src = url;
  });
}

export function useRegisterMember() {
  // 'about' | 'personal' | 'academic' | 'account' | 'email'
  const [step, setStep] = useState('about');
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [profileFile, setProfileFile] = useState(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');

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

    // Client-side password checks
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
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

      if (pendingConfirmationEmail && normalizedEmail !== pendingConfirmationEmail) {
        await changeUnconfirmedRegistrationEmail({
          currentEmail: pendingConfirmationEmail,
          newEmail: normalizedEmail,
          password: formData.password,
        });
        setPendingConfirmationEmail(normalizedEmail);
        setStep('email');
        return;
      }

      // 1) Upload profile image if present
      let profileImageUrl = null;

      if (profileFile) {
        try {
          const compressedBlob = await compressImage(profileFile, 800, 800, 0.75);

          const baseName =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const filePath = `avatars/${baseName}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from('profile-images')
            .upload(filePath, compressedBlob, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (!uploadError) {
            const { data: publicData } = supabase.storage
              .from('profile-images')
              .getPublicUrl(filePath);
            profileImageUrl = publicData?.publicUrl || null;
          } else {
            console.error('Profile image upload failed:', uploadError);
          }
        } catch (imgErr) {
          console.error('Profile image compression/upload error:', imgErr);
          // We do NOT block registration if image fails.
        }
      }

      // 2) Create auth user + member row
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
        profileImageUrl,
        legalDocumentsVersion: options.legalDocumentsVersion,
        legalAcceptedAt: new Date().toISOString(),
      });

      // Account created — now tell user to check their email.
      setPendingConfirmationEmail(normalizedEmail);
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
    loading,
    error,
    handleChange,
    handleEducationLevelChange,
    handleSubmit,
    goNext,
    goBack,
    editEmail,
    setProfileFile,
  };
}
