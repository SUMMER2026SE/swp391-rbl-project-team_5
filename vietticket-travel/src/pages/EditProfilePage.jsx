import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import { defaultUser } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'
import {
  validateDateOfBirth,
  validateFullName,
  validateOptionalPhone,
} from '../utils/formValidators.js'

const today = new Date().toISOString().split('T')[0]

function getFormFromUser(user) {
  return {
    fullName: user.fullName || '',
    email: user.email || '',
    phone: user.phone || '',
    avatar: user.avatar || defaultUser.avatar,
    dateOfBirth: user.dateOfBirth || '',
    gender: user.gender || '',
    address: user.address || '',
  }
}

function EditProfilePage() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const { user, updateProfile, uploadAvatar } = useAuth()
  const currentUser = user || defaultUser
  const [touched, setTouched] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [form, setForm] = useState(() => getFormFromUser(currentUser))

  const errors = useMemo(
    () => ({
      fullName: validateFullName(form.fullName),
      phone: validateOptionalPhone(form.phone),
      dateOfBirth: validateDateOfBirth(form.dateOfBirth),
    }),
    [form.dateOfBirth, form.fullName, form.phone],
  )
  const isFormValid = Object.values(errors).every((error) => !error)

  useEffect(() => {
    document.title = 'Chỉnh sửa hồ sơ | VietTicket Travel'
  }, [])

  const updateField = (field, value) => {
    setTouched((current) => ({ ...current, [field]: true }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const markTouched = (field) => {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('Chỉ hỗ trợ ảnh JPEG hoặc PNG.')
      event.target.value = ''
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Ảnh đại diện không được vượt quá 2MB.')
      event.target.value = ''
      return
    }

    setIsUploading(true)
    const result = await uploadAvatar(file)
    setIsUploading(false)
    event.target.value = ''

    if (!result.ok) {
      toast.error(result.message || 'Không thể tải ảnh đại diện.')
      return
    }

    updateField('avatar', result.avatarUrl)
    toast.success(result.message || 'Tải ảnh đại diện thành công.')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({ dateOfBirth: true, fullName: true, phone: true })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại thông tin hồ sơ.')
      return
    }

    setIsSubmitting(true)
    const result = await updateProfile(form)
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể cập nhật hồ sơ.')
      return
    }

    toast.success(result.message || 'Cập nhật hồ sơ thành công.')
    navigate('/profile')
  }

  return (
    <AccountLayout active="profile">
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <p className="auth-helper">Hồ sơ của tôi / Chỉnh sửa hồ sơ</p>
            <h1>Chỉnh sửa hồ sơ</h1>
            <p>Cập nhật thông tin du khách cho các lượt đặt vé sau này.</p>
          </div>
        </div>

        <form className="auth-form auth-form--relaxed" onSubmit={handleSubmit}>
          <div className="avatar-edit">
            <img src={form.avatar} alt="Xem trước ảnh đại diện hiện tại" />
            <div>
              <h2>Xem trước ảnh đại diện</h2>
              <p className="auth-helper">
                Ảnh JPEG hoặc PNG, tối đa 2MB. Ảnh được upload lên server và lưu bằng URL.
              </p>
              <button
                className="auth-secondary-button"
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? 'Đang tải ảnh...' : 'Đổi ảnh đại diện'}
              </button>
              <input
                accept="image/jpeg,image/png"
                hidden
                ref={fileInputRef}
                type="file"
                onChange={handleAvatarChange}
              />
            </div>
          </div>

          <div className="profile-form-grid">
            <AuthFormInput
              id="edit-full-name"
              label="Họ và tên"
              icon="person"
              type="text"
              placeholder="Nhập họ và tên"
              value={form.fullName}
              error={touched.fullName ? errors.fullName : ''}
              onBlur={() => markTouched('fullName')}
              onChange={(event) => updateField('fullName', event.target.value)}
              required
            />
            <AuthFormInput
              id="edit-phone"
              label="Số điện thoại"
              icon="phone"
              type="tel"
              placeholder="0901234567"
              value={form.phone}
              error={touched.phone ? errors.phone : ''}
              onBlur={() => markTouched('phone')}
              onChange={(event) => updateField('phone', event.target.value)}
            />
          </div>

          <div className="profile-form-grid">
            <AuthFormInput
              id="edit-date-of-birth"
              label="Ngày sinh"
              icon="cake"
              max={today}
              type="date"
              value={form.dateOfBirth}
              error={touched.dateOfBirth ? errors.dateOfBirth : ''}
              onBlur={() => markTouched('dateOfBirth')}
              onChange={(event) => updateField('dateOfBirth', event.target.value)}
            />
            <div className="auth-field">
              <label htmlFor="edit-gender">Giới tính</label>
              <div className="auth-input">
                <span className="material-symbols-outlined" aria-hidden="true">
                  wc
                </span>
                <select
                  id="edit-gender"
                  value={form.gender}
                  onChange={(event) => updateField('gender', event.target.value)}
                >
                  <option value="">Chưa chọn</option>
                  <option value="nam">Nam</option>
                  <option value="nữ">Nữ</option>
                  <option value="khác">Khác</option>
                </select>
              </div>
            </div>
          </div>

          <AuthFormInput
            id="edit-address"
            label="Địa chỉ"
            icon="location_on"
            type="text"
            placeholder="Đà Nẵng, Việt Nam"
            value={form.address}
            onChange={(event) => updateField('address', event.target.value)}
          />

          <AuthFormInput
            id="edit-email"
            label="Địa chỉ email"
            icon="verified"
            type="email"
            value={form.email}
            readOnly
          />

          <div className="auth-actions-row">
            <button className="auth-submit" type="submit" disabled={isSubmitting || isUploading}>
              {isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
            <Link className="auth-secondary-button" to="/profile">
              Hủy
            </Link>
          </div>
        </form>
      </section>
    </AccountLayout>
  )
}

export default EditProfilePage
