// ------------------------------------------------------------
// UvA-IN Partner Owner Sheet Apps Script
//
// Use this script inside ONE restaurant owner's Google Sheet.
// This is the easy version:
// - Make one Google Sheet for one partner.
// - Paste this script into that sheet's Apps Script.
// - Change PARTNERSHIP_ID only.
// - Deploy as Web App.
// - Run installPartnerRetentionTrigger once from the Apps Script editor.
// - Store this Web App URL in partnership_integrations.partner_apps_script_url.
//
// This sheet receives only safe operational data.
// It does NOT receive student name, user_id, student number, university,
// major, country, gender, birth year, or membership data.
//
// Fixed column map, 1-based:
//
// A=1  Scan Date
// B=2  Redemption ID
// C=3  empty gap
// D=4  Stamp Card Progress
// E=5  Stamp Card Status
// F=6  Claimed At [Date]
// G=7  empty gap
// H:M are retired. Reviews are shown only in the separate thresholded summary.
// N=14 empty gap
// O=15 Created At [Date]
// P=16 Updated At [Date]
// ------------------------------------------------------------

// CHANGE THIS VALUE ONLY.
// Copy it from Supabase -> partnerships -> id.
const PARTNERSHIP_ID = 'REPLACE_WITH_PARTNERSHIP_ID';

const SHEET_NAME = 'Operations';
const SUMMARY_SHEET_NAME = 'Reviews Summary';
const SCRIPT_VERSION = 'uvain-partner-owner-sheet-v8-aggregate-reviews';
const COLUMN_COUNT = 16;
const SUMMARY_COLUMN_COUNT = 8;
const RETENTION_MONTHS = 12;
const RETENTION_TIME_ZONE = 'Europe/Amsterdam';
const RETENTION_TRIGGER_HANDLER = 'purgeExpiredPartnerRecords';

const COL = {
  date: 1,
  redemption_id: 2,
  stamp_card_progress: 4,
  stamp_card_status: 5,
  claimed_at_date: 6,
  created_at_date: 15,
  updated_at_date: 16,
};

const DEFAULT_HEADERS = [
  'Scan Date',
  'Redemption ID',
  '',
  'Stamp Card Progress',
  'Stamp Card Status',
  'Claimed At [Date]',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  'Created At [Date]',
  'Updated At [Date]',
];

function doGet() {
  return jsonResponse({
    success: true,
    app: 'uvain-partner-owner-sheet',
    version: SCRIPT_VERSION,
    partnership_id: PARTNERSHIP_ID,
    sheet_name: SHEET_NAME,
    message: 'This is one restaurant owner sheet script.',
  });
}

function authorizeWebhook(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

  const expected = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SHARED_SECRET');
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
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!authorizeWebhook(data)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }
    validatePartnership(data);

    lock.waitLock(30000);
    const sheet = getOperationsSheet();
    ensureMinimumHeader(sheet);

    if (data.type === 'store' || data.type === 'partner' || data.type === 'scan') {
      upsertScan(sheet, buildScanRow(data, new Date()));
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'scan_written' });
    }

    if (data.type === 'stamp_claim') {
      updateStampClaim(sheet, data);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'stamp_claim_updated' });
    }

    if (data.type === 'review_summary') {
      upsertReviewSummary(data);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, action: 'review_summary_updated' });
    }

    if (data.type === 'review') {
      throw new Error('Individual review rows are disabled for partner sheets');
    }

    throw new Error('Unknown request type: ' + data.type);
  } catch (err) {
    return jsonResponse({
      success: false,
      version: SCRIPT_VERSION,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function setupPartnerSheetHeaders() {
  const sheet = getOperationsSheet();
  sheet.getRange(1, 1, 1, COLUMN_COUNT).setValues([DEFAULT_HEADERS]);
  sheet.setFrozenRows(1);
}

function setupPartnerSheetAndClearRows() {
  const sheet = getOperationsSheet();
  sheet.clearContents();
  setupPartnerSheetHeaders();
}

function setupReviewSummaryHeaders() {
  const sheet = getReviewSummarySheet();
  sheet.getRange(1, 1, 1, SUMMARY_COLUMN_COUNT).setValues([[
    'Partnership ID', 'Average Rating', 'Reviews', 'Great Food',
    'Friendly Staff', 'Nice Atmosphere', 'Good Value', 'Updated At',
  ]]);
  sheet.setFrozenRows(1);
}

function clearLegacyIndividualReviewData() {
  const sheet = getOperationsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 8, lastRow - 1, 6).clearContent();
  return 'Cleared legacy per-redemption review values from Operations columns H:M.';
}

function upsertReviewSummary(data) {
  const reviewCount = Number(data.review_count);
  const summarySheet = getReviewSummarySheet();
  setupReviewSummaryHeaders();

  // The Edge Function sends a non-zero aggregate only when its database RPC
  // confirms five distinct reviewers. Zero means suppress and clear the old row.
  if (!Number.isFinite(reviewCount) || reviewCount < 5) {
    const lastRow = summarySheet.getLastRow();
    if (lastRow > 1) summarySheet.getRange(2, 1, lastRow - 1, SUMMARY_COLUMN_COUNT).clearContent();
    return;
  }

  const averageRating = Number(data.average_rating);
  const tagCounts = [data.great_food, data.friendly_staff, data.nice_atmosphere, data.good_value]
    .map(value => Math.max(0, Math.floor(Number(value) || 0)));
  const row = [
    PARTNERSHIP_ID,
    Number.isFinite(averageRating) ? Math.max(0, Math.min(5, averageRating)) : 0,
    Math.floor(reviewCount),
    ...tagCounts,
    formatDate(new Date(data.updated_at || new Date())),
  ];
  summarySheet.getRange(2, 1, 1, SUMMARY_COLUMN_COUNT).setValues([row]);
}

function getReviewSummarySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  return sheet;
}

// Run once after updating this script. It moves rows from the old A:U layout into
// the screenshot's A:P layout and permanently clears the old exact-time fields.
function applyScreenshotColumnLayout() {
  const sheet = getOperationsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    setupPartnerSheetHeaders();
    return;
  }

  const existing = sheet.getRange(1, 1, lastRow, 21).getValues();
  const migrated = existing.slice(1).map(row => {
    const legacyLayout = Boolean(row[2] || row[17] || row[18] || row[19] || row[20]);

    if (legacyLayout) {
      return [
        row[0], row[2], '', row[4], row[5], row[6], '',
        row[9], row[10], row[11], row[12], row[13], row[14], '',
        row[17], row[19],
      ];
    }

    return [
      row[0], row[1], '', row[3], row[4], row[5], '',
      row[7], row[8], row[9], row[10], row[11], row[12], '',
      row[14], row[15],
    ];
  });

  sheet.getRange(1, 1, lastRow, 21).clearContent();
  setupPartnerSheetHeaders();
  if (migrated.length > 0) {
    sheet.getRange(2, 1, migrated.length, COLUMN_COUNT).setValues(migrated);
  }
}

// Run once as the sheet owner. Re-running replaces this script's existing
// retention trigger, so it will not create duplicate daily jobs.
function installPartnerRetentionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === RETENTION_TRIGGER_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(RETENTION_TRIGGER_HANDLER)
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone(RETENTION_TIME_ZONE)
    .create();

  return 'Daily 12-month retention cleanup installed for approximately 03:00 Europe/Amsterdam.';
}

// Deletes operation rows once their Scan Date is at least 12 calendar months
// old. Rows with a blank or unrecognised date are preserved for manual review.
function purgeExpiredPartnerRecords() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getOperationsSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { deleted_rows: 0, skipped_rows: 0 };

    const today = new Date();
    const localToday = parsePartnerTransactionDate(today);
    const firstDayOfCutoffMonth = new Date(
      localToday.getFullYear(),
      localToday.getMonth() - RETENTION_MONTHS,
      1,
    );
    const lastDayOfCutoffMonth = new Date(
      firstDayOfCutoffMonth.getFullYear(),
      firstDayOfCutoffMonth.getMonth() + 1,
      0,
    ).getDate();
    const cutoff = new Date(
      firstDayOfCutoffMonth.getFullYear(),
      firstDayOfCutoffMonth.getMonth(),
      Math.min(localToday.getDate(), lastDayOfCutoffMonth),
    );

    const rows = sheet.getRange(2, COL.date, lastRow - 1, COL.redemption_id - COL.date + 1).getValues();
    const expiredRows = [];
    let skippedRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rawDate = rows[i][0];
      const redemptionId = rows[i][COL.redemption_id - COL.date];
      if (rawDate === '' || rawDate === null) {
        if (redemptionId !== '' && redemptionId !== null) skippedRows++;
        continue;
      }

      const transactionDate = parsePartnerTransactionDate(rawDate);
      if (!transactionDate) {
        skippedRows++;
        continue;
      }

      transactionDate.setHours(0, 0, 0, 0);
      if (transactionDate <= cutoff) expiredRows.push(i + 2);
    }

    // Delete bottom-up in contiguous blocks so row indexes remain valid.
    let deletedRows = 0;
    let blockStart = null;
    let blockCount = 0;
    for (let i = expiredRows.length - 1; i >= 0; i--) {
      const row = expiredRows[i];
      if (blockStart === null) {
        blockStart = row;
        blockCount = 1;
      } else if (row === blockStart - 1) {
        blockStart = row;
        blockCount++;
      } else {
        sheet.deleteRows(blockStart, blockCount);
        deletedRows += blockCount;
        blockStart = row;
        blockCount = 1;
      }
    }
    if (blockStart !== null) {
      sheet.deleteRows(blockStart, blockCount);
      deletedRows += blockCount;
    }

    console.log(JSON.stringify({
      action: 'partner_retention_cleanup',
      deleted_rows: deletedRows,
      skipped_rows: skippedRows,
      cutoff_date: Utilities.formatDate(cutoff, RETENTION_TIME_ZONE, 'yyyy-MM-dd'),
    }));
    return { deleted_rows: deletedRows, skipped_rows: skippedRows };
  } finally {
    lock.releaseLock();
  }
}

function parsePartnerTransactionDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const localDate = Utilities.formatDate(value, RETENTION_TIME_ZONE, 'yyyy-MM-dd');
    const parts = localDate.split('-').map(Number);
    return makeValidatedLocalDate(parts[0], parts[1], parts[2]);
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return makeValidatedLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // ISO timestamps are converted to the transaction's Amsterdam calendar date.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) {
    const timestamp = new Date(text);
    if (isNaN(timestamp.getTime())) return null;
    const localDate = Utilities.formatDate(timestamp, RETENTION_TIME_ZONE, 'yyyy-MM-dd');
    const parts = localDate.split('-').map(Number);
    return makeValidatedLocalDate(parts[0], parts[1], parts[2]);
  }

  // The partner sheet displays dates as dd/MM/yyyy.
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return makeValidatedLocalDate(Number(match[3]), Number(match[2]), Number(match[1]));

  return null;
}

function makeValidatedLocalDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}
function validatePartnership(data) {
  const incoming = value(data.partnership_id) || value(data.restaurant_id) || value(data.store_id);
  if (!incoming) throw new Error('Missing partnership_id');
  if (String(incoming) !== String(PARTNERSHIP_ID)) {
    throw new Error('Wrong partnership_id for this owner sheet: ' + incoming);
  }
}

function buildScanRow(data, now) {
  const row = blankRow();

  row[COL.date - 1] = value(data.date) || formatDate(now);
  row[COL.redemption_id - 1] = value(data.redemption_id);
  row[COL.stamp_card_progress - 1] = value(data.stamp_card_progress) || value(data.stamp_progress);
  row[COL.stamp_card_status - 1] = value(data.stamp_card_status) || value(data.stamp_status);
  if (isClaimed(data.stamp_card_claimed_after_scan)) {
    row[COL.claimed_at_date - 1] = formatDate(now);
  }
  setAuditValues(row, now, now);

  return row;
}

function upsertScan(sheet, row) {
  const redemptionId = row[COL.redemption_id - 1];
  const existingRow = findRowByRedemptionId(sheet, redemptionId);
  const targetRow = existingRow === -1 ? Math.max(sheet.getLastRow() + 1, 2) : existingRow;

  if (existingRow !== -1) {
    const current = sheet.getRange(targetRow, 1, 1, COLUMN_COUNT).getValues()[0];
    row[COL.created_at_date - 1] = current[COL.created_at_date - 1];
    setUpdatedValues(row, new Date());
  }

  sheet.getRange(targetRow, 1, 1, COLUMN_COUNT).setValues([row]);
}

function updateStampClaim(sheet, data) {
  const now = new Date();
  let row = findRowByRedemptionId(sheet, data.redemption_id);

  if (row === -1) {
    const fallback = buildScanRow({
      type: 'store',
      partnership_id: PARTNERSHIP_ID,
      date: value(data.date) || formatDate(now),
      redemption_id: data.redemption_id,
      stamp_card_progress: value(data.stamp_card_progress) || value(data.stamp_progress),
      stamp_status: value(data.stamp_status) || 'claimed',
      stamp_card_claimed_after_scan: 'Yes',
    }, now);

    row = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(row, 1, 1, COLUMN_COUNT).setValues([fallback]);
    return;
  }

  if (value(data.stamp_card_progress) || value(data.stamp_progress)) {
    sheet.getRange(row, COL.stamp_card_progress).setValue(value(data.stamp_card_progress) || value(data.stamp_progress));
  }
  sheet.getRange(row, COL.stamp_card_status).setValue(value(data.stamp_status) || 'claimed');
  sheet.getRange(row, COL.claimed_at_date).setValue(value(data.claimed_at_date) || formatDate(now));
  setUpdatedRange(sheet, row, now);
}

function setAuditValues(rowValues, createdAt, updatedAt) {
  rowValues[COL.created_at_date - 1] = formatDate(createdAt);
  setUpdatedValues(rowValues, updatedAt);
}

function setUpdatedValues(rowValues, updatedAt) {
  rowValues[COL.updated_at_date - 1] = formatDate(updatedAt);
}

function setUpdatedRange(sheet, row, updatedAt) {
  sheet.getRange(row, COL.updated_at_date).setValue(formatDate(updatedAt));
}

function getOperationsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureMinimumHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  setupPartnerSheetHeaders();
}

function findRequiredRowByRedemptionId(sheet, redemptionId, label) {
  const row = findRowByRedemptionId(sheet, redemptionId);
  if (row === -1) throw new Error(label + ' row not found for redemption_id: ' + redemptionId);
  return row;
}

function findRowByRedemptionId(sheet, redemptionId) {
  if (!redemptionId) return -1;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const values = sheet.getRange(2, COL.redemption_id, lastRow - 1, 1).getValues();
  const target = String(redemptionId);

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === target) return i + 2;
  }

  return -1;
}

function blankRow() {
  return Array(COLUMN_COUNT).fill('');
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Europe/Amsterdam', 'dd/MM/yyyy');
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

