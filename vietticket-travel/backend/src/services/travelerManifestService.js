'use strict';

const MAX_TRAVELER_NAME_LENGTH = 100;
const MAX_TRAVELER_AGE_YEARS = 120;
const MIN_HEIGHT_CM = 30;
const MAX_HEIGHT_CM = 250;

function manifestError(message, field = null) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'TRAVELER_MANIFEST_INVALID';
  error.field = field;
  return error;
}

function normalizeName(value, field) {
  const name = String(value || '').trim().replace(/\s+/gu, ' ');
  if (name.length < 2 || name.length > MAX_TRAVELER_NAME_LENGTH) {
    throw manifestError(
      `Họ tên hành khách phải có từ 2 đến ${MAX_TRAVELER_NAME_LENGTH} ký tự.`,
      field,
    );
  }
  return name;
}

function parseDateOnly(value, field) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw manifestError('Ngày sinh phải có định dạng YYYY-MM-DD.', field);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw manifestError('Ngày sinh không hợp lệ.', field);
  }
  return { text, date };
}

function ageOnDate(dateOfBirth, visitDate) {
  const birth = dateOfBirth instanceof Date
    ? dateOfBirth
    : parseDateOnly(dateOfBirth, 'dateOfBirth').date;
  const visit = visitDate instanceof Date
    ? visitDate
    : new Date(`${String(visitDate).slice(0, 10)}T00:00:00.000Z`);
  let age = visit.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = visit.getUTCMonth() < birth.getUTCMonth()
    || (
      visit.getUTCMonth() === birth.getUTCMonth()
      && visit.getUTCDate() < birth.getUTCDate()
    );
  if (beforeBirthday) age -= 1;
  return age;
}

function normalizeHeight(value, { required, field }) {
  if (value == null || value === '') {
    if (required) {
      throw manifestError('Chiều cao là bắt buộc với loại vé này.', field);
    }
    return null;
  }
  const height = Number(value);
  if (
    !Number.isSafeInteger(height)
    || height < MIN_HEIGHT_CM
    || height > MAX_HEIGHT_CM
  ) {
    throw manifestError(
      `Chiều cao phải là số nguyên từ ${MIN_HEIGHT_CM} đến ${MAX_HEIGHT_CM} cm.`,
      field,
    );
  }
  return height;
}

function normalizePerson(person, {
  fieldPrefix,
  visitDate,
  restrictions = {},
  enforceTicketRestrictions = true,
}) {
  const fullName = normalizeName(person?.fullName, `${fieldPrefix}.fullName`);
  const birth = parseDateOnly(person?.dateOfBirth, `${fieldPrefix}.dateOfBirth`);
  const ageAtVisit = ageOnDate(birth.date, visitDate);
  if (ageAtVisit < 0 || ageAtVisit > MAX_TRAVELER_AGE_YEARS) {
    throw manifestError(
      `Tuổi hành khách tại ngày tham quan phải từ 0 đến ${MAX_TRAVELER_AGE_YEARS}.`,
      `${fieldPrefix}.dateOfBirth`,
    );
  }

  const hasHeightRestriction = restrictions.minHeightCm != null
    || restrictions.maxHeightCm != null;
  const heightCm = normalizeHeight(person?.heightCm, {
    required: enforceTicketRestrictions && hasHeightRestriction,
    field: `${fieldPrefix}.heightCm`,
  });

  if (enforceTicketRestrictions) {
    if (restrictions.minAgeYears != null && ageAtVisit < restrictions.minAgeYears) {
      throw manifestError(
        `${fullName} chưa đủ ${restrictions.minAgeYears} tuổi vào ngày tham quan.`,
        `${fieldPrefix}.dateOfBirth`,
      );
    }
    if (restrictions.maxAgeYears != null && ageAtVisit > restrictions.maxAgeYears) {
      throw manifestError(
        `${fullName} vượt quá độ tuổi tối đa ${restrictions.maxAgeYears} của loại vé.`,
        `${fieldPrefix}.dateOfBirth`,
      );
    }
    if (restrictions.minHeightCm != null && heightCm < restrictions.minHeightCm) {
      throw manifestError(
        `${fullName} chưa đạt chiều cao tối thiểu ${restrictions.minHeightCm} cm.`,
        `${fieldPrefix}.heightCm`,
      );
    }
    if (restrictions.maxHeightCm != null && heightCm > restrictions.maxHeightCm) {
      throw manifestError(
        `${fullName} vượt quá chiều cao tối đa ${restrictions.maxHeightCm} cm.`,
        `${fieldPrefix}.heightCm`,
      );
    }
  }

  return {
    fullName,
    dateOfBirth: birth.text,
    ageAtVisit,
    heightCm,
  };
}

function normalizeTravelerManifest(input, {
  participantCount,
  restrictions = {},
  visitDate,
}) {
  const expectedCount = Number(participantCount);
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 100) {
    throw manifestError('Số hành khách của booking không hợp lệ.');
  }
  if (!input || !Array.isArray(input.travelers)) {
    throw manifestError('Vui lòng khai báo thông tin hành khách trước khi đặt vé.', 'travelers');
  }
  if (input.confirmedAccurate !== true) {
    throw manifestError(
      'Bạn cần xác nhận thông tin hành khách là chính xác và đồng ý cung cấp dữ liệu này cho nhà cung cấp để phục vụ chuyến đi.',
      'confirmedAccurate',
    );
  }
  if (input.travelers.length !== expectedCount) {
    throw manifestError(
      `Cần khai báo đúng ${expectedCount} hành khách theo sức chứa của vé.`,
      'travelers',
    );
  }

  const travelers = input.travelers.map((traveler, index) => normalizePerson(traveler, {
    fieldPrefix: `travelers.${index}`,
    visitDate,
    restrictions,
  }));
  const admittedAdult = travelers.some((traveler) => traveler.ageAtVisit >= 18);

  let adultCompanion = null;
  if (restrictions.requiresAdult === true && !admittedAdult) {
    adultCompanion = normalizePerson(input.adultCompanion, {
      fieldPrefix: 'adultCompanion',
      visitDate,
      restrictions: {},
      enforceTicketRestrictions: false,
    });
    if (adultCompanion.ageAtVisit < 18) {
      throw manifestError(
        'Người đi cùng phải đủ 18 tuổi vào ngày tham quan.',
        'adultCompanion.dateOfBirth',
      );
    }
    const companionBookingReference = String(
      input.adultCompanion?.companionBookingReference || '',
    ).trim().toUpperCase();
    adultCompanion.companionBookingReference = companionBookingReference || null;
  }

  return {
    version: 1,
    travelers,
    adultCompanion,
    confirmedAccurate: true,
  };
}

module.exports = {
  ageOnDate,
  normalizeTravelerManifest,
};
