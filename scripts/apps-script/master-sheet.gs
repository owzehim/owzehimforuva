// ------------------------------------------------------------
// UvA-IN Master Sheet Apps Script
//
// Internal raw live tracker only.
// You may rename header labels and resize columns manually.
// Do not move/reorder columns unless you also update COL below.
//
// v11 (GDPR-14 option A): the Master sheet holds no names, student numbers,
// study fields, demographics or review comments. Members are identified only
// by user_id (random account code). A sheet in the older 47-column layout is
// moved to this layout automatically, once (see ensureLayoutV11).
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
// MEMBER
// G=7  user_id            random account code (no name)
// H=8  gap_2
//
// REWARDS
// I=9  stamp_card_progress
// J=10 stamp_card_status
// K=11 stamp_card_claimed_at_date
// L=12 stamp_card_claimed_at_time
// M=13 gap_3
//
// REVIEW
// N=14 star_rating
// O=15 great_food         (멤버 평가 item 1 — a place may rename it)
// P=16 friendly_staff     (item 2)
// Q=17 nice_atmosphere    (item 3)
// R=18 good_value         (item 4)
// S=19 review_items       chosen items in the place's own words
// T=20 review_item_names  the place's item 1–4 names
// U=21 review_submitted_at_date
// V=22 review_submitted_at_time
// W=23 gap_4
//
// PRIVACY LIFECYCLE
// X=24 account_status
// Y=25 membership_valid_until
// Z=26 membership_ended_at_date
// AA=27 membership_ended_at_time
// AB=28 identity_anonymized_at_date
// AC=29 identity_anonymized_at_time
// AD=30 gap_5
//
// AUDIT
// AE=31 created_at_date
// AF=32 created_at_time
// AG=33 updated_at_date
// AH=34 updated_at_time
// ------------------------------------------------------------

// CHANGE THIS VALUE: the ID from the master spreadsheet's URL.
const MASTER_SPREADSHEET_ID = 'REPLACE_WITH_MASTER_SPREADSHEET_ID';
const SHEET_NAME = 'All Scans';
const SCRIPT_VERSION = 'uvain-master-v11-compact-no-identity';
const COLUMN_COUNT = 34;
const ANONYMIZED_VALUE = '---';
const LAYOUT_PROPERTY = 'MASTER_LAYOUT';
const LAYOUT_VERSION = 'v11';

const COL = {
  scan_date: 1,
  scan_time: 2,
  redemption_id: 3,
  restaurant_id: 4,
  place_name: 5,
  gap_1: 6,

  user_id: 7,
  gap_2: 8,

  stamp_card_progress: 9,
  stamp_card_status: 10,
  stamp_card_claimed_at_date: 11,
  stamp_card_claimed_at_time: 12,
  gap_3: 13,

  star_rating: 14,
  great_food: 15,
  friendly_staff: 16,
  nice_atmosphere: 17,
  good_value: 18,
  review_items: 19,
  review_item_names: 20,
  review_submitted_at_date: 21,
  review_submitted_at_time: 22,
  gap_4: 23,

  account_status: 24,
  membership_valid_until: 25,
  membership_ended_at_date: 26,
  membership_ended_at_time: 27,
  identity_anonymized_at_date: 28,
  identity_anonymized_at_time: 29,
  gap_5: 30,

  created_at_date: 31,
  created_at_time: 32,
  updated_at_date: 33,
  updated_at_time: 34,
};

// Column positions of the v9/v10 layout (47 columns), used only to move old
// rows. Name, student number, study, demographics and comment are not copied.
const LEGACY_COLUMN_COUNT = 47;
const LEGACY_COL = {
  scan_date: 1, scan_time: 2, redemption_id: 3, restaurant_id: 4, place_name: 5,
  user_id: 7,
  stamp_card_progress: 21, stamp_card_status: 22,
  stamp_card_claimed_at_date: 23, stamp_card_claimed_at_time: 24,
  star_rating: 26, great_food: 27, friendly_staff: 28, nice_atmosphere: 29, good_value: 30,
  review_submitted_at_date: 32, review_submitted_at_time: 33,
  account_status: 35, membership_valid_until: 36,
  membership_ended_at_date: 37, membership_ended_at_time: 38,
  identity_anonymized_at_date: 39, identity_anonymized_at_time: 40,
  created_at_date: 42, created_at_time: 43, updated_at_date: 44, updated_at_time: 45,
  review_items: 46, review_item_names: 47,
};

const DEFAULT_HEADERS = [
  'Scan Date',
  'Scan Time',
  'Redemption ID',
  'Restaurant ID',
  'Place Name',
  '',
  'User ID',
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
  'Review Items',
  'Review Item Names (1–4)',
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
];

const IDENTITY_COLUMNS_TO_ANONYMIZE = [
  COL.user_id,
];

// Keep only the minimum operational fields after anonymization. These values
// can otherwise link a row back to a member.
const ADDITIONAL_COLUMNS_TO_CLEAR = [
  COL.scan_time,
  COL.redemption_id,
  COL.stamp_card_claimed_at_date,
  COL.stamp_card_claimed_at_time,
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
    layout: LAYOUT_VERSION,
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
    ensureLayoutV11(sheet);
    ensureMinimumHeader(sheet);

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
  PropertiesService.getScriptProperties().setProperty(LAYOUT_PROPERTY, LAYOUT_VERSION);
}

function setupMasterSheetAndClearRows() {
  const sheet = getMasterSheet();
  sheet.clearContents();
  setupMasterSheetHeaders();
}

function ensureColumnCount(sheet) {
  const missing = COLUMN_COUNT - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
}

// Moves a sheet in the old 47-column layout to the v11 layout, once. Runs by
// itself on the first request after v11 is deployed, or run it from the
// editor (migrateMasterSheetToV11). Old rows keep their visit, stamp, rating
// and membership data; name, student number, study, demographics and comment
// are dropped. Header labels are reset to the v11 defaults. An empty sheet
// just gets the v11 headers.
function ensureLayoutV11(sheet) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(LAYOUT_PROPERTY) === LAYOUT_VERSION) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (props.getProperty(LAYOUT_PROPERTY) === LAYOUT_VERSION) return;
    const lastRow = sheet.getLastRow();
    const width = Math.min(sheet.getMaxColumns(), LEGACY_COLUMN_COUNT);
    const oldRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    const newRows = oldRows.map(old => {
      const row = blankRow();
      Object.keys(LEGACY_COL).forEach(key => {
        const oldValue = old[LEGACY_COL[key] - 1];
        row[COL[key] - 1] = oldValue === undefined ? '' : oldValue;
      });
      return row;
    });

    if (lastRow > 0) sheet.getRange(1, 1, lastRow, width).clearContent();
    ensureColumnCount(sheet);
    sheet.getRange(1, 1, 1, COLUMN_COUNT).setValues([DEFAULT_HEADERS]);
    sheet.setFrozenRows(1);
    if (newRows.length) sheet.getRange(2, 1, newRows.length, COLUMN_COUNT).setValues(newRows);
    const extra = sheet.getMaxColumns() - COLUMN_COUNT;
    if (extra > 0) sheet.deleteColumns(COLUMN_COUNT + 1, extra);

    props.setProperty(LAYOUT_PROPERTY, LAYOUT_VERSION);
    console.log(JSON.stringify({ action: 'master_layout_v11', rows_moved: newRows.length }));
  } finally {
    lock.releaseLock();
  }
}

// Run once from the Apps Script editor right after deploying v11 (or let the
// first request do it). Safe to run again: it does nothing once migrated.
function migrateMasterSheetToV11() {
  ensureLayoutV11(getMasterSheet());
  return 'Master sheet layout: ' + LAYOUT_VERSION;
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
  ensureLayoutV11(sheet);
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
