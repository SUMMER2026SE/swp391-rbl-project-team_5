import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import {
  confirmBankTransfer,
  listBankTransferQueue,
} from '../../services/paymentApi.js'

// Đối chiếu sao kê: cổng chuyển khoản không có callback tự động, nên Admin
// kiểm tra tiền về trong app ngân hàng rồi xác nhận để hệ thống phát vé.

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN')
}

const toLocalDateTimeInput = (value = new Date()) => {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const emptyEvidence = () => ({
  externalReference: '',
  receivedAmount: '',
  receivedAt: toLocalDateTimeInput(),
  payerName: '',
})

export default function BankTransferManagementPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmingId, setConfirmingId] = useState('')
  const [target, setTarget] = useState(null)
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState(emptyEvidence)

  useEffect(() => {
    document.title = 'Đối chiếu chuyển khoản | VietTicket Admin'
  }, [])

  const load = useCallback(async () => {
    try {
      const response = await listBankTransferQueue()
      setItems(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      toast.error(error.message || 'Không tải được danh sách chuyển khoản.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function handleConfirm() {
    if (!target) return
    const isCheckerStep = target.reconciliation?.status === 'MATCHED'
    if (!isCheckerStep) {
      if (!evidence.externalReference.trim()) {
        toast.error('Vui lòng nhập mã giao dịch trên sao kê.')
        return
      }
      if (!evidence.receivedAmount || Number(evidence.receivedAmount) <= 0) {
        toast.error('Vui lòng nhập số tiền thực nhận hợp lệ.')
        return
      }
      if (!evidence.receivedAt) {
        toast.error('Vui lòng nhập thời điểm tiền vào tài khoản.')
        return
      }
    }
    setConfirmingId(target.bookingId)
    try {
      const payload = isCheckerStep
        ? { note: note.trim() || undefined }
        : {
            externalReference: evidence.externalReference.trim(),
            receivedAmount: Number(evidence.receivedAmount),
            receivedAt: new Date(evidence.receivedAt).toISOString(),
            payerName: evidence.payerName.trim() || undefined,
            note: note.trim() || undefined,
          }
      const response = await confirmBankTransfer(target.bookingId, payload)
      toast.success(
        response.message
          || (response.data?.awaitingSecondApproval
            ? 'Đã lưu bằng chứng, đang chờ người duyệt độc lập.'
            : 'Đã xác nhận thanh toán.'),
      )
      setTarget(null)
      setNote('')
      setEvidence(emptyEvidence())
      await load()
    } catch (error) {
      toast.error(error.message || 'Không xác nhận được thanh toán.')
    } finally {
      setConfirmingId('')
    }
  }

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm...">
      <div className="mx-auto max-w-6xl p-4 sm:p-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 text-2xl font-bold text-on-surface sm:text-3xl">
              Đối chiếu chuyển khoản
            </h2>
            <p className="max-w-3xl text-sm text-on-surface-variant">
              Mỗi giao dịch cần hai quản trị viên độc lập: người thứ nhất nhập bằng chứng sao kê,
              người thứ hai kiểm tra lại rồi mới phát vé. Giao dịch đến sau hạn vẫn phải được ghi
              nhận để tạo yêu cầu hoàn tiền, không được phát vé.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
            Làm mới
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold text-on-surface-variant">
                  <th className="px-5 py-3">Nội dung CK</th>
                  <th className="px-5 py-3">Khách hàng</th>
                  <th className="px-5 py-3">Địa điểm / Vé</th>
                  <th className="px-5 py-3">Số tiền</th>
                  <th className="px-5 py-3">Hạn giữ chỗ</th>
                  <th className="px-5 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-on-surface-variant">
                      Đang tải…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-on-surface-variant">
                      Không có đơn chuyển khoản nào đang chờ đối chiếu.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.bookingId}
                      className={`border-b border-outline-variant/40 ${
                        item.holdExpired ? 'bg-error-container/10' : 'hover:bg-surface'
                      }`}
                    >
                      <td className="px-5 py-3">
                        <p className="font-mono text-sm font-bold text-primary">
                          {item.transferContent}
                        </p>
                        <p className="mt-0.5 text-xs text-on-surface-variant">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-on-surface">{item.customer}</p>
                        <p className="text-xs text-on-surface-variant">{item.phone || item.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-on-surface">{item.attraction}</p>
                        <p className="text-xs text-on-surface-variant">
                          {item.ticketName} · {item.quantity} vé
                        </p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap font-bold text-on-surface">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-xs">
                        <span className={item.holdExpired ? 'font-bold text-error' : 'text-on-surface-variant'}>
                          {item.holdExpired ? 'Đã hết hạn' : formatDateTime(item.holdExpiresAt)}
                        </span>
                        {item.reconciliation?.status === 'MATCHED' && (
                          <span className="mt-1 block font-semibold text-amber-700">
                            Đã khớp · chờ người duyệt
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          disabled={Boolean(confirmingId)}
                          onClick={() => {
                            setTarget(item)
                            setNote(item.reconciliation?.evidenceNote || '')
                            setEvidence(emptyEvidence())
                          }}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                            price_check
                          </span>
                          {item.reconciliation?.status === 'MATCHED'
                            ? 'Kiểm tra & duyệt'
                            : item.holdExpired
                              ? 'Ghi nhận tiền đến muộn'
                              : 'Khớp sao kê'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {target && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={confirmingId ? undefined : () => setTarget(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-bank-title"
              className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="confirm-bank-title" className="text-xl font-bold text-on-surface">
                {target.reconciliation?.status === 'MATCHED'
                  ? 'Duyệt độc lập giao dịch'
                  : 'Ghi nhận bằng chứng sao kê'}
              </h3>
              <p className="mt-2 text-sm text-on-surface-variant">
                Booking yêu cầu
                <strong className="text-on-surface"> {formatCurrency(target.amount)}</strong> với nội dung
                <strong className="font-mono text-primary"> {target.transferContent}</strong>.
                {target.holdExpired && (
                  <span className="mt-2 block font-semibold text-error">
                    Đơn đã hết hạn giữ chỗ. Sau bước duyệt, hệ thống chỉ ghi nhận tiền và tạo yêu
                    cầu hoàn 100%, tuyệt đối không phát vé.
                  </span>
                )}
              </p>

              {target.reconciliation?.status === 'MATCHED' ? (
                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-container-low p-4 text-sm">
                  <div>
                    <dt className="text-on-surface-variant">Mã giao dịch</dt>
                    <dd className="break-all font-mono font-bold text-on-surface">
                      {target.reconciliation.externalReference}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant">Số tiền thực nhận</dt>
                    <dd className="font-bold text-on-surface">
                      {formatCurrency(target.reconciliation.receivedAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant">Thời điểm nhận</dt>
                    <dd className="font-medium text-on-surface">
                      {formatDateTime(target.reconciliation.receivedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant">Người chuyển</dt>
                    <dd className="font-medium text-on-surface">
                      {target.reconciliation.payerName || 'Không ghi nhận'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-on-surface">
                    Mã giao dịch trên sao kê *
                    <input
                      value={evidence.externalReference}
                      onChange={(event) => setEvidence((current) => ({
                        ...current,
                        externalReference: event.target.value,
                      }))}
                      maxLength={120}
                      disabled={Boolean(confirmingId)}
                      placeholder="FT123456789"
                      className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5 font-mono outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-semibold text-on-surface">
                    Số tiền thực nhận (VND) *
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={evidence.receivedAmount}
                      onChange={(event) => setEvidence((current) => ({
                        ...current,
                        receivedAmount: event.target.value,
                      }))}
                      disabled={Boolean(confirmingId)}
                      placeholder={String(target.amount)}
                      className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5 outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-semibold text-on-surface">
                    Thời điểm tiền vào *
                    <input
                      type="datetime-local"
                      value={evidence.receivedAt}
                      onChange={(event) => setEvidence((current) => ({
                        ...current,
                        receivedAt: event.target.value,
                      }))}
                      disabled={Boolean(confirmingId)}
                      className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5 outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-semibold text-on-surface">
                    Tên người chuyển
                    <input
                      value={evidence.payerName}
                      onChange={(event) => setEvidence((current) => ({
                        ...current,
                        payerName: event.target.value,
                      }))}
                      maxLength={120}
                      disabled={Boolean(confirmingId)}
                      placeholder="NGUYEN VAN A"
                      className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5 outline-none focus:border-primary"
                    />
                  </label>
                </div>
              )}

              <label className="mt-5 block text-sm font-semibold text-on-surface">
                Ghi chú kiểm tra (tuỳ chọn)
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  disabled={Boolean(confirmingId)}
                  placeholder="Ví dụ: khớp giao dịch lúc 14:32 sao kê Vietcombank"
                  className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5 outline-none focus:border-primary"
                />
              </label>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={Boolean(confirmingId)}
                  onClick={() => setTarget(null)}
                  className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={Boolean(confirmingId)}
                  onClick={() => void handleConfirm()}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {confirmingId
                    ? 'Đang xử lý…'
                    : target.reconciliation?.status === 'MATCHED'
                      ? target.holdExpired
                        ? 'Duyệt & tạo hoàn tiền'
                        : 'Duyệt & phát vé'
                      : 'Lưu bằng chứng (bước 1/2)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
