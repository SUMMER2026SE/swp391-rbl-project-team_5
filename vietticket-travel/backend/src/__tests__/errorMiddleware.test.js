const { errorHandler } = require('../middleware/errorMiddleware');

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('errorHandler', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('does not expose internal server errors to the client', () => {
    const res = makeRes();
    const error = new Error('Invalid `prisma.user.findMany()` invocation');

    errorHandler(error, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Máy chủ đang gặp lỗi. Vui lòng thử lại sau.',
    });
    expect(consoleError).toHaveBeenCalledWith('[error]', error);
  });

  test('keeps explicit client-facing errors', () => {
    const res = makeRes();
    const error = new Error('Du lieu khong hop le.');
    error.statusCode = 400;

    errorHandler(error, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Du lieu khong hop le.' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
