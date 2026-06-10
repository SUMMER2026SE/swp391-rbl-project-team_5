import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import bookingService from '../../services/bookingService.js'

const formatMoney = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const POLICY_LABEL = {
  FREE_CANCELLATION: 'Hủy miễn phí — hoàn 100%',
  REFUND_WITH_FEE: 'Hủy mất phí',
  NON_REFUNDABLE: 'Không hoàn tiền',
}

function RefundModal({ booking, onClose, onSuccess }) {
  const [preview, setPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

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

    setIsSubmitting(true)
    try {
      await bookingService.createRefundRequest(booking.id, trimmed)
      toast.success('Đã gửi yêu cầu hoàn tiền. Nhân viên sẽ xử lý sớm.')
      onSuccess?.()
      onClose()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const feeRate = preview ? Math.round(Number(preview.refundFeeRate) * 100) : 0

  return (
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
              Yêu cầu hoàn tiền
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
              autoFocus
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="rounded-lg border-0 bg-error px-4 py-2 text-sm font-semibold text-on-error disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || !preview.refundable}
              >
                {isSubmitting ? 'Đang gửi...' : 'Xác nhận gửi yêu cầu'}
              </button>
            </div>
            {!preview.refundable && (
              <p className="mt-3 text-center text-xs text-on-surface-variant">
                {preview.hasRefundRequest
                  ? 'Đơn này đã có yêu cầu hoàn tiền.'
                  : 'Đơn này hiện không đủ điều kiện hoàn tiền.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default RefundModal
