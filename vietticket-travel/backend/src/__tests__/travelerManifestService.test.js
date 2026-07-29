'use strict';

const {
  ageOnDate,
  normalizeTravelerManifest,
} = require('../services/travelerManifestService');

describe('traveler manifest policy', () => {
  test('tính tuổi đúng khi ngày tham quan ở trước sinh nhật trong năm', () => {
    expect(ageOnDate('2010-12-20', new Date('2026-06-10T00:00:00.000Z'))).toBe(15);
    expect(ageOnDate('2010-06-10', new Date('2026-06-10T00:00:00.000Z'))).toBe(16);
  });

  test('chuẩn hóa đúng số hành khách và lưu tuổi tại ngày sử dụng', () => {
    const result = normalizeTravelerManifest({
      confirmedAccurate: true,
      travelers: [
        { fullName: '  Nguyễn   Văn A ', dateOfBirth: '2000-01-02', heightCm: '170' },
      ],
    }, {
      participantCount: 1,
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
      restrictions: { minAgeYears: 18, minHeightCm: 120 },
    });

    expect(result).toEqual({
      version: 1,
      travelers: [{
        fullName: 'Nguyễn Văn A',
        dateOfBirth: '2000-01-02',
        ageAtVisit: 26,
        heightCm: 170,
      }],
      adultCompanion: null,
      confirmedAccurate: true,
    });
  });

  test('không cho lách điều kiện tuổi hoặc chiều cao', () => {
    expect(() => normalizeTravelerManifest({
      confirmedAccurate: true,
      travelers: [
        { fullName: 'Khách nhỏ', dateOfBirth: '2015-01-01', heightCm: 100 },
      ],
    }, {
      participantCount: 1,
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
      restrictions: { minAgeYears: 16, minHeightCm: 120 },
    })).toThrow(/chưa đủ 16 tuổi/u);
  });

  test('vé trẻ em cần người lớn cho phép khai báo companion không chiếm suất vé', () => {
    const result = normalizeTravelerManifest({
      confirmedAccurate: true,
      travelers: [
        { fullName: 'Bé An', dateOfBirth: '2018-01-01', heightCm: 120 },
      ],
      adultCompanion: {
        fullName: 'Nguyễn Văn Ba',
        dateOfBirth: '1985-01-01',
        companionBookingReference: 'vt-abc123',
      },
    }, {
      participantCount: 1,
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
      restrictions: {
        maxAgeYears: 15,
        requiresAdult: true,
      },
    });

    expect(result.adultCompanion).toEqual(expect.objectContaining({
      fullName: 'Nguyễn Văn Ba',
      ageAtVisit: 41,
      companionBookingReference: 'VT-ABC123',
    }));
  });

  test('từ chối thiếu consent hoặc sai số lượng hành khách', () => {
    expect(() => normalizeTravelerManifest({
      confirmedAccurate: false,
      travelers: [{ fullName: 'Khách A', dateOfBirth: '2000-01-01' }],
    }, {
      participantCount: 1,
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
    })).toThrow(/xác nhận thông tin/u);

    expect(() => normalizeTravelerManifest({
      confirmedAccurate: true,
      travelers: [{ fullName: 'Khách A', dateOfBirth: '2000-01-01' }],
    }, {
      participantCount: 2,
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
    })).toThrow(/đúng 2 hành khách/u);
  });
});
