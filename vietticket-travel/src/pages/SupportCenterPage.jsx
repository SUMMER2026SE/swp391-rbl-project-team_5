import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import bookingService from '../services/bookingService.js'
import supportApi from '../services/supportApi.js'
import { formatBookingReference } from '../utils/bookingReference.js'

const SUBJECT_OPTIONS = [
  'Lỗi thanh toán',
  'Yêu cầu hoàn vé',
  'Phản ánh dịch vụ',
  'Trợ giúp khác',
]

const formatDate = (value) => {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function SupportCenterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedBookingId = String(searchParams.get('bookingId') || '').trim()
  const [subject, setSubject] = useState(SUBJECT_OPTIONS[0])
  const [bookingId, setBookingId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [bookings, setBookings] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasTickets, setHasTickets] = useState(false)

  useEffect(() => {
    let active = true
    bookingService
      .getBookings()
      .then((data) => {
        if (!active) return
        const ownedBookings = Array.isArray(data) ? data : []
        setBookings(ownedBookings)
        if (requestedBookingId && ownedBookings.some((b) => String(b.id) === requestedBookingId)) {
          setBookingId(requestedBookingId)
        }
      })
      .catch(() => {
        // Không chặn form nếu không tải được danh sách đơn.
      })

    supportApi.getMyTickets()
      .then((data) => {
        if (active && data && data.length > 0) {
          setHasTickets(true)
        }
      })
      .catch(() => {
        // Không làm phiền trải nghiệm nếu fetch thất bại
      })

    return () => {
      active = false
    }
  }, [requestedBookingId])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!title.trim()) {
      toast.warning('Vui lòng nhập tiêu đề.')
      return
    }
    if (description.trim().length < 10) {
      toast.warning('Nội dung chi tiết cần tối thiểu 10 ký tự.')
      return
    }

    setIsSubmitting(true)
    try {
      const createdTicket = await supportApi.createTicket({
        subject: `[${subject}] ${title.trim()}`,
        description: description.trim(),
        bookingId: bookingId || undefined,
      })
      if (!createdTicket?.id) {
        throw new Error('Hệ thống chưa xác nhận đã lưu yêu cầu hỗ trợ. Vui lòng thử lại.')
      }
      toast.success('Đã gửi yêu cầu hỗ trợ thành công!')
      navigate('/my-support', { state: { createdTicketId: createdTicket.id } })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Header activeLink="Support" />
      <div className="mx-auto min-h-[calc(100vh-80px)] max-w-[1440px] bg-surface px-4 py-10">
        <div className="mx-auto w-full max-w-[600px]">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold text-primary">Trung tâm hỗ trợ</h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              Gửi yêu cầu, chúng tôi sẽ phản hồi sớm nhất qua khung chat trực tuyến.
            </p>
          </div>

          {hasTickets && (
            <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary shadow-sm">
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-primary shrink-0 mt-0.5" style={{ fontSize: 20 }}>
                  chat
                </span>
                <p className="text-left font-medium leading-tight">
                  Bạn đã có các yêu cầu hỗ trợ trước đó. Tiếp tục trò chuyện với nhân viên CSKH tại Lịch sử hỗ trợ.
                </p>
              </div>
              <Link
                to="/my-support"
                className="w-full sm:w-auto shrink-0 text-center rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary hover:brightness-110 transition active:scale-95"
                style={{ textDecoration: 'none' }}
              >
                Trò chuyện ngay
              </Link>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-[0_4px_20px_rgba(0,40,50,0.05)] sm:p-8"
          >
            <label className="mb-2 block text-sm font-semibold text-on-surface" htmlFor="subject">
              Chủ đề hỗ trợ
            </label>
            <select
              id="subject"
              className="mb-5 w-full rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            >
              {SUBJECT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <label className="mb-2 block text-sm font-semibold text-on-surface" htmlFor="booking">
              Đơn hàng liên quan (không bắt buộc)
            </label>
            <select
              id="booking"
              className="mb-5 w-full rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              value={bookingId}
              onChange={(event) => setBookingId(event.target.value)}
            >
              <option value="">— Không chọn —</option>
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatBookingReference(b.id)} - {b.attractionTitle} - {formatDate(b.visitDate)}
                </option>
              ))}
            </select>

            <label className="mb-2 block text-sm font-semibold text-on-surface" htmlFor="title">
              Tiêu đề
            </label>
            <input
              id="title"
              type="text"
              className="mb-5 w-full rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Tóm tắt ngắn gọn vấn đề"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />

            <label className="mb-2 block text-sm font-semibold text-on-surface" htmlFor="description">
              Nội dung chi tiết
            </label>
            <textarea
              id="description"
              className="mb-6 min-h-32 w-full resize-y rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Mô tả cụ thể vấn đề bạn đang gặp phải (tối thiểu 10 ký tự)..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />

            <button
              type="submit"
              className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-on-primary transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu hỗ trợ'}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </>
  )
}

export default SupportCenterPage
