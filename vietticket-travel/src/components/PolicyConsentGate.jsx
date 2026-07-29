import { useState } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'

export default function PolicyConsentGate({ children }) {
  const location = useLocation()
  const {
    acceptCurrentPolicies,
    isAuthenticated,
    isAuthLoading,
    logout,
    user,
  } = useAuth()
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const requiresAcceptance = (
    !isAuthLoading
    && isAuthenticated
    && user?.requiresPolicyAcceptance === true
    && !['/terms', '/privacy'].includes(location.pathname)
  )

  async function handleAccept() {
    if (!acceptedTerms || !acceptedPrivacy || submitting) return
    setSubmitting(true)
    const result = await acceptCurrentPolicies()
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message || 'Không thể ghi nhận đồng ý chính sách.')
      return
    }
    toast.success(result.message)
  }

  return (
    <>
      {children}
      {requiresAcceptance && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="policy-consent-title"
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="material-symbols-outlined" aria-hidden="true">policy</span>
            </div>
            <h2 id="policy-consent-title" className="text-2xl font-bold text-on-surface">
              Chính sách VietTicket đã được cập nhật
            </h2>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">
              Vui lòng đọc và đồng ý từng tài liệu trước khi tiếp tục đặt vé, thanh toán,
              đánh giá hoặc thực hiện nghiệp vụ trên nền tảng. Hệ thống lưu phiên bản,
              thời điểm và địa chỉ mạng của lần đồng ý này để đối soát.
            </p>

            <div className="mt-5 space-y-3">
              <label className="flex items-start gap-3 rounded-xl border border-outline-variant p-4">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => setAcceptedTerms(event.target.checked)}
                  disabled={submitting}
                  className="mt-1"
                />
                <span className="text-sm text-on-surface">
                  Tôi đã đọc và đồng ý với{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-primary underline"
                  >
                    Điều khoản dịch vụ
                  </a>{' '}
                  phiên bản {user.currentTermsVersion}.
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-outline-variant p-4">
                <input
                  type="checkbox"
                  checked={acceptedPrivacy}
                  onChange={(event) => setAcceptedPrivacy(event.target.checked)}
                  disabled={submitting}
                  className="mt-1"
                />
                <span className="text-sm text-on-surface">
                  Tôi đã đọc và đồng ý với{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-primary underline"
                  >
                    Chính sách bảo mật
                  </a>{' '}
                  phiên bản {user.currentPrivacyVersion}.
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => void logout()}
                disabled={submitting}
                className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface"
              >
                Đăng xuất
              </button>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={!acceptedTerms || !acceptedPrivacy || submitting}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Đang ghi nhận…' : 'Đồng ý và tiếp tục'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
