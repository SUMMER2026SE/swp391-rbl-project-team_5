import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import { useAuth } from '../context/useAuth.js'
import { getItineraryBookingProgress } from '../services/bookingService.js'
import { footerLinks } from '../data/landingData.js'
import {
  buildItineraryQueueActionUrl,
  getItineraryQueueProgress,
  getNextItineraryQueueStep,
  loadItineraryBookingQueue,
  syncItineraryBookingQueueProgress,
} from '../utils/aiItineraryBookingQueue.js'

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0)

const formatDate = (value) => {
  if (!value) return 'Chưa chọn ngày'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

const STATUS_LABELS = {
  reserved: 'Đã giữ chỗ',
  booking_created: 'Chờ hoàn tất thanh toán',
  action_required: 'Cần đặt lại dòng vé này',
  completed: 'Đã thanh toán',
  refund_pending: 'Đang xử lý hoàn tiền',
}

const getNextActionLabel = (item, completedCount) => {
  if (item?.status === 'booking_created' || item?.status === 'reserved') {
    return 'Tiếp tục thanh toán đơn đang giữ'
  }
  if (item?.status === 'action_required') return 'Đặt lại dòng vé cần xử lý'
  return completedCount === 0 ? 'Bắt đầu giữ vé đầu tiên' : 'Tiếp tục dòng vé tiếp theo'
}

export default function ItineraryCheckoutPage() {
  const { queueId } = useParams()
  const { user } = useAuth()
  const [queue, setQueue] = useState(() => loadItineraryBookingQueue())
  const [syncWarning, setSyncWarning] = useState('')
  const currentUserId = user?.id || user?.userId || ''
  const canView = queue?.id === queueId && (!queue.ownerId || queue.ownerId === currentUserId)

  useEffect(() => {
    if (!canView || !queue?.itineraryId) return undefined
    let active = true
    getItineraryBookingProgress(queue.itineraryId)
      .then((progress) => {
        if (!active) return
        const updated = syncItineraryBookingQueueProgress(progress?.items)
        if (updated) setQueue(updated)
        setSyncWarning('')
      })
      .catch(() => {
        if (active) {
          setSyncWarning('Chưa đồng bộ được trạng thái thanh toán mới nhất. Bạn có thể tải lại trang sau ít phút.')
        }
      })
    return () => {
      active = false
    }
  }, [canView, queue?.itineraryId])

  if (!canView) {
    return (
      <>
        <Header />
        <main className="min-h-[65vh] bg-[#f8fafb] px-4 py-16">
          <section className="mx-auto max-w-xl rounded-3xl border border-[#e1e3e4] bg-white p-8 text-center shadow-sm">
            <span className="material-symbols-outlined text-5xl text-[#6f797a]" aria-hidden="true">remove_shopping_cart</span>
            <h1 className="mt-4 text-2xl font-bold text-[#191c1d]">Danh sách đặt vé không còn khả dụng</h1>
            <p className="mt-3 text-sm leading-6 text-[#596365]">Lịch trình có thể đã được tạo trên tài khoản khác hoặc dữ liệu trình duyệt đã hết hạn.</p>
            <Link className="mt-6 inline-flex rounded-xl bg-[#006068] px-5 py-3 font-semibold text-white" to="/attractions">Tạo lại lịch trình</Link>
          </section>
        </main>
        <Footer links={footerLinks} />
      </>
    )
  }

  const progress = getItineraryQueueProgress(queue)
  const nextItem = getNextItineraryQueueStep(queue)
  const nextUrl = nextItem ? buildItineraryQueueActionUrl(queue, nextItem) : ''
  const estimatedTotal = queue.items.reduce(
    (sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0),
    0,
  )

  return (
    <>
      <Header />
      <main className="min-h-[70vh] bg-[#f8fafb] px-4 py-10 md:py-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-7">
            <p className="text-sm font-bold uppercase tracking-wide text-[#006068]">Kiểm tra trước khi đặt</p>
            <h1 className="mt-1 text-3xl font-extrabold text-[#191c1d]">{queue.planTitle || 'Lịch trình của bạn'}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#596365]">
              Đây là một quy trình gồm {queue.items.length} dòng vé. Mỗi dòng được giữ chỗ và thanh toán riêng để đúng tồn kho, ngày đi và chính sách của từng đối tác; hệ thống luôn đưa bạn trở lại danh sách này sau mỗi giao dịch.
            </p>
            <div className="mt-4 rounded-2xl border border-[#b8d8d9] bg-[#f2fbfb] p-4 text-sm leading-6 text-[#00474d]">
              <strong>Không phải một đơn hàng gộp:</strong> mỗi dòng tạo một booking và một giao dịch độc lập.
              Nếu một dòng sau thất bại hoặc bạn dừng giữa chừng, các booking đã thanh toán trước đó vẫn giữ nguyên
              hiệu lực; hệ thống không tự hủy hay hoàn ngược toàn bộ lịch trình.
            </div>
            {progress.completed > 0 && !progress.isComplete && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                Lịch trình đang hoàn tất một phần: {progress.completed} dòng đã thanh toán.
                Bạn có thể tiếp tục các dòng còn lại hoặc dừng; hãy tự hủy từng booking đã mua nếu không còn nhu cầu,
                theo đúng chính sách của booking đó.
              </p>
            )}
            {syncWarning && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {syncWarning}
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="overflow-hidden rounded-2xl border border-[#e1e3e4] bg-white" aria-labelledby="itinerary-items-title">
              <div className="border-b border-[#e1e3e4] px-5 py-4">
                <h2 id="itinerary-items-title" className="text-lg font-bold text-[#191c1d]">Các vé trong lịch trình</h2>
              </div>
              <ol className="divide-y divide-[#e8ebec]">
                {queue.items.map((item, index) => {
                  const lineTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)
                  const isNext = nextItem?.id === item.id
                  return (
                    <li className={`p-5 ${isNext ? 'bg-[#f0fbfc]' : ''}`} key={item.id}>
                      <div className="flex gap-4">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.status === 'completed' ? 'bg-[#d9f1e3] text-[#0c6b3d]' : 'bg-[#d9f1f2] text-[#00474d]'}`}>
                          {item.status === 'completed' ? '✓' : index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-[#191c1d]">{item.attractionTitle}</p>
                              <p className="mt-1 text-sm text-[#596365]">{item.ticketName} · {item.quantity} vé</p>
                            </div>
                            <span className="text-sm font-bold text-[#00474d]">{formatCurrency(lineTotal)}</span>
                          </div>
                          <p className="mt-2 text-xs text-[#6f797a]">
                            {item.dayLabel} · {formatDate(item.visitDate)}{item.timeSlotLabel ? ` · ${item.timeSlotLabel}` : ''}
                          </p>
                          {item.status && (
                            <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              item.status === 'action_required'
                                ? 'bg-amber-100 text-amber-900'
                                : item.status === 'refund_pending'
                                  ? 'bg-blue-100 text-blue-900'
                                : 'bg-[#eef3f4] text-[#3f484a]'
                            }`}>
                              {STATUS_LABELS[item.status] || 'Đang xử lý'}
                            </span>
                          )}
                          {item.status === 'booking_created' && (
                            <p className="mt-2 text-xs leading-5 text-[#596365]">
                              Tiếp tục booking đang giữ chỗ; không tạo thêm một reservation trùng cho dòng này.
                            </p>
                          )}
                          {item.status === 'refund_pending' && (
                            <p className="mt-2 text-xs leading-5 text-blue-900">
                              Booking này đang có quy trình hoàn tiền riêng. Bạn vẫn có thể đặt các dòng phía sau,
                              nhưng không nên tạo lại dòng này cho tới khi kiểm tra trạng thái trong Vé của tôi.
                            </p>
                          )}
                          {item.status === 'action_required' && item.paid && (
                            <p className="mt-2 text-xs leading-5 text-amber-900">
                              Booking cũ đã ghi nhận tiền nhưng không còn cung cấp vé. Khoản hoàn được theo dõi riêng;
                              kiểm tra Vé của tôi trước khi thanh toán lại để tránh chi hai lần ngoài ý muốn.
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>

            <aside className="h-fit rounded-2xl border border-[#d7e4e5] bg-white p-5 shadow-sm" aria-label="Tóm tắt quy trình đặt vé">
              <h2 className="text-lg font-bold text-[#191c1d]">Tóm tắt</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4"><span className="text-[#596365]">Tiến độ</span><strong>{progress.completed}/{progress.total} dòng vé</strong></div>
                {progress.paymentPending > 0 && (
                  <div className="flex justify-between gap-4"><span className="text-[#596365]">Đang thanh toán</span><strong>{progress.paymentPending} dòng</strong></div>
                )}
                {progress.refundPending > 0 && (
                  <div className="flex justify-between gap-4"><span className="text-[#596365]">Đang hoàn tiền</span><strong>{progress.refundPending} dòng</strong></div>
                )}
                {progress.actionRequired > 0 && (
                  <div className="flex justify-between gap-4"><span className="text-[#596365]">Cần đặt lại</span><strong>{progress.actionRequired} dòng</strong></div>
                )}
                <div className="flex justify-between gap-4"><span className="text-[#596365]">Dự toán ban đầu</span><strong>{formatCurrency(estimatedTotal)}</strong></div>
              </div>
              <p className="mt-4 rounded-xl bg-[#fff7e6] p-3 text-xs leading-5 text-[#5d4300]">
                Dự toán không phải số tiền của một giao dịch chung. Giá, voucher và tồn vé được xác nhận lại ở từng bước giữ chỗ;
                tổng thực trả là tổng của các booking mà bạn thực sự hoàn tất.
              </p>
              {progress.isComplete ? (
                <Link className="mt-5 flex w-full items-center justify-center rounded-xl bg-[#006068] px-4 py-3 text-sm font-bold text-white" to="/my-tickets">Xem toàn bộ vé đã đặt</Link>
              ) : nextItem && nextUrl ? (
                <Link className="mt-5 flex w-full items-center justify-center rounded-xl bg-[#006068] px-4 py-3 text-sm font-bold text-white" to={nextUrl}>
                  {getNextActionLabel(nextItem, progress.completed)}
                </Link>
              ) : (
                <Link className="mt-5 flex w-full items-center justify-center rounded-xl bg-[#006068] px-4 py-3 text-sm font-bold text-white" to="/my-tickets">
                  Theo dõi các booking và khoản hoàn
                </Link>
              )}
              <Link className="mt-3 flex w-full items-center justify-center rounded-xl border border-[#9aa5a7] px-4 py-3 text-sm font-semibold text-[#00474d]" to="/attractions">Quay lại lịch trình</Link>
            </aside>
          </div>
        </div>
      </main>
      <Footer links={footerLinks} />
    </>
  )
}
