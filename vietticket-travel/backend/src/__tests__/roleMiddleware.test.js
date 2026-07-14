'use strict';

const { isPlatformStaff, restrictTo } = require('../middleware/roleMiddleware');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('roleMiddleware', () => {
  test('authorizes a secondary customer role for a partner account', () => {
    const middleware = restrictTo('CUSTOMER');
    const req = {
      user: {
        role: 'PARTNER',
        roleMemberships: [{ role: 'PARTNER' }, { role: 'CUSTOMER' }],
      },
    };
    const res = createResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a user without any accepted role', () => {
    const middleware = restrictTo('ADMIN');
    const req = { user: { role: 'CUSTOMER', roleMemberships: [{ role: 'CUSTOMER' }] } };
    const res = createResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('distinguishes platform staff from partner check-in staff', () => {
    expect(isPlatformStaff({ role: 'STAFF', employerPartnerId: null })).toBe(true);
    expect(isPlatformStaff({ role: 'STAFF', employerPartnerId: 'partner-1' })).toBe(false);
    expect(isPlatformStaff({ role: 'ADMIN' })).toBe(true);
  });
});
