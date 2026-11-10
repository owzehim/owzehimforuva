// ------------------------------------------------------------
// UvA-IN Master Sheet Apps Script
//
// Internal raw live tracker only.
// You may rename header labels and resize columns manually.
// Do not move/reorder columns unless you also update COL below.
//
// Fixed column map, 1-based:
//
// OPERATIONAL
// A=1  scan_date
// B=2  scan_time
// C=3  redemption_id
// D=4  restaurant_id
// E=5  place_name
// F=6  gap_1
//
// IDENTITY
// G=7  user_id
// H=8  first_name
// I=9  last_name
// J=10 first_name_korean
// K=11 last_name_korean
// L=12 university
// M=13 student_number
// N=14 education_level
// O=15 year_number
// P=16 major
// Q=17 gender
// R=18 year_of_birth
// S=19 country_of_origin
// T=20 gap_2
//
// REWARDS
// U=21 stamp_card_progress
// V=22 stamp_card_status
// W=23 stamp_card_claimed_at_date
// X=24 stamp_card_claimed_at_time
// Y=25 gap_3
//
// REVIEW
// Z=26 star_rating
// AA=27 great_food        (멤버 평가 item 1 — a place may rename it)
// AB=28 friendly_staff    (item 2)
// AC=29 nice_atmosphere   (item 3)
// AD=30 good_value        (item 4)
// AE=31 comment
// AF=32 review_submitted_at_date
// AG=33 review_submitted_at_time
// AH=34 gap_4
//
// PRIVACY LIFECYCLE
// AI=35 account_status
// AJ=36 membership_valid_until
// AK=37 membership_ended_at_date
// AL=38 membership_ended_at_time
// AM=39 identity_anonymized_at_date
// AN=40 identity_anonymized_at_time
// AO=41 gap_5
//
// AUDIT
// AP=42 created_at_date
// AQ=43 created_at_time
// AR=44 updated_at_date
// AS=45 updated_at_time
//
// PLACE 멤버 평가 ITEMS (added v9; places can rename the 4 items above)
// AT=46 review_items       chosen items in the place's own words, e.g. "커피 맛, 와이파이"
// AU=47 review_item_names  the place's item 1–4 names, e.g. "커피 맛 / 공부하기 좋아요 / 와이파이 / 가성비"
// ------------------------------------------------------------

// CHANGE THIS VALUE: the ID from the master spreadsheet's URL.
const MASTER_SPREADSHEET_ID = 'REPLACE_WITH_MASTER_SPREADSHEET_ID';
const SHEET_NAME = 'All Scans';
const SCRIPT_VERSION = 'uvain-master-label-flexible-v9-place-review-items';
const COLUMN_COUNT = 47;
const ANONYMIZED_VALUE = '---';

const COL = {
  scan_date: 1,
  scan_time: 2,
  redemption_id: 3,
  restaurant_id: 4,
  place_name: 5,
  gap_1: 6,

  user_id: 7,
  first_name: 8,
  last_name: 9,
  first_name_korean: 10,
  last_name_korean: 11,
  university: 12,
  student_number: 13,
  education_level: 14,
  year_number: 15,
  major: 16,
  gender: 17,
  year_of_birth: 18,
  country_of_origin: 19,
  gap_2: 20,

  stamp_card_progress: 21,
  stamp_card_status: 22,
  stamp_card_claimed_at_date: 23,
  stamp_card_claimed_at_time: 24,
  gap_3: 25,

  star_rating: 26,
  great_food: 27,
  friendly_staff: 28,
  nice_atmosphere: 29,
  good_value: 30,
  comment: 31,
  review_submitted_at_date: 32,
  review_submitted_at_time: 33,
  gap_4: 34,

  account_status: 35,
  membership_valid_until: 36,
  membership_ended_at_date: 37,
  membership_ended_at_time: 38,
  identity_anonymized_at_date: 39,
  identity_anonymized_at_time: 40,
  gap_5: 41,

  created_at_date: 42,
  created_at_time: 43,
  updated_at_date: 44,
  updated_at_time: 45,

  review_items: 46,
  review_item_names: 47,
};

const DEFAULT_HEADERS = [
  'Scan Date',
  'Scan Time',
  'Redemption ID',
  'Restaurant ID',
  'Place Name',
  '',
  'User ID',
  'First Name',
  'Last Name',
  'First Name Korean',
  'Last Name Korean',
  'University',
  'Student Number',
  'Programme',
  'Year',
  'Major',
  'Gender',
  'Year of Birth',
  'Country of Origin',
  '',
  'Stamp Card Progress',
  'Stamp Card Status',
  'Claimed At [Date]',
  'Claimed At [Time]',
  '',
  'Star Rating',
  'Great Food',
  'Friendly Staff',
  'Nice Atmosphere',
  'Good Value',
  'Comment',
  'Review Submitted At [Date]',
  'Review Submitted At [Time]',
  '',
  'Account Status',
  'Membership Valid Until',
  'Membership Ended At [Date]',
  'Membership Ended At [Time]',
  'Identity Anonymized At [Date]',
  'Identity Anonymized At [Time]',
  '',
  'Created At [Date]',
  'Created At [Time]',
  'Updated At [Date]',
  'Updated At [Time]',
  'Review Items',
  'Review Item Names (1–4)',
];

const IDENTITY_COLUMNS_TO_ANONYMIZE = [
  COL.user_id,
  COL.first_name,
  COL.last_name,
  COL.first_name_korean,
  COL.last_name_korean,
  COL.university,
  COL.student_number,
  COL.education_level,
  COL.year_number,
  COL.major,
  COL.gender,
  COL.year_of_birth,
  COL.country_of_origin,
];

// Keep only the minimum operational fields after anonymization. These values
// can otherwise link a row back to a member or expose personal free text.
const ADDITIONAL_COLUMNS_TO_CLEAR = [
  COL.scan_time,
  COL.redemption_id,
  COL.stamp_card_claimed_at_date,
  COL.stamp_card_claimed_at_time,
  COL.comment,
  COL.review_submitted_at_date,
  COL.review_submitted_at_time,
  COL.membership_valid_until,
  COL.membership_ended_at_date,
  COL.membership_ended_at_time,
  COL.created_at_time,
  COL.updated_at_date,
  COL.updated_at_time,
];

function doGet() {
  return jsonResponse({
    success: true,
    app: 'uvain-master-sheet',
    version: SCRIPT_VERSION,
    sheet_name: SHEET_NAME,
    column_count: COLUMN_COUNT,
    note: 'Header labels may be renamed. Column positions must stay fixed.',
  });
}

function authorizeWebhook(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

  const expected = PropertiesService.getScriptProperties().getProperty('MASTER_APPS_SCRIPT_SECRET');
  const supplied = typeof data.__uvain_shared_secret === 'string' ? data.__uvain_shared_secret : '';
  if (!expected || expected.length < 32 || !supplied || supplied.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }

  if (mismatch !== 0) return false;
  delete data.__uvain_shared_secret;
  return true;
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!authorizeWebhook(data)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }
    const sheet = getMasterSheet();
    ensureMinimumHeader(sheet);
    ensureReviewItemColumns(sheet);

    if (data.type === 'master') {
      upsertMasterScan(sheet, buildMasterValues(data, new Date()));
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'master_written' });
    }

    if (data.type === 'review') {
      updateReview(sheet, data);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'review_updated' });
    }

    if (data.type === 'stamp_claim') {
      updateStampClaim(sheet, data);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'stamp_claim_updated' });
    }

    if (data.type === 'privacy_anonymize') {
      anonymizeRowsForUser(sheet, data.user_id, new Date());
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'privacy_anonymized' });
    }

    throw new Error('Unknown request type: ' + data.type);
  } catch (err) {
    return jsonResponse({
      success: false,
      version: SCRIPT_VERSION,
      error: err && err.message ? err.message : String(err),
    });
  }
}

function setupMasterSheetHeaders() {
  const sheet = getMasterSheet();
  ensureColumnCount(sheet);
  sheet.getRange(1, 1, 1, COLUMN_COUNT).setValues([DEFAULT_HEADERS]);
  sheet.setFrozenRows(1);
}

function setupMasterSheetAndClearRows() {
  const sheet = getMasterSheet();
  sheet.clearContents();
  setupMasterSheetHeaders();
}

// The sheet needs room for AT:AU. Older sheets stop at AS, so add columns
// once; existing header labels (which you may have renamed) are kept.
function ensureColumnCount(sheet) {
  const missing = COLUMN_COUNT - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
}

function ensureReviewItemColumns(sheet) {
  ensureColumnCount(sheet);
  const headerRange = sheet.getRange(1, COL.review_items, 1, 2);
  const headers = headerRange.getValues()[0];
  if (!headers[0] && !headers[1]) {
    headerRange.setValues([[
      DEFAULT_HEADERS[COL.review_items - 1],
      DEFAULT_HEADERS[COL.review_item_names - 1],
    ]]);
  }
}

function buildMasterValues(data, now) {
  const values = blankRow();
  const membershipValidUntil = value(data.membership_valid_until);
  const lifecycle = getMembershipLifecycle(membershipValidUntil);

  values[COL.scan_date - 1] = value(data.date) || formatDate(now);
  values[COL.scan_time - 1] = value(data.time) || formatTime(now);
  values[COL.redemption_id - 1] = value(data.redemption_id);
  values[COL.restaurant_id - 1] = value(data.restaurant_id) || value(data.store_id);
  values[COL.place_name - 1] = value(data.place_name) || value(data.store_name);

  values[COL.user_id - 1] = value(data.user_id);
  values[COL.first_name - 1] = value(data.first_name);
  values[COL.last_name - 1] = value(data.last_name);
  values[COL.first_name_korean - 1] = value(data.first_name_korean);
  values[COL.last_name_korean - 1] = value(data.last_name_korean);
  values[COL.university - 1] = value(data.university) || value(data.University);
  values[COL.student_number - 1] = value(data.student_number) || value(data.student_id);
  values[COL.education_level - 1] = value(data.education_level);
  values[COL.year_number - 1] = data.year_number ?? '';
  values[COL.major - 1] = value(data.major);
  values[COL.gender - 1] = value(data.gender);
  values[COL.year_of_birth - 1] = value(data.year_of_birth);
  values[COL.country_of_origin - 1] = value(data.country_of_origin);

  values[COL.stamp_card_progress - 1] = value(data.stamp_card_progress) || value(data.stamp_progress);
  values[COL.stamp_card_status - 1] = value(data.stamp_card_status) || value(data.stamp_status);

  if (isClaimed(data.stamp_card_claimed_after_scan)) {
    values[COL.stamp_card_claimed_at_date - 1] = formatDate(now);
    values[COL.stamp_card_claimed_at_time - 1] = formatTime(now);
  }

  values[COL.star_rating - 1] = value(data.star_rating);
  values[COL.great_food - 1] = boolish(data.great_food);
  values[COL.friendly_staff - 1] = boolish(data.friendly_staff);
  values[COL.nice_atmosphere - 1] = boolish(data.nice_atmosphere);
  values[COL.good_value - 1] = boolish(data.good_value);
  values[COL.comment - 1] = value(data.comment);

  values[COL.account_status - 1] = value(data.account_status) || lifecycle.accountStatus;
  values[COL.membership_valid_until - 1] = membershipValidUntil;
  setDateTimeValues(values, COL.membership_ended_at_date, COL.membership_ended_at_time, value(data.membership_ended_at) || lifecycle.membershipEndedAt);
  setDateTimeValues(values, COL.identity_anonymized_at_date, COL.identity_anonymized_at_time, value(data.identity_anonymized_at));

  setAuditValues(values, now, now);

  return values;
}

function upsertMasterScan(sheet, values) {
  const redemptionId = values[COL.redemption_id - 1];
  const existingRow = findRowByColumnValue(sheet, COL.redemption_id, redemptionId);
  const targetRow = existingRow === -1 ? Math.max(sheet.getLastRow() + 1, 2) : existingRow;

  if (existingRow !== -1) {
    const current = sheet.getRange(targetRow, 1, 1, COLUMN_COUNT).getValues()[0];
    values[COL.created_at_date - 1] = current[COL.created_at_date - 1];
    values[COL.created_at_time - 1] = current[COL.created_at_time - 1];
    // A scan resync must not erase the review item names written by a review.
    values[COL.review_items - 1] = current[COL.review_items - 1];
    values[COL.review_item_names - 1] = current[COL.review_item_names - 1];
    setUpdatedValues(values, new Date());
  }

  sheet.getRange(targetRow, 1, 1, COLUMN_COUNT).setValues([values]);
}

function updateReview(sheet, data) {
  const row = findRequiredRowByRedemptionId(sheet, data.redemption_id, 'review');
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const now = new Date();

  sheet.getRange(row, COL.star_rating).setValue(value(data.rating));
  sheet.getRange(row, COL.great_food).setValue(tags.includes('GREAT_FOOD') ? 1 : '');
  sheet.getRange(row, COL.friendly_staff).setValue(tags.includes('FRIENDLY_STAFF') ? 1 : '');
  sheet.getRange(row, COL.nice_atmosphere).setValue(tags.includes('NICE_ATMOSPHERE') ? 1 : '');
  sheet.getRange(row, COL.good_value).setValue(tags.includes('GOOD_VALUE') ? 1 : '');
  sheet.getRange(row, COL.comment).setValue(value(data.comment));
  sheet.getRange(row, COL.review_submitted_at_date).setValue(value(data.review_submitted_at_date) || formatDate(now));
  sheet.getRange(row, COL.review_submitted_at_time).setValue(value(data.review_submitted_at_time) || formatTime(now));

  // The place's own 멤버 평가 names (sent by the app since v9). Older app
  // versions do not send them; then these two cells stay as they were.
  if (Array.isArray(data.criteria) && data.criteria.length === 4) {
    sheet.getRange(row, COL.review_items, 1, 2).setValues([[
      safeText(data.tag_labels, 200),
      data.criteria.map(label => safeText(label, 40)).join(' / '),
    ]]);
  }

  setUpdatedRange(sheet, row, now);
}

function updateStampClaim(sheet, data) {
  const row = findRequiredRowByRedemptionId(sheet, data.redemption_id, 'stamp_claim');
  const now = new Date();

  if (value(data.stamp_card_progress) || value(data.stamp_progress)) {
    sheet.getRange(row, COL.stamp_card_progress).setValue(value(data.stamp_card_progress) || value(data.stamp_progress));
  }

  sheet.getRange(row, COL.stamp_card_status).setValue(value(data.stamp_status) || 'claimed');
  sheet.getRange(row, COL.stamp_card_claimed_at_date).setValue(value(data.claimed_at_date) || formatDate(now));
  sheet.getRange(row, COL.stamp_card_claimed_at_time).setValue(value(data.claimed_at_time) || formatTime(now));
  setUpdatedRange(sheet, row, now);
}

function runRetentionCleanup() {
  const sheet = getMasterSheet();
  ensureColumnCount(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, 1, lastRow - 1, COLUMN_COUNT).getValues();
  const now = new Date();

  values.forEach((rowValues, index) => {
    const rowNumber = index + 2;
    const membershipEndedAt = combineDateTime(
      rowValues[COL.membership_ended_at_date - 1],
      rowValues[COL.membership_ended_at_time - 1]
    );
    const alreadyAnonymized =
      rowValues[COL.identity_anonymized_at_date - 1] ||
      rowValues[COL.identity_anonymized_at_time - 1];

    if (!membershipEndedAt || alreadyAnonymized) return;

    const retentionLimit = new Date(membershipEndedAt);
    retentionLimit.setMonth(retentionLimit.getMonth() + 12);

    if (now >= retentionLimit) {
      anonymizeMasterRow(sheet, rowNumber, now);
    }
  });
}

function anonymizeRowsForUser(sheet, userId, now) {
  if (!userId) throw new Error('user_id is required for privacy_anonymize');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, COL.user_id, lastRow - 1, 1).getValues();
  const target = String(userId);

  values.forEach((row, index) => {
    if (String(row[0]) === target) {
      anonymizeMasterRow(sheet, index + 2, now);
    }
  });
}

function anonymizeMasterRow(sheet, row, now) {
  IDENTITY_COLUMNS_TO_ANONYMIZE.forEach(col => {
    sheet.getRange(row, col).setValue(ANONYMIZED_VALUE);
  });
  ADDITIONAL_COLUMNS_TO_CLEAR.forEach(col => {
    sheet.getRange(row, col).clearContent();
  });

  sheet.getRange(row, COL.account_status).setValue('anonymized');
  sheet.getRange(row, COL.identity_anonymized_at_date).setValue(formatDate(now));
  sheet.getRange(row, COL.identity_anonymized_at_time).setValue(formatTime(now));
  setUpdatedRange(sheet, row, now);
}

function setAuditValues(rowValues, createdAt, updatedAt) {
  rowValues[COL.created_at_date - 1] = formatDate(createdAt);
  rowValues[COL.created_at_time - 1] = formatTime(createdAt);
  setUpdatedValues(rowValues, updatedAt);
}

function setDateTimeValues(rowValues, dateCol, timeCol, input) {
  if (!input) return;

  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    rowValues[dateCol - 1] = input;
    return;
  }

  rowValues[dateCol - 1] = formatDate(parsed);
  rowValues[timeCol - 1] = hasTimeComponent(input) ? formatTime(parsed) : '';
}

function combineDateTime(dateValue, timeValue) {
  if (!dateValue) return '';
  if (dateValue instanceof Date) return dateValue;

  const dateText = String(dateValue);
  const timeText = timeValue ? String(timeValue) : '00:00';
  const dateParts = dateText.includes('/')
    ? dateText.split('/').map(Number)
    : dateText.split('-').map(Number).reverse();

  if (dateParts.length < 3 || dateParts.some(Number.isNaN)) return dateText;

  const [day, month, year] = dateParts;
  return new Date(year, month - 1, day, ...timeText.split(':').map(Number));
}

function hasTimeComponent(input) {
  return input instanceof Date || String(input).includes(':') || String(input).includes('T');
}

function setUpdatedValues(rowValues, updatedAt) {
  rowValues[COL.updated_at_date - 1] = formatDate(updatedAt);
  rowValues[COL.updated_at_time - 1] = formatTime(updatedAt);
}

function setUpdatedRange(sheet, row, updatedAt) {
  sheet.getRange(row, COL.updated_at_date).setValue(formatDate(updatedAt));
  sheet.getRange(row, COL.updated_at_time).setValue(formatTime(updatedAt));
}

function createDailyRetentionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'runRetentionCleanup')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runRetentionCleanup')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone('Europe/Amsterdam')
    .create();
}

function ensureMinimumHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  setupMasterSheetHeaders();
}

function findRequiredRowByRedemptionId(sheet, redemptionId, label) {
  const row = findRowByColumnValue(sheet, COL.redemption_id, redemptionId);
  if (row === -1) {
    throw new Error(label + ' row not found for redemption_id: ' + redemptionId);
  }
  return row;
}

function findRowByColumnValue(sheet, column, targetValue) {
  if (!targetValue) return -1;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  const target = String(targetValue);

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === target) return i + 2;
  }

  return -1;
}

function getMembershipLifecycle(membershipValidUntil) {
  if (!membershipValidUntil) {
    return { accountStatus: 'unknown', membershipEndedAt: '' };
  }

  const validUntil = new Date(membershipValidUntil);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (validUntil >= today) {
    return { accountStatus: 'active', membershipEndedAt: '' };
  }

  return {
    accountStatus: 'expired',
    membershipEndedAt: membershipValidUntil,
  };
}

function getMasterSheet() {
  const ss = SpreadsheetApp.openById(MASTER_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function blankRow() {
  return Array(COLUMN_COUNT).fill('');
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Europe/Amsterdam', 'dd/MM/yyyy');
}

function formatTime(date) {
  return Utilities.formatDate(date, 'Europe/Amsterdam', 'HH:mm');
}

// Text from the app is never treated as a formula.
function safeText(input, maxLength) {
  const text = String(input === null || input === undefined ? '' : input).slice(0, maxLength);
  return /^[\s﻿]*[=+\-@]/.test(text) ? "'" + text : text;
}

function boolish(input) {
  return input === true || input === 1 || input === '1' || input === 'true' ? 1 : '';
}

function isClaimed(input) {
  return input === true || input === 1 || input === '1' || input === 'true' || input === 'Yes';
}

function value(input) {
  return input === null || input === undefined ? '' : input;
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
