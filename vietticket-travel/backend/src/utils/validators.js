const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const vietnamPhoneRegex = /^(0|\+84)[35789][0-9]{8}$/;
const fullNameRegex = /^[\p{L}\s]+$/u;

function isValidEmail(email) {
  return emailRegex.test(String(email || '').trim());
}

function validateFullName(fullName) {
  const value = String(fullName || '').trim().replace(/\s+/g, ' ');

  if (!value) {
    return 'Họ tên không được để trống.';
  }

  if (value.length < 2 || value.length > 50) {
    return 'Họ tên phải từ 2 đến 50 ký tự.';
  }

  if (!fullNameRegex.test(value)) {
    return 'Họ tên chỉ được chứa chữ cái và khoảng trắng.';
  }

  return '';
}

function validatePassword(password) {
  const value = String(password || '');

  if (value.length < 8) {
    return 'Mật khẩu cần có ít nhất 8 ký tự.';
  }

  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Mật khẩu cần bao gồm cả chữ cái và số.';
  }

  return '';
}

function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber) return true;
  return vietnamPhoneRegex.test(String(phoneNumber).trim());
}

function isValidAvatarUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidGender(value) {
  if (!value) return true;
  return ['male', 'female', 'other', 'nam', 'nữ', 'nu', 'khác', 'khac'].includes(
    String(value).toLowerCase(),
  );
}

function validateDateOfBirth(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Ngày sinh không hợp lệ.';
  }

  const today = new Date();

  if (date >= today) {
    return 'Ngày sinh phải là ngày trong quá khứ.';
  }

  const twelfthBirthday = new Date(date);
  twelfthBirthday.setFullYear(twelfthBirthday.getFullYear() + 12);

  if (twelfthBirthday > today) {
    return 'Người dùng phải từ 12 tuổi trở lên.';
  }

  return '';
}

module.exports = {
  isValidAvatarUrl,
  isValidEmail,
  isValidGender,
  isValidPhoneNumber,
  validateDateOfBirth,
  validateFullName,
  validatePassword,
};
