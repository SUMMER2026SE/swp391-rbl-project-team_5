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

export default function BankTransferManagementPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmingId, setConfirmingId] = useState('')
  const [target, setTarget] = useState(null)
  const [note, setNote] = useState('')

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
    setConfirmingId(target.bookingId)
    try {
      const response = await confirmBankTransfer(target.bookingId, note.trim() || undefined)
      toast.success(response.message || 'Đã xác nhận thanh toán.')
      setTarget(null)
      setNote('')
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
              Mở app ngân hàng, kiểm tra khoản tiền có <strong>nội dung chuyển khoản</strong> khớp
              với đơn bên dưới và <strong>đúng số tiền</strong>, sau đó bấm Xác nhận để hệ thống
              phát vé điện tử cho khách.
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
                        {item.holdExpired ? (
                          <span className="font-bold text-error">Đã hết hạn</span>
                        ) : (
                          <span className="text-on-surface-variant">
                            {formatDateTime(item.holdExpiresAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {item.holdExpired ? (
                          <span className="text-xs text-error">
                            Không thể phát vé. Nếu khách đã chuyển tiền, hãy hoàn tiền thủ công.
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(confirmingId)}
                            onClick={() => {
                              setTarget(item)
                              setNote('')
                            }}
                            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                              price_check
                            </span>
                            Xác nhận đã nhận tiền
                          </button>
                        )}
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
                Xác nhận đã nhận tiền
              </h3>
              <p className="mt-2 text-sm text-on-surface-variant">
                Hãy chắc chắn sao kê ngân hàng có khoản tiền
                <strong className="text-on-surface"> {formatCurrency(target.amount)}</strong> với nội dung
                <strong className="font-mono text-primary"> {target.transferContent}</strong>.
                Sau khi xác nhận, hệ thống sẽ phát vé điện tử cho khách.
              </p>

              <label className="mt-5 block text-sm font-semibold text-on-surface">
                Ghi chú đối chiếu (tuỳ chọn)
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={200}
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
                  {confirmingId ? 'Đang xác nhận…' : 'Xác nhận & phát vé'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
