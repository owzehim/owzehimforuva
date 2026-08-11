// src/pages/RegistrationPage.jsx
//
// Presentation only ??all logic lives in useRegisterMember hook.
// ??Do NOT copy to React Native ??rewrite UI with RN components.

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CaretDown, CaretLeft, EnvelopeSimple, UserCircle } from '@phosphor-icons/react';
import Cropper from 'react-easy-crop';
import { useRegisterMember } from '../hooks/useRegisterMember';
import { getYearOptions } from '../domain/member/memberRegistration';
import { LEGAL_DOCUMENT_VERSION, legalDocuments } from '../content/legalDocuments';
import { isProductionEnv } from '../lib/appEnv';

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada',
  'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia',
  'Cuba', 'Cyprus', 'Czech Republic', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
  'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel',
  'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
  'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan',
  'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
  'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
  'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

const GENDERS = ['female', 'male', 'non-binary', 'prefer not to say'];
const GENDERS_KO = ['여성', '남성', '논바이너리', '응답 거절'];
const CUSTOM_TYPE_OPTION = 'Other (please specify)';
const UNIVERSITY_OPTIONS = ['University of Amsterdam (UvA)'];
const MAJOR_OPTIONS = [
  'Aardrijkskunde',
  'Accountancy',
  'Accountancy and Control',
  'Actuarial Science',
  'Actuarial Science and Mathematical Finance',
  'Advanced Matter and Energy Physics',
  'Algemene economie',
  'Analytical Sciences',
  'Ancient Studies',
  'Arabisch',
  'Arabische taal en cultuur',
  'Archaeology',
  'Archaeology and Heritage',
  'Archival and Information Studies',
  'Artificial Intelligence',
  'Arts and Culture',
  'Arts and Culture (Research)',
  'Art and Performance Research Studies',
  'Asset Management',
  'Astronomy and Astrophysics',
  'Banking and Regulation',
  'Behavioral Data Science',
  'Behavioral Economics and Game Theory',
  'Bedrijfseconomie',
  'Biologie',
  'Biological Sciences',
  'Biology',
  'Bioinformatics and Systems Biology',
  'Biomedical Sciences',
  'Biophysics and Biophotonics',
  'Boekwetenschap',
  'Brain & Cognition in Society',
  'Brain and Cognitive Sciences',
  'Brain and Cognitive Sciences (Research)',
  'Business',
  'Business Administration',
  'Business Analytics',
  'Business Economics',
  'Business Information Technology Management',
  'Bèta-gamma',
  'Chemistry',
  'Chemistry of Life',
  'Child Development and Education (Research)',
  'Classics and Ancient Civilizations',
  'Coaching & Vitality in Organisations',
  'Cognition Language and Communication',
  'Communication and Information',
  'Communication Science',
  'Communication Science (Research)',
  'Comparative Cultural Analysis',
  'Comparative Literature',
  'Complex Systems and Policy',
  'Computational Science',
  'Computational Social Science',
  'Computer Science',
  'Conflict Resolution and Governance',
  'Conservation and Restoration of Cultural Heritage',
  'Consultancy & Organisational Development',
  'Consumer Marketing',
  'Corporate Finance',
  'Cultural Analysis',
  'Cultural Anthropology and Development Sociology',
  'Cultural and Social Anthropology',
  'Cultural Data & AI',
  'Cultural Psychology',
  'Curating Art and Cultures',
  'Data Science',
  'Data Science and Business Analytics',
  'Development Economics',
  'Digital Marketing',
  'Documentary and Fiction',
  'Duits',
  'Duitslandstudies',
  'Earth Sciences',
  'Econometrics',
  'Econometrics and Data Science',
  'Economics',
  'Economics and Business Economics',
  'Engels',
  'English Language and Culture',
  'English Literature and Culture',
  'Entrepreneurship',
  'Environmental Economics',
  'European Competition Law and Regulation',
  'European Politics and External Relations',
  'European Studies',
  'European Union Law',
  'Film Studies',
  'Finance',
  'Financial Econometrics',
  'Financial Management',
  'Fiscaal Recht',
  'Fiscale Economie',
  'Filosofie',
  'Forensic Science',
  'Frans',
  'Franse taal en cultuur',
  'Future Planet Studies',
  'Gender and Sexuality',
  'Geneeskunde',
  'Geneeskunde (Medicine)',
  'General Linguistics',
  'Geschiedenis',
  'Gezondheidsrecht',
  'Gezondheidszorgpsychologie',
  'Global Arts Culture and Politics',
  'Global Arts, Culture and Politics',
  'Global Communication Science',
  'Global Cross-Media Cultures',
  'Godsdienst en levensbeschouwing',
  'Griekse en Latijnse taal en cultuur',
  'Health Promotion & Behaviour Change',
  'Hebreeuwse taal en cultuur',
  'Hebreeuws',
  'Heritage and Memory Studies',
  'Heritage Studies',
  'History (Research)',
  'Holocaust and Genocide Studies',
  'Human Geography',
  'Human Geography and Planning',
  'Human Resource & Career Management',
  'Human-Computer Interaction',
  'Informatica',
  'Information Studies',
  'Informatierecht',
  'Interdisciplinaire sociale wetenschap',
  'International and European Law',
  'International and Transnational Criminal Law',
  'International Business',
  'International Criminal Law (LLM)',
  'International Development Studies',
  'International Development Studies (Research)',
  'International Dramaturgy',
  'International Finance and Trade',
  'International Relations',
  'International Tax Law (Advanced LLM)',
  'International Trade and Investment Law',
  'Italiaans',
  'Italië studies',
  'Jewish Studies',
  'Journalism and Media',
  'Journalism Media and Globalisation',
  'Kunstgeschiedenis',
  'Language and Society',
  'Language Literature and Education',
  'Latin American Studies',
  'Latijnse taal en cultuur',
  'Law & Finance (LLM)',
  'Leadership and Management',
  'Liberal Arts and Sciences (AUC)',
  'Linguistics',
  'Linguistics and Communication',
  'Literary and Cultural Analysis',
  'Literary Studies',
  'Literary Studies (Research)',
  'Literature Culture and Society',
  'Logic',
  'Maatschappijleer',
  'Management of International Business and Trade',
  'Managerial Economics and Strategy',
  'Master’s Qualifying Programme (MQP) – OnCampus Amsterdam',
  'Mathematics',
  'Media and Culture',
  'Media and Information',
  'Media Studies',
  'Media Studies (Research)',
  'Medical Anthropology and Sociology',
  'Medical Informatics',
  'Medische informatiekunde',
  'Middle Eastern Studies',
  'Molecular Sciences',
  'Monetary Policy and Banking',
  'Museum Studies',
  'Music Studies',
  'Muziekwetenschap',
  'Natuurkunde',
  'Nederlandse taal en cultuur',
  'Nederlands',
  'Nederlands als tweede taal en meertaligheid',
  'Neuroeconomics',
  'New Media and Digital Culture',
  'Nieuwgriekse taal en cultuur',
  'Onderwijswetenschappen',
  'Orthopedagogiek',
  'Pedagogical Sciences',
  'Pedagogische wetenschappen',
  'Persuasive Communication',
  'Philosophy',
  'Philosophy (Research)',
  'Physics and Astronomy',
  'Plus education/communication combinations',
  'Political Communication',
  'Political Economy',
  'Political Geography',
  'Political Science',
  'Political Theory',
  'Politics Psychology Law and Economics (PPLE)',
  'Pre-Master\'s Programmes (UvA Bridging)',
  'Preservation and Presentation of the Moving Image',
  'Privaatrecht',
  'Psychology',
  'Psychology (Research)',
  'Public Policy',
  'Public Policy and Governance',
  'Publiekrecht',
  'Quantum Computer Science',
  'Quantitative Finance',
  'Real Estate Finance',
  'Rechtsgeleerdheid',
  'Redacteur/Editor',
  'Religiewetenschappen',
  'Religious Studies',
  'Russisch',
  'Scandinavië studies',
  'Scheikunde',
  'Science Technology & Innovation',
  'Science for Energy and Sustainability',
  'Security and Network Engineering',
  'Sign Language Linguistics',
  'Slavische talen en culturen',
  'Social Influence',
  'Social Sciences (Research)',
  'Sociology',
  'Software Engineering',
  'Spaans',
  'Spaanse en Latijns-Amerikaanse studies',
  'Spatial Analysis',
  'Spatial Sustainability Studies',
  'Sport and Performance Psychology',
  'Stochastics and Financial Mathematics',
  'Strafrecht',
  'Strategy',
  'Strategy and AI Transformation',
  'Sustainability',
  'Tandheelkunde',
  'Tandheelkunde (Dentistry)',
  'Technology Governance (Advanced LLM)',
  'Theaterwetenschap',
  'Theatre Studies',
  'Theology and Religious Studies',
  'Training & Development',
  'Translation Studies',
  'Transnational and European Private Law',
  'Universitaire Pabo van Amsterdam',
  'Urban and Regional Planning',
  'Urban Geography',
  'Urban Studies (Research)',
  'Visual Anthropology',
  'Wiskunde',
  'Youth at Risk',
];

const SORTED_COUNTRIES = [...COUNTRIES].sort((a, b) => a.localeCompare(b));
const SORTED_GENDERS = [...GENDERS].sort((a, b) => a.localeCompare(b));
const SORTED_GENDERS_KO = [...GENDERS_KO].sort((a, b) => a.localeCompare(b, 'ko'));
const SORTED_UNIVERSITIES = [...UNIVERSITY_OPTIONS].sort((a, b) => a.localeCompare(b)).concat(CUSTOM_TYPE_OPTION);
const SORTED_MAJORS = [...new Set(MAJOR_OPTIONS)].sort((a, b) => a.localeCompare(b)).concat(CUSTOM_TYPE_OPTION);

const filled = (value) => String(value || '').trim().length > 0;

function getRegistrationStepComplete(step, formData, yearOptions = []) {
  if (!isProductionEnv) return true;

  if (step === 'about') {
    return (
      filled(formData.firstName) &&
      filled(formData.lastName) &&
      filled(formData.yearOfBirth) &&
      filled(formData.gender) &&
      filled(formData.countryOfOrigin)
    );
  }

  if (step === 'academic') {
    return (
      filled(formData.university) &&
      filled(formData.major) &&
      filled(formData.studentNumber) &&
      filled(formData.educationLevel) &&
      (yearOptions.length === 0 || filled(formData.yearNumber))
    );
  }

  return true;
}

function getNextButtonStyle(isComplete) {
  return {
    ...s.submitBtn,
    opacity: isComplete ? 1 : 0.6,
    cursor: isComplete ? 'pointer' : 'not-allowed',
  };
}

const PASTEL_COLORS = [
  '#FFB3B3',
  '#FFD9A0',
  '#FFF3A0',
  '#B3F0C2',
  '#A8D8FF',
  '#C5B3FF',
  '#FFB3E6',
  '#B3F0EE',
];

const AUTH_BOX_WIDTH = '368px';

function getPastelColor(seed) {
  const str = seed || 'default';
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length];
}

async function getCroppedImgAsFile(imageSrc, pixelCrop, fileName = 'profile.jpg') {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = imageSrc;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const canvas = document.createElement('canvas');
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  canvas
    .getContext('2d')
    .drawImage(
      img,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Canvas is empty'));
        return;
      }
      resolve(result);
    }, 'image/jpeg', 0.95);
  });

  return new File([blob], fileName, { type: 'image/jpeg' });
}

// ?? Translations ????????????????????????????????????????????????????????????????
const translations = {
  en: {
    title: 'Sign up',
    subtitle: 'Your membership will be inactive after registration. The board will activate it once verified.',
    aboutYou: 'About you',
    academicInfo: 'Academic Information',
    finalStep: 'And That',
    firstName: 'First name (English) *',
    lastName: 'Last name (English) *',
    firstNameKorean: 'First name (Korean) *',
    lastNameKorean: 'Last name (Korean) *',
    yearOfBirth: 'Year of birth (optional)',
    gender: 'Gender *',
    nationality: 'Nationality *',
    university: 'University *',
    major: 'Major *',
    studentNumber: 'Student number *',
    programme: 'Programme *',
    academicYear: 'Academic year *',
    email: 'Email *',
    password: 'Password *',
    confirmPassword: 'Confirm password *',
    profilePicture: 'Profile picture (optional)',
    next: 'Next',
    back: 'Back',
    createAccount: 'Create account',
    creatingAccount: 'Creating account...',
    requiredFields: '* Required fields',
    passwordMismatch: 'Passwords do not match',
    checkEmail: 'Check your email',
    emailSent: 'We sent a confirmation link to',
    verifyEmail: 'Please open that email, verify your address, then come back and log in.',
    goToLogin: 'Go to login',
    alreadyHaveAccount: 'Already have an account?',
    logIn: 'Log in',
    minCharacters: 'Min. 6 characters',
    selectGender: 'Select gender',
    selectNationality: 'Select nationality',
    selectUniversity: 'Select university',
    selectMajor: 'Select major',
    selectYear: 'Select year',
    year: 'Year',
    foundation: 'Foundation',
    bachelor: 'Bachelor',
    master: 'Masters',
    alumni: 'Alumni',
  },
  ko: {
    title: '회원가입',
    subtitle: '등록 후 회원 자격은 비활성 상태입니다. 임원 확인 후 활성화됩니다.',
    aboutYou: '당신에 대해',
    academicInfo: '학력 정보',
    finalStep: '마지막 단계',
    firstName: '이름 (영문) *',
    lastName: '성 (영문) *',
    firstNameKorean: '이름 (한글) *',
    lastNameKorean: '성 (한글) *',
    yearOfBirth: '출생 연도 (선택사항)',
    gender: '성별 *',
    nationality: '국적 *',
    university: '대학교 *',
    major: '전공 *',
    studentNumber: 'Student number *',
    programme: '프로그램 *',
    academicYear: '학년 *',
    email: '이메일 *',
    password: '비밀번호 *',
    confirmPassword: '비밀번호 확인 *',
    profilePicture: '프로필 사진 (선택사항)',
    next: '다음',
    back: '뒤로',
    createAccount: '계정 만들기',
    creatingAccount: '계정 생성 중...',
    requiredFields: '* 필수 항목',
    passwordMismatch: '비밀번호가 일치하지 않습니다',
    checkEmail: '이메일 확인',
    emailSent: '확인 링크를 다음 주소로 보냈습니다',
    verifyEmail: '해당 이메일을 열고 주소를 확인한 뒤 다시 로그인하세요.',
    goToLogin: '로그인으로 이동',
    alreadyHaveAccount: '이미 계정이 있으신가요?',
    logIn: '로그인',
    minCharacters: '최소 6자',
    selectGender: '성별 선택',
    selectNationality: '국적 선택',
    selectUniversity: '대학교 선택',
    selectMajor: '전공 선택',
    selectYear: '학년 선택',
    year: '학년',
    foundation: 'Foundation',
    bachelor: 'Bachelor',
    master: 'Masters',
    alumni: 'Alumni',
  },
};
// ?? Typeahead select component ????????????????????????????????????????????????
function TypeaheadSelect({ name, value, onChange, options, placeholder = '', allowCustom = false }) {
  const [inputValue, setInputValue] = useState(value || '');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter((opt) =>
    opt.toLowerCase().includes(inputValue.toLowerCase())
  );

  const handleSelect = (val) => {
    if (allowCustom && val === CUSTOM_TYPE_OPTION) {
      setInputValue('');
      setOpen(false);
      onChange({ target: { name, value: '' } });
      return;
    }
    setInputValue(val);
    setOpen(false);
    onChange({ target: { name, value: val } });
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setOpen(true);
    if (allowCustom || val === '') {
      onChange({ target: { name, value: val } });
    }
  };

  return (
    <div ref={containerRef} style={s.typeaheadContainer}>
      <input
        name={name}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{ ...s.input, ...s.typeaheadInputSpacer }}
        autoComplete="off"
      />
      <span style={s.dropdownIcon}>
        <CaretDown size={16} weight="bold" />
      </span>
      {open && filtered.length > 0 && (
        <div style={s.typeaheadList}>
          {filtered.map((opt) => (
            <div
              key={opt}
              style={s.typeaheadItem}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(opt);
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ?? Main component ????????????????????????????????????????????????????????????
export default function RegistrationPage() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('ko');
  const fileInputRef = useRef(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState('');
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const [cropFileName, setCropFileName] = useState('profile.jpg');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [legalAgreements, setLegalAgreements] = useState({
    terms: false,
    privacy: false,
    community: false,
  });
  const [activeLegalDoc, setActiveLegalDoc] = useState(null);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  const {
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
  } = useRegisterMember();

  const yearOptions = getYearOptions(formData.educationLevel);
  const t = translations[language];
  const displayName =
    `${formData.lastNameKorean || ''}${formData.firstNameKorean || ''}`.trim() ||
    `${formData.firstName || ''} ${formData.lastName || ''}`.trim();
  const greetingName = language === 'ko'
    ? (formData.firstNameKorean || formData.firstName || '회원')
    : (formData.firstName || 'member');
  const pastelBg = getPastelColor('registration-default-profile');

  useEffect(() => {
    return () => {
      if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    };
  }, [profilePreviewUrl]);

  const handleProfileFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result);
      setCropFileName(file.name || 'profile.jpg');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropConfirm = async () => {
    if (!cropImageSrc || !croppedAreaPixels) return;
    const croppedFile = await getCroppedImgAsFile(cropImageSrc, croppedAreaPixels, cropFileName);
    setProfileFile(croppedFile);
    setProfilePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(croppedFile);
    });
    setCropImageSrc(null);
    setCroppedAreaPixels(null);
  };

  const closeCropper = () => {
    setCropImageSrc(null);
    setCroppedAreaPixels(null);
  };

  const handleAgreementChange = (name, checked) => {
    setLegalAgreements((current) => ({ ...current, [name]: checked }));
  };

  const handleAccountSubmit = (event) => {
    handleSubmit(event, {
      legalAccepted: Object.values(legalAgreements).every(Boolean),
      legalDocumentsVersion: LEGAL_DOCUMENT_VERSION,
    });
  };

  const profileHeroProps = {
    fileInputRef,
    profilePreviewUrl,
    pastelBg,
    onProfileClick: () => fileInputRef.current?.click(),
    t,
  };
  const handleTopBack = () => {
    if (step === 'about') {
      navigate('/public');
      return;
    }
    goBack();
  };
  const aboutComplete = getRegistrationStepComplete('about', formData, yearOptions);
  const academicComplete = getRegistrationStepComplete('academic', formData, yearOptions);

  // Final step: after successful registration, tell user to check email
  if (step === 'email') {
    return (
      <div
        className="registration-page-enter"
        onDragStart={(event) => event.preventDefault()}
        style={{ ...s.page, fontFamily: 'var(--font-app)', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}
      >
        <style>{registrationMotionCss}</style>
        <div style={s.topBar}>
          <button
            type="button"
            onClick={() => navigate('/public')}
            style={s.backButton}
            title="Go back"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <button
            onClick={() => setLanguage(language === 'en' ? 'ko' : 'en')}
            style={s.languageToggle}
          >
            {language === 'en' ? '한국어' : 'English'}
          </button>
        </div>
        <div style={s.emailCard}>
          <div style={{ textAlign: 'center', marginBottom: '22px' }}>
            <div style={s.emailIcon}>
              <EnvelopeSimple size={28} weight="fill" color="#f97316" />
            </div>
            <h1 style={s.title}>{t.checkEmail}</h1>
            <p style={s.emailText}>
              {t.emailSent} <br />
              <strong style={{ color: 'var(--reg-text)' }}>{formData.email}</strong>
              <br />
              {t.verifyEmail}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/login')} style={s.submitBtn}>
            {t.goToLogin}
          </button>
          <button
            type="button"
            onClick={editEmail}
            style={{ ...s.ghostBtn, width: '100%', marginTop: '10px' }}
          >
            {language === 'ko' ? '\uC774\uBA54\uC77C \uC8FC\uC18C \uBCC0\uACBD' : 'Change email address'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="registration-page-enter"
      onDragStart={(event) => event.preventDefault()}
      style={{ ...s.page, fontFamily: 'var(--font-app)', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}
    >
      <style>{registrationMotionCss}</style>
      {/* Top Bar with Back Button and Language Toggle */}
      <div style={s.topBar}>
        <button
          type="button"
          onClick={handleTopBack}
          style={s.backButton}
          title="Go back"
        >
          <CaretLeft size={24} weight="bold" />
        </button>
        <button
          onClick={() => setLanguage(language === 'en' ? 'ko' : 'en')}
          style={s.languageToggle}
        >
            {language === 'en' ? '한국어' : 'English'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleProfileFileChange}
        style={{ display: 'none' }}
      />

      {error && <div style={s.errorBanner}>{error}</div>}

      {step === 'about' && (
        <div key="about" className="registration-step" style={s.stepShell}>
          <NameStep
            formData={formData}
            handleChange={handleChange}
            goNext={goNext}
            language={language}
            t={t}
            isComplete={aboutComplete}
          />
        </div>
      )}

      {step === 'academic' && (
        <div key="academic" className="registration-step registration-step-academic" style={s.stepShell}>
          <AcademicStep
            formData={formData}
            handleChange={handleChange}
            handleEducationLevelChange={handleEducationLevelChange}
            yearOptions={yearOptions}
            goNext={goNext}
            t={t}
            displayName={displayName}
            greetingName={greetingName}
            language={language}
            profileHeroProps={profileHeroProps}
            isComplete={academicComplete}
          />
        </div>
      )}

      {step === 'account' && (
        <div key="account" className="registration-step registration-step-account" style={s.stepShell}>
          <AccountStep
            formData={formData}
            handleChange={handleChange}
            handleSubmit={handleAccountSubmit}
            loading={loading}
            navigate={navigate}
            t={t}
            language={language}
            legalAgreements={legalAgreements}
            onAgreementChange={handleAgreementChange}
            onOpenLegalDocument={setActiveLegalDoc}
            profileHeroProps={profileHeroProps}
          />
        </div>
      )}

      {cropImageSrc && (
        <ProfileCropModal
          imageSrc={cropImageSrc}
          crop={crop}
          zoom={zoom}
          setCrop={setCrop}
          setZoom={setZoom}
          setCroppedAreaPixels={setCroppedAreaPixels}
          onCancel={closeCropper}
          onConfirm={handleCropConfirm}
        />
      )}

      {activeLegalDoc && (
        <LegalDocumentModal
          document={legalDocuments[activeLegalDoc]}
          onClose={() => setActiveLegalDoc(null)}
        />
      )}
    </div>
  );
}

// ?? Step 1: About you ??????????????????????????????????????????????????????????
function ProfileHero({
  profileHeroProps,
  variant = 'large',
  firstLine,
  secondLine,
  allowUpload = true,
  equalIntroTextSize = false,
}) {
  const { profilePreviewUrl, pastelBg, onProfileClick, t } = profileHeroProps;
  const compact = variant === 'compact';
  const academic = variant === 'academic';
  const showIntro = Boolean(firstLine || secondLine);
  return (
    <div style={academic ? s.academicHero : compact ? s.compactHero : s.aboutTopGrid}>
      <div style={s.profilePicker}>
        <button
          type="button"
          onClick={allowUpload ? onProfileClick : undefined}
          style={academic ? s.avatarButtonAcademic : compact ? s.avatarButtonCompact : s.avatarButton}
          aria-label={t.profilePicture}
        >
          <div
            style={{
              ...(academic ? s.avatarCircleAcademic : compact ? s.avatarCircleCompact : s.avatarCircle),
              background: profilePreviewUrl ? 'transparent' : pastelBg,
            }}
          >
            {profilePreviewUrl ? (
              <img src={profilePreviewUrl} alt="Profile" draggable={false} style={s.avatarImage} />
            ) : (
              <UserCircle size="72%" weight="fill" color="rgba(44,42,39,0.55)" />
            )}
          </div>
          {allowUpload && (
            <span style={academic ? s.cameraBadgeAcademic : compact ? s.cameraBadgeCompact : s.cameraBadge}>
              <Camera size={academic || compact ? 12 : 19} weight="fill" color="var(--reg-text)" />
            </span>
          )}
        </button>
      </div>

      {showIntro && (
        <div style={academic || compact ? s.compactIntro : s.aboutIntro}>
          {firstLine && (
            <p style={academic || compact ? s.compactIntroLine : equalIntroTextSize ? s.aboutIntroKo : s.aboutIntroEn}>{firstLine}</p>
          )}
          {secondLine && (
            <p style={academic || compact ? s.compactIntroName : s.aboutIntroKo}>{secondLine}</p>
          )}
        </div>
      )}
    </div>
  );
}

function NameStep({ formData, handleChange, goNext, language, t, isComplete }) {
  return (
    <div style={s.form}>
      <div style={{ ...s.formContent, ...s.promptFormContent }}>
        <h1 style={s.registrationPrompt}>
          {language === 'ko'
            ? '회원가입에 필요한 정보들을 입력해주세요'
            : 'Please fill in your information to sign up'}
        </h1>

        <div style={{ ...s.nameGrid, ...s.stageOneFieldStart }}>
          <Field label={t.firstName}>
            <input
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              style={s.input}
            />
          </Field>
          <Field label={t.lastName}>
            <input
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              style={s.input}
            />
          </Field>
          {language === 'ko' && (
            <>
              <div style={s.nameGroupGap} />
              <Field label={t.firstNameKorean}>
                <input
                  name="firstNameKorean"
                  value={formData.firstNameKorean || ''}
                  onChange={handleChange}
                  style={s.input}
                />
              </Field>
              <Field label={t.lastNameKorean}>
                <input
                  name="lastNameKorean"
                  value={formData.lastNameKorean || ''}
                  onChange={handleChange}
                  style={s.input}
                />
              </Field>
            </>
          )}

          <div style={s.nameGroupGap} />
          <Row columns="1fr 1fr">
            <Field label={t.yearOfBirth}>
              <input
                type="number"
                name="yearOfBirth"
                value={formData.yearOfBirth}
                onChange={handleChange}
                style={s.input}
                placeholder=""
                min="1950"
                max="2015"
              />
            </Field>
            <Field label={t.gender}>
              <TypeaheadSelect
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                options={language === 'en' ? SORTED_GENDERS : SORTED_GENDERS_KO}
                placeholder=""
              />
            </Field>
          </Row>

          <Field label={t.nationality}>
            <TypeaheadSelect
              name="countryOfOrigin"
              value={formData.countryOfOrigin}
              onChange={handleChange}
              options={SORTED_COUNTRIES}
              placeholder=""
            />
          </Field>
        </div>
      </div>

      <div style={s.bottomAction}>
        <button type="button" onClick={goNext} disabled={!isComplete} style={getNextButtonStyle(isComplete)}>
          {t.next}
        </button>
      </div>
    </div>
  );
}

function PersonalStep({ formData, handleChange, goNext, language, t, greetingName, profileHeroProps, isComplete }) {
  const greetingFirstLine = language === 'ko' ? '안녕하세요,' : 'Greetings,';
  const greetingSecondLine = language === 'ko' ? `${greetingName}님` : greetingName;
  return (
    <div style={s.form}>
      <div style={s.formContent}>
        <ProfileHero
          profileHeroProps={profileHeroProps}
          firstLine={greetingFirstLine}
          secondLine={greetingSecondLine}
        />

        <div style={s.fieldStack}>
          <Row>
            <Field label={t.yearOfBirth}>
              <input
                type="number"
                name="yearOfBirth"
                value={formData.yearOfBirth}
                onChange={handleChange}
                style={s.input}
                placeholder=""
                min="1950"
                max="2015"
              />
            </Field>
            <Field label={t.gender}>
              <TypeaheadSelect
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                options={language === 'en' ? SORTED_GENDERS : SORTED_GENDERS_KO}
                placeholder=""
              />
            </Field>
          </Row>

          <Field label={t.nationality}>
            <TypeaheadSelect
              name="countryOfOrigin"
              value={formData.countryOfOrigin}
              onChange={handleChange}
              options={SORTED_COUNTRIES}
              placeholder=""
            />
          </Field>
        </div>
      </div>

      <div style={s.bottomAction}>
        <button type="button" onClick={goNext} disabled={!isComplete} style={getNextButtonStyle(isComplete)}>
          {t.next}
        </button>
      </div>
    </div>
  );
}
function ProfileCropModal({
  imageSrc,
  crop,
  zoom,
  setCrop,
  setZoom,
  setCroppedAreaPixels,
  onCancel,
  onConfirm,
}) {
  return (
    <div style={s.cropOverlay}>
      <div style={s.cropModal}>
        <h2 style={s.cropTitle}>프로필 사진 자르기</h2>
        <div style={s.cropFrame}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
          />
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={s.zoomSlider}
        />
        <div style={s.cropActions}>
          <button type="button" onClick={onCancel} style={s.cropCancelBtn}>
            취소
          </button>
          <button type="button" onClick={onConfirm} style={s.cropConfirmBtn}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ?? Step 2: Academic info ??????????????????????????????????????????????????????
function AcademicStep({
  formData,
  handleChange,
  handleEducationLevelChange,
  yearOptions,
  goNext,
  t,
  language,
  isComplete,
}) {
  const programmeOptions = ['foundation', 'bachelor', 'master', 'alumni'];
  return (
    <div style={s.form}>
      <div style={{ ...s.formContent, ...s.academicContent, ...s.promptFormContent }}>
        <h1 style={s.registrationPrompt}>
          {language === 'ko'
            ? '대학 및 전공 정보를 입력해 주세요'
            : 'Please enter your academic information'}
        </h1>

        <div style={{ ...s.fieldStack, ...s.stageTwoFieldStart }}>
          <Field label={t.university}>
            <TypeaheadSelect
              name="university"
              value={formData.university}
              onChange={handleChange}
              options={SORTED_UNIVERSITIES}
              placeholder=""
              allowCustom
            />
          </Field>

          <Field label={t.studentNumber}>
            <input
              name="studentNumber"
              value={formData.studentNumber}
              onChange={handleChange}
              style={s.input}
            />
          </Field>

          <div style={s.nameGroupGap} />
          <Field label={t.major}>
            <TypeaheadSelect
              name="major"
              value={formData.major}
              onChange={handleChange}
              options={SORTED_MAJORS}
              placeholder=""
              allowCustom
            />
          </Field>

          <Field label={t.programme} variant="group" style={s.programmeField}>
            <div style={s.programmeGrid}>
              {programmeOptions.map((level) => (
                <label
                  key={level}
                  style={{
                    ...s.programmeOption,
                    ...(formData.educationLevel === level ? s.programmeOptionActive : {}),
                  }}
                >
                  <input
                    type="radio"
                    name="educationLevel"
                    value={level}
                    checked={formData.educationLevel === level}
                    onChange={handleEducationLevelChange}
                    style={s.programmeRadio}
                  />
                  {t[level]}
                </label>
              ))}
            </div>
          </Field>

          {yearOptions.length > 0 && (
            <Field label={t.academicYear} variant="group" style={s.yearField}>
              <div style={s.yearGrid}>
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => handleChange({ target: { name: 'yearNumber', value: String(y) } })}
                    style={{
                      ...s.yearOption,
                      ...(String(formData.yearNumber) === String(y) ? s.yearOptionActive : {}),
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
      </div>

      <div style={s.bottomAction}>
        <button
          type="button"
          onClick={goNext}
          disabled={!isComplete}
          style={{
            ...getNextButtonStyle(isComplete),
            flex: 1,
          }}
        >
          {t.next}
        </button>
      </div>
    </div>
  );
}

// ?? Step 3: Account & login info ???????????????????????????????????????????????
function AccountStep({
  formData,
  handleChange,
  handleSubmit,
  loading,
  t,
  language,
  legalAgreements,
  onAgreementChange,
  onOpenLegalDocument,
  profileHeroProps,
}) {
  const allLegalAccepted = Object.values(legalAgreements).every(Boolean);
  const isComplete =
    formData.email &&
    formData.password &&
    formData.confirmPassword &&
    formData.password === formData.confirmPassword &&
    formData.password.length >= 6 &&
    allLegalAccepted;

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <div style={{ ...s.formContent, ...s.promptFormContent }}>
        <h1 style={s.registrationPrompt}>
          {language === 'ko'
            ? '이메일과 비밀번호를 입력해 주세요'
            : 'Please enter your email and password'}
        </h1>

        <div style={s.accountProfileSlot}>
          <ProfileHero
            profileHeroProps={profileHeroProps}
            firstLine=""
            secondLine=""
            allowUpload
          />
        </div>

        <div style={{ ...s.fieldStack, ...s.accountFieldStart }}>
          <Field label={t.email}>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              style={s.input}
              placeholder=""
            />
          </Field>

          <Row>
            <Field label={t.password}>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                style={s.input}
                placeholder=""
              />
            </Field>
            <Field label={t.confirmPassword}>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                style={s.input}
              />
            </Field>
          </Row>

          <div style={s.nameGroupGap} />
          <LegalAgreementList
            agreements={legalAgreements}
            onAgreementChange={onAgreementChange}
            onOpenDocument={onOpenLegalDocument}
            language={language}
          />
        </div>

        {formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword && (
          <p style={{ ...s.helperText, color: 'var(--reg-danger-text)' }}>
            {t.passwordMismatch}
          </p>
        )}
      </div>

      <div style={s.bottomAction}>
        <button
          type="submit"
          disabled={loading || !isComplete}
          style={{
            ...s.submitBtn,
            flex: 1,
            background: !loading && isComplete
              ? 'linear-gradient(135deg, #fb923c 0%, #f97316 48%, #ea580c 100%)'
              : '#fb923c',
            opacity: loading || !isComplete ? 0.6 : 1,
            cursor: loading || !isComplete ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? t.creatingAccount : t.createAccount}
        </button>
      </div>
    </form>
  );
}

function LegalAgreementList({
  agreements,
  onAgreementChange,
  onOpenDocument,
  language,
}) {
  const labels = {
    terms: language === 'ko' ? 'Terms & Conditions에 동의합니다' : 'I agree to the Terms & Conditions',
    privacy: language === 'ko' ? 'Privacy Policy에 동의합니다' : 'I agree to the Privacy Policy',
    community: language === 'ko' ? 'Community Guidelines에 동의합니다' : 'I agree to the Community Guidelines',
  };

  const readLabels = {
    terms: language === 'ko' ? '전체 보기' : 'Read full text',
    privacy: language === 'ko' ? '전체 보기' : 'Read full text',
    community: language === 'ko' ? '전체 보기' : 'Read full text',
  };

  return (
    <div style={s.legalBox}>
      {Object.keys(legalDocuments).map((key) => (
        <label key={key} style={s.legalRow}>
          <input
            type="checkbox"
            checked={agreements[key]}
            onChange={(event) => onAgreementChange(key, event.target.checked)}
            style={s.legalCheckbox}
          />
          <span style={s.legalText}>{labels[key]}</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onOpenDocument(key);
            }}
            style={s.legalReadButton}
          >
            {readLabels[key]}
          </button>
        </label>
      ))}
    </div>
  );
}

function LegalDocumentModal({ document, onClose }) {
  if (!document) return null;

  return (
    <div style={s.legalOverlay}>
      <div style={s.legalModal}>
        <div style={s.legalModalHeader}>
          <div>
            <h2 style={s.legalModalTitle}>{document.title}</h2>
            <p style={s.legalModalDate}>Effective Date: {document.effectiveDate}</p>
          </div>
          <button type="button" onClick={onClose} style={s.legalCloseButton}>
            Close
          </button>
        </div>
        <div style={s.legalModalBody}>
          {document.body.split('\n').map((line, index) => (
            <p
              key={`${document.title}-${index}`}
              style={line.trim() ? s.legalParagraph : s.legalSpacer}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ?? Small layout helpers ???????????????????????????????????????????????????????
function Row({ children, columns }) {
  return <div style={{ ...rowStyle, ...(columns ? { gridTemplateColumns: columns } : {}) }}>{children}</div>;
}

function Field({ label, children, variant = 'input', style }) {
  const fieldRef = useRef(null);
  const handleFieldClick = (event) => {
    if (variant !== 'input') return;
    if (event.target.closest('input, textarea, select, button')) return;
    const input = fieldRef.current?.querySelector('input, textarea, select');
    input?.focus();
  };

  return (
    <div
      ref={fieldRef}
      onClick={handleFieldClick}
      style={{
        ...(variant === 'group' ? groupFieldStyle : fieldStyle),
        ...(variant === 'input' ? s.touchableField : {}),
        ...style,
      }}
    >
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ?? Styles ?????????????????????????????????????????????????????????????????????
const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: '8px',
};

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  height: '54px',
  minHeight: '54px',
  padding: '8px 12px 7px',
  border: '1px solid var(--reg-border)',
  borderRadius: '8px',
  backgroundColor: 'var(--reg-field-bg)',
  boxSizing: 'border-box',
  justifyContent: 'center',
};

const groupFieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  minHeight: '54px',
  padding: '8px 12px',
  border: '1px solid var(--reg-border)',
  borderRadius: '8px',
  backgroundColor: 'var(--reg-field-bg)',
  boxSizing: 'border-box',
  justifyContent: 'center',
};

const labelStyle = {
  fontSize: '12px',
  fontWeight: 400,
  color: 'var(--reg-muted)',
  lineHeight: 1,
};

const registrationMotionCss = `
:root {
  --reg-page-bg: #ffffff;
  --reg-card-bg: #ffffff;
  --reg-field-bg: #ffffff;
  --reg-text: #111827;
  --reg-subtext: #374151;
  --reg-muted: #6b7280;
  --reg-soft-muted: #9ca3af;
  --reg-border: #d8dde5;
  --reg-soft-border: #e5e7eb;
  --reg-chip-border: #cfd4dc;
  --reg-avatar-border: rgba(44,42,39,0.08);
  --reg-camera-bg: #ffffff;
  --reg-error-bg: #fef2f2;
  --reg-error-text: #b91c1c;
  --reg-error-border: #fecaca;
  --reg-danger-text: #dc2626;
  --reg-ghost-bg: #f3f4f6;
  --reg-dropdown-shadow: 0 4px 10px rgba(0,0,0,0.08);
}

html.dark {
  --reg-page-bg: #121212;
  --reg-card-bg: #121212;
  --reg-field-bg: #121212;
  --reg-text: #f5f5f7;
  --reg-subtext: #c7c7cc;
  --reg-muted: #a1a1aa;
  --reg-soft-muted: #8e8e93;
  --reg-border: #2c2c2e;
  --reg-soft-border: #2c2c2e;
  --reg-chip-border: #3a3a3c;
  --reg-avatar-border: rgba(255,255,255,0.14);
  --reg-camera-bg: #1c1c1e;
  --reg-error-bg: #3b1d1d;
  --reg-error-text: #fca5a5;
  --reg-error-border: #7f1d1d;
  --reg-danger-text: #fca5a5;
  --reg-ghost-bg: #1c1c1e;
  --reg-dropdown-shadow: 0 8px 20px rgba(0,0,0,0.42);
}

input::placeholder {
  color: var(--reg-soft-muted);
}

select option {
  color: #111827;
  background: #ffffff;
}

html.dark select option {
  color: #f5f5f7;
  background: #1c1c1e;
}

.registration-page-enter {
  animation: registrationPageFadeIn 260ms ease-out both;
}

@keyframes registrationPageFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.registration-step {
  opacity: 1;
}
`;

const s = {
  page: {
    height: '100dvh',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'var(--reg-page-bg)',
    padding: '0',
    overflow: 'hidden',
  },
  topBar: {
    width: '100%',
    maxWidth: 'none',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0',
    backgroundColor: 'var(--reg-page-bg)',
    boxShadow: 'none',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    minHeight: 'calc(env(safe-area-inset-top) + 56px)',
  },
  backButton: {
    position: 'fixed',
    left: '14px',
    top: 'calc(env(safe-area-inset-top) + 6px)',
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: 'var(--reg-subtext)',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
  },
  languageToggle: {
    position: 'fixed',
    right: '32px',
    top: 'calc(env(safe-area-inset-top) + 10px)',
    minWidth: '72px',
    height: '36px',
    padding: '0 12px',
    borderRadius: '6px',
    border: '1px solid var(--reg-soft-border)',
    backgroundColor: 'var(--reg-card-bg)',
    color: 'var(--reg-subtext)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  header: {
    width: '100%',
    textAlign: 'center',
    padding: '40px 32px 20px',
    backgroundColor: 'var(--reg-page-bg)',
    borderBottom: '1px solid var(--reg-soft-border)',
  },
  title: {
    fontSize: '32px',
    fontWeight: 700,
    color: 'var(--reg-text)',
    margin: '0 0 12px',
  },
  subtitle: {
    fontSize: '15px',
    color: 'var(--reg-muted)',
    margin: 0,
    lineHeight: 1.6,
    maxWidth: '600px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    marginTop: '0',
    padding: '6px 0 14px',
    backgroundColor: 'var(--reg-page-bg)',
    borderRadius: '0',
    maxWidth: AUTH_BOX_WIDTH,
    width: '100%',
    margin: '0 auto',
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
  },
  stepShell: {
    width: 'calc(100% - 32px)',
    maxWidth: AUTH_BOX_WIDTH,
    margin: '0 auto',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  formContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-start',
    paddingTop: '104px',
  },
  promptFormContent: {
    paddingTop: '30px',
    position: 'relative',
  },
  academicContent: {
    gap: '9px',
    paddingTop: '104px',
  },
  bottomAction: {
    flexShrink: 0,
    paddingBottom: 'calc(env(safe-area-inset-bottom) + 122px)',
  },
  formTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--reg-text)',
    margin: '0 0 4px',
    textAlign: 'left',
  },
  registrationPrompt: {
    margin: '0 0 8px',
    fontSize: '24px',
    lineHeight: 1.28,
    fontWeight: 700,
    color: 'var(--reg-text)',
    letterSpacing: 0,
    textAlign: 'left',
  },
  stageOneFieldStart: {
    position: 'absolute',
    top: '134px',
    left: 0,
    right: 0,
  },
  stageTwoFieldStart: {
    position: 'absolute',
    top: '141px',
    left: 0,
    right: 0,
  },
  accountProfileSlot: {
    position: 'absolute',
    top: '80px',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
  },
  accountFieldStart: {
    position: 'absolute',
    top: '204px',
    left: 0,
    right: 0,
  },
  aboutTopGrid: {
    display: 'grid',
    gridTemplateColumns: '94px 1fr',
    gap: '14px',
    alignItems: 'center',
    height: '96px',
    minHeight: '96px',
  },
  profilePicker: {
    display: 'flex',
    justifyContent: 'center',
  },
  avatarButton: {
    position: 'relative',
    width: '86px',
    height: '86px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
  },
  avatarCircle: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '0',
    border: '1px solid var(--reg-avatar-border)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  cameraBadge: {
    position: 'absolute',
    right: '-1px',
    bottom: '1px',
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    backgroundColor: 'var(--reg-camera-bg)',
    border: '1px solid var(--reg-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(17,24,39,0.14)',
  },
  aboutIntro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    justifyContent: 'center',
    minWidth: 0,
    maxWidth: '100%',
  },
  aboutIntroEn: {
    margin: 0,
    fontSize: '16px',
    lineHeight: 1.2,
    fontWeight: 600,
    color: 'var(--reg-text)',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  aboutIntroKo: {
    margin: 0,
    fontSize: '20px',
    lineHeight: 1.25,
    fontWeight: 600,
    color: 'var(--reg-text)',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  compactHero: {
    display: 'grid',
    gridTemplateColumns: '60px 1fr',
    gap: '12px',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  academicHero: {
    display: 'grid',
    gridTemplateColumns: '42px 1fr',
    gap: '12px',
    alignItems: 'center',
    height: '44px',
    minHeight: '44px',
    marginTop: '-4px',
    alignSelf: 'stretch',
  },
  avatarButtonCompact: {
    position: 'relative',
    width: '54px',
    height: '54px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
  },
  avatarCircleCompact: {
    width: '50px',
    height: '50px',
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--reg-avatar-border)',
  },
  cameraBadgeCompact: {
    position: 'absolute',
    right: '0',
    bottom: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: 'var(--reg-camera-bg)',
    border: '1px solid var(--reg-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(17,24,39,0.14)',
  },
  compactIntro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    minWidth: 0,
    maxWidth: '100%',
  },
  compactIntroLine: {
    margin: 0,
    fontSize: '16px',
    lineHeight: 1.2,
    fontWeight: 600,
    color: 'var(--reg-text)',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  avatarButtonAcademic: {
    position: 'relative',
    width: '38px',
    height: '38px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'default',
  },
  avatarCircleAcademic: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--reg-avatar-border)',
  },
  cameraBadgeAcademic: {
    display: 'none',
  },
  compactIntroName: {
    margin: 0,
    fontSize: '20px',
    lineHeight: 1.2,
    fontWeight: 600,
    color: 'var(--reg-text)',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  nameGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '8px',
    marginTop: '8px',
  },
  nameGroupGap: {
    height: '4px',
  },
  fieldStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  touchableField: {
    cursor: 'text',
  },
  academicGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '8px',
  },
  input: {
    padding: '0',
    borderRadius: '0',
    border: 'none',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--reg-field-bg)',
    color: 'var(--reg-text)',
    minHeight: '20px',
  },
  select: {
    padding: '0',
    borderRadius: '0',
    border: 'none',
    fontSize: '14px',
    backgroundColor: 'var(--reg-field-bg)',
    color: 'var(--reg-text)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '20px',
  },
  radioGroup: {
    display: 'flex',
    gap: '20px',
    marginTop: '4px',
    flexWrap: 'wrap',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    color: 'var(--reg-subtext)',
    cursor: 'pointer',
  },
  programmeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '7px 8px',
    marginTop: '2px',
  },
  programmeField: {
    minHeight: '104px',
  },
  programmeOption: {
    position: 'relative',
    minHeight: '30px',
    borderRadius: '9999px',
    border: '1px solid var(--reg-chip-border)',
    backgroundColor: 'var(--reg-field-bg)',
    color: 'var(--reg-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  programmeOptionActive: {
    backgroundColor: 'var(--reg-text)',
    borderColor: 'var(--reg-text)',
    color: 'var(--reg-page-bg)',
  },
  programmeRadio: {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
  },
  yearGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '7px',
    marginTop: '2px',
  },
  yearField: {
    minHeight: '72px',
  },
  yearOption: {
    minHeight: '30px',
    borderRadius: '9999px',
    border: '1px solid var(--reg-chip-border)',
    backgroundColor: 'var(--reg-field-bg)',
    color: 'var(--reg-muted)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  yearOptionActive: {
    backgroundColor: 'var(--reg-text)',
    borderColor: 'var(--reg-text)',
    color: 'var(--reg-page-bg)',
  },
  stepActions: {
    display: 'flex',
    gap: '10px',
    marginTop: '8px',
  },
  submitBtn: {
    marginTop: '2px',
    padding: '12px 10px',
    borderRadius: '9999px',
    border: 'none',
    background: '#f97316',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.5,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  errorBanner: {
    padding: '10px 12px',
    margin: '20px auto',
    borderRadius: '6px',
    backgroundColor: 'var(--reg-error-bg)',
    color: 'var(--reg-error-text)',
    border: '1px solid var(--reg-error-border)',
    fontSize: '13px',
    maxWidth: '800px',
    width: '100%',
  },
  loginPrompt: {
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--reg-muted)',
    margin: '4px 0 0',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#f97316',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
    padding: 0,
  },
  ghostBtn: {
    background: 'var(--reg-ghost-bg)',
    borderRadius: '9999px',
    border: 'none',
    cursor: 'pointer',
    padding: '10px',
    color: 'var(--reg-muted)',
    textAlign: 'center',
    fontSize: '13px',
    fontWeight: 500,
  },
  note: {
    marginTop: '0',
    marginBottom: '10px',
    fontSize: '11px',
    color: 'var(--reg-soft-muted)',
    textAlign: 'center',
  },
  helperText: {
    fontSize: '12px',
    color: 'var(--reg-muted)',
    margin: '4px 0 0',
    fontStyle: 'italic',
  },
  typeaheadContainer: {
    position: 'relative',
    width: '100%',
  },
  typeaheadInputSpacer: {
    paddingRight: '20px',
  },
  dropdownIcon: {
    position: 'absolute',
    right: '0',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--reg-soft-muted)',
    fontSize: '16px',
    lineHeight: 1,
    pointerEvents: 'none',
  },
  typeaheadList: {
    position: 'absolute',
    top: '100%',
    left: '-14px',
    right: '-14px',
    maxHeight: '180px',
    overflowY: 'auto',
    backgroundColor: 'var(--reg-card-bg)',
    borderRadius: '6px',
    boxShadow: 'var(--reg-dropdown-shadow)',
    marginTop: '4px',
    zIndex: 20,
    border: '1px solid var(--reg-soft-border)',
  },
  typeaheadItem: {
    padding: '8px 10px',
    fontSize: '14px',
    cursor: 'pointer',
    color: 'var(--reg-subtext)',
  },
  emailCard: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: 'var(--reg-page-bg)',
    borderRadius: '0',
    boxShadow: 'none',
    padding: '0 0 14px',
    maxWidth: AUTH_BOX_WIDTH,
    width: 'calc(100% - 32px)',
    margin: 0,
  },
  emailIcon: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    margin: '0 auto 18px',
    backgroundColor: 'var(--reg-ghost-bg)',
    border: '1px solid var(--reg-soft-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailText: {
    fontSize: '14px',
    color: 'var(--reg-muted)',
    lineHeight: 1.6,
    margin: 0,
  },
  legalBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    padding: '10px 12px',
    border: '1px solid var(--reg-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--reg-field-bg)',
  },
  legalRow: {
    display: 'grid',
    gridTemplateColumns: '18px 1fr auto',
    gap: '8px',
    alignItems: 'center',
    minHeight: '24px',
    color: 'var(--reg-subtext)',
    fontSize: '11px',
  },
  legalCheckbox: {
    width: '15px',
    height: '15px',
    margin: 0,
    accentColor: '#f97316',
    cursor: 'pointer',
  },
  legalText: {
    minWidth: 0,
    lineHeight: 1.25,
  },
  legalReadButton: {
    border: 'none',
    background: 'transparent',
    color: '#f97316',
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 0',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  legalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    backgroundColor: 'rgba(0,0,0,0.58)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    boxSizing: 'border-box',
  },
  legalModal: {
    width: '100%',
    maxWidth: '720px',
    maxHeight: '82dvh',
    backgroundColor: 'var(--reg-card-bg)',
    color: 'var(--reg-text)',
    borderRadius: '8px',
    border: '1px solid var(--reg-soft-border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 18px 48px rgba(0,0,0,0.26)',
    margin: 'auto',
  },
  legalModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '14px 16px',
    borderBottom: '1px solid var(--reg-soft-border)',
  },
  legalModalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--reg-text)',
  },
  legalModalDate: {
    margin: '5px 0 0',
    fontSize: '12px',
    color: 'var(--reg-muted)',
  },
  legalCloseButton: {
    border: 'none',
    borderRadius: '9999px',
    backgroundColor: 'var(--reg-ghost-bg)',
    color: 'var(--reg-subtext)',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  legalModalBody: {
    padding: '14px 16px 20px',
    overflowY: 'auto',
  },
  legalParagraph: {
    margin: '0 0 10px',
    fontSize: '13px',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    color: 'var(--reg-subtext)',
  },
  legalSpacer: {
    margin: '0 0 6px',
    minHeight: '1px',
  },
  cropOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  cropModal: {
    width: '100%',
    maxWidth: '380px',
    backgroundColor: 'var(--reg-card-bg)',
    borderRadius: '16px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  cropTitle: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--reg-text)',
  },
  cropFrame: {
    position: 'relative',
    width: '100%',
    height: '280px',
    borderRadius: '14px',
    overflow: 'hidden',
    backgroundColor: 'var(--reg-text)',
  },
  zoomSlider: {
    width: '100%',
  },
  cropActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cropCancelBtn: {
    padding: '8px 14px',
    borderRadius: '9999px',
    border: 'none',
    backgroundColor: 'var(--reg-ghost-bg)',
    color: 'var(--reg-muted)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  cropConfirmBtn: {
    padding: '8px 16px',
    borderRadius: '9999px',
    border: 'none',
    backgroundColor: 'var(--reg-text)',
    color: 'var(--reg-page-bg)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};


