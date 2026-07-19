'use strict';

const fs = require('fs');
const {
  getDocumentFilenameFromUrl,
  isDocumentOwnedByUser,
} = require('../middleware/uploadMiddleware');

const ORIGINAL_BACKEND_URL = process.env.BACKEND_URL;

beforeEach(() => {
  process.env.BACKEND_URL = 'https://api.vietticket.test';
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_BACKEND_URL === undefined) {
    delete process.env.BACKEND_URL;
  } else {
    process.env.BACKEND_URL = ORIGINAL_BACKEND_URL;
  }
});

describe('private KYC document ownership', () => {
  test('accepts only an existing file from the configured backend origin and owner prefix', () => {
    jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true });
    const url = 'https://api.vietticket.test/api/upload/documents/user-1-kyc.pdf';

    expect(isDocumentOwnedByUser(url, 'user-1')).toBe(true);
    expect(fs.statSync).toHaveBeenCalledTimes(1);
  });

  test.each([
    'https://evil.example/api/upload/documents/user-1-kyc.pdf',
    'https://api.vietticket.test/api/upload/documents/user-2-kyc.pdf',
    'https://api.vietticket.test/api/upload/documents/user-1-kyc.pdf?download=1',
    'https://api.vietticket.test/api/upload/documents/nested/user-1-kyc.pdf',
  ])('rejects untrusted, foreign, or non-canonical document URL: %s', (url) => {
    jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true });

    expect(isDocumentOwnedByUser(url, 'user-1')).toBe(false);
  });

  test('rejects a canonical-looking URL when no file exists', () => {
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    expect(isDocumentOwnedByUser(
      'https://api.vietticket.test/api/upload/documents/user-1-missing.pdf',
      'user-1',
    )).toBe(false);
  });

  test('extracts only a single canonical document filename', () => {
    expect(getDocumentFilenameFromUrl(
      'https://api.vietticket.test/api/upload/documents/user-1-kyc.pdf',
    )).toBe('user-1-kyc.pdf');
    expect(getDocumentFilenameFromUrl(
      'https://api.vietticket.test/api/upload/documents/user-1-kyc.pdf#fragment',
    )).toBe('');
  });
});
