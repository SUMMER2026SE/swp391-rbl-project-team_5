import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'react-toastify'
import bookingService from '../../services/bookingService.js'

const formatMoney = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const POLICY_LABEL = {
  FREE_CANCELLATION: 'Hủy miễn phí — hoàn 100%',
  REFUND_WITH_FEE: 'Hủy toàn bộ booking — hoàn sau khi trừ phí',
  NON_REFUNDABLE: 'Không hoàn tiền',
}

function RefundModal({ booking, onClose, onSuccess }) {
  const [preview, setPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    let active = true
    bookingService
      .getRefundPreview(booking.id)
      .then((data) => {
        if (active) setPreview(data)
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [booking.id])

  async function handleSubmit() {
    const trimmed = reason.trim()
    if (trimmed.length < 5) {
      toast.warning('Vui lòng nhập lý do hoàn tiền (tối thiểu 5 ký tự).')
      return
    }
    if (!acknowledged) {
      toast.warning('Vui lòng xác nhận việc hủy toàn bộ booking và vô hiệu hóa mã QR.')
      return
    }

    setIsSubmitting(true)
    try {
      await bookingService.createRefundRequest(booking.id, trimmed)
      toast.success('Booking đã được hủy. Khoản hoàn đang được xử lý.')
      onSuccess?.()
      onClose()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const feeRate = preview ? Math.round(Number(preview.refundFeeRate) * 100) : 0

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-modal-title"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 id="refund-modal-title" className="text-xl font-semibold text-on-surface">
              Hủy booking & hoàn tiền
            </h3>
            <p className="mt-1 text-sm text-on-surface-variant">
              {booking.attractionTitle}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border-0 bg-transparent p-1 hover:bg-surface-container-high"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Đóng"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {isLoading ? (
          <p className="py-10 text-center font-semibold text-primary">Đang tính toán...</p>
        ) : errorMessage ? (
          <p className="rounded-xl bg-red-50 p-4 text-center font-semibold text-error">
            {errorMessage}
          </p>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-950">
              Thao tác này hủy ngay toàn bộ booking và vô hiệu hóa toàn bộ {preview.bookingQuantity || booking.quantity || 1} mã QR.
              Không hỗ trợ hủy bớt số vé hoặc đổi ngày/khung giờ. “Hoàn sau khi trừ phí”
              chỉ nói về số tiền nhận lại, không phải số lượng vé bị hủy.
            </div>
            <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">Giá trị đơn gốc</span>
                <span className="text-sm font-semibold text-on-surface">
                  {formatMoney(preview.totalAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">Chính sách</span>
                <span className="text-sm text-on-surface">
                  {POLICY_LABEL[preview.refundPolicy] || preview.refundPolicy}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">
                  Phí hủy{feeRate ? ` (${feeRate}%)` : ''}
                </span>
                <span className="text-sm text-error">- {formatMoney(preview.feeAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-outline-variant pt-3">
                <span className="text-sm font-bold text-on-surface">Số tiền thực nhận</span>
                <span className="text-lg font-bold text-primary">
                  {formatMoney(preview.refundAmount)}
                </span>
              </div>
            </div>

            {preview.refundable && preview.refundDeadline && (
              <div className="mt-4 flex gap-3 rounded-xl border border-error/20 bg-red-50 p-3 text-xs text-error">
                <span className="material-symbols-outlined shrink-0 text-[18px] text-error" style={{ fontVariationSettings: "'FILL' 1" }}>
                  warning
                </span>
                <div>
                  <strong className="block mb-0.5">Thời hạn gửi yêu cầu:</strong>
                  Trước{' '}
                  <strong>
                    {new Intl.DateTimeFormat('vi-VN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: 'Asia/Ho_Chi_Minh',
                    }).format(new Date(preview.refundDeadline))}
                  </strong>{' '}
                  ({preview.refundCutoffHours} giờ trước khi hoạt động bắt đầu).
                </div>
              </div>
            )}

            {preview.refundable && (
              <>
                <label
                  className="mb-2 mt-5 block text-sm font-semibold text-on-surface"
                  htmlFor="refund-reason"
                >
                  Lý do hoàn tiền <span className="text-error">*</span>
                </label>
                <textarea
                  id="refund-reason"
                  className="min-h-28 w-full resize-y rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="Vui lòng cho biết lý do bạn muốn hoàn vé..."
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  autoFocus
                />
                <p className="mt-1 text-right text-xs text-on-surface-variant">
                  {reason.length}/1000
                </p>
                <label className="mt-4 flex items-start gap-3 rounded-xl border border-error/30 bg-red-50 p-3 text-sm font-semibold leading-5 text-error">
                  <input
                    checked={acknowledged}
                    className="mt-0.5 h-4 w-4 accent-red-700"
                    disabled={isSubmitting}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Tôi hiểu booking và toàn bộ mã QR sẽ mất hiệu lực ngay; thao tác hủy
                    không thể hoàn tác dù tiền hoàn có thể cần thời gian đối soát.
                  </span>
                </label>
              </>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {preview.refundable ? 'Hủy' : 'Đóng'}
              </button>
              {preview.refundable && (
                <button
                  type="button"
                  className="rounded-lg border-0 bg-error px-4 py-2 text-sm font-semibold text-on-error disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting || !acknowledged}
                >
                  {isSubmitting ? 'Đang hủy...' : 'Xác nhận hủy booking'}
                </button>
              )}
            </div>
            {!preview.refundable && (
              <p className="mt-3 rounded-xl bg-surface-container-low p-3 text-center text-xs font-semibold text-on-surface-variant">
                {preview.notRefundableReason ||
                  (preview.hasRefundRequest
                    ? 'Đơn này đã có yêu cầu hoàn tiền.'
                    : 'Đơn này hiện không đủ điều kiện hoàn tiền.')}
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default RefundModal
