export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const vietnamPhoneRegex = /^(0|\+84)[35789][0-9]{8}$/

export function validateEmail(email) {
  if (!email.trim()) return 'Vui lòng nhập email.'
  if (!emailRegex.test(email.trim())) return 'Email không hợp lệ.'
  return ''
}

export function validatePhone(phone) {
  if (!phone.trim()) return 'Vui lòng nhập số điện thoại.'
  const cleanPhone = phone.replace(/[\s.-]+/g, '')
  if (!vietnamPhoneRegex.test(cleanPhone)) return 'Số điện thoại Việt Nam không hợp lệ.'
  return ''
}

export function validateOptionalPhone(phone) {
  if (!phone.trim()) return ''
  const cleanPhone = phone.replace(/[\s.-]+/g, '')
  if (!vietnamPhoneRegex.test(cleanPhone)) return 'Số điện thoại Việt Nam không hợp lệ.'
  return ''
}

export function validatePassword(password) {
  if (!password) return 'Vui lòng nhập mật khẩu.'
  if (password.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Mật khẩu cần có ít nhất 1 chữ cái và 1 chữ số.'
  }
  return ''
}

export function getPasswordStrength(password) {
  let score = 0

  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if (!password) return { score: 0, label: 'Chưa nhập', className: 'empty' }
  if (score <= 2) return { score, label: 'Yếu', className: 'weak' }
  if (score <= 4) return { score, label: 'Trung bình', className: 'medium' }
  return { score, label: 'Mạnh', className: 'strong' }
}

export function validateFullName(fullName) {
  const value = fullName.trim().replace(/\s+/g, ' ')
  if (!value) return 'Vui lòng nhập họ tên.'
  if (value.length < 2 || value.length > 50) return 'Họ tên phải từ 2 đến 50 ký tự.'
  if (!/^[\p{L}\s]+$/u.test(value)) return 'Họ tên chỉ được chứa chữ cái và khoảng trắng.'
  return ''
}

export function validateDateOfBirth(value) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  if (Number.isNaN(date.getTime()) || date >= today) return 'Ngày sinh phải là ngày trong quá khứ.'
  const twelfthBirthday = new Date(date)
  twelfthBirthday.setFullYear(twelfthBirthday.getFullYear() + 12)
  if (twelfthBirthday > today) return 'Người dùng phải từ 12 tuổi trở lên.'
  return ''
}
