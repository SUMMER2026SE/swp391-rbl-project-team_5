import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import bookingService from '../services/bookingService.js'

const banks = [
  { id: 'vcb', name: 'Vietcombank', shortName: 'VCB', color: 'text-emerald-700' },
  { id: 'bidv', name: 'BIDV', shortName: 'BIDV', color: 'text-blue-700' },
  { id: 'tcb', name: 'Techcombank', shortName: 'TCB', color: 'text-red-600' },
  { id: 'agribank', name: 'Agribank', shortName: 'AGR', color: 'text-red-800' },
  { id: 'mb', name: 'MB Bank', shortName: 'MB', color: 'text-blue-800' },
  { id: 'vietinbank', name: 'VietinBank', shortName: 'CTG', color: 'text-sky-700' },
  { id: 'vpbank', name: 'VPBank', shortName: 'VP', color: 'text-green-700' },
  { id: 'acb', name: 'ACB', shortName: 'ACB', color: 'text-blue-600' },
]

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const formatCountdown = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(
    totalSeconds % 60,
  ).padStart(2, '0')}`
}

function VNPaySimulatorPage() {
  const { bookingId } = useParams()
  const navigate = useNavigate()
  const booking = bookingService.getBookingDetails(bookingId)
  const [selectedBank, setSelectedBank] = useState('vcb')
  const [searchTerm, setSearchTerm] = useState('')
  const [now, setNow] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const filteredBanks = useMemo(
    () =>
      banks.filter((bank) =>
        bank.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
      ),
    [searchTerm],
  )

  if (!booking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-5">
        <div className="max-w-md text-center">
          <span className="material-symbols-outlined text-6xl text-error" aria-hidden="true">
            error
          </span>
          <h1 className="mt-4 text-3xl font-bold text-primary">Không tìm thấy giao dịch</h1>
          <button
            className="mt-6 rounded-xl bg-primary px-6 py-3 font-bold text-white"
            onClick={() => navigate('/my-tickets')}
            type="button"
          >
            Về vé của tôi
          </button>
        </div>
      </main>
    )
  }

  const effectiveNow = now || new Date(booking.createdAt).getTime()
  const remainingTime = Math.max(
    0,
    new Date(booking.expiresAt).getTime() - effectiveNow,
  )

  const simulatePayment = (result) => {
    if (isProcessing) return
    setIsProcessing(true)

    if (result === 'success') {
      bookingService.confirmPayment(
        bookingId,
        booking.requiresPartnerApproval ? 'pending_partner' : 'confirmed',
      )
      navigate(`/booking-success?vnpayResponseCode=00&bookingId=${bookingId}`)
      return
    }

    bookingService.confirmPayment(bookingId, 'failed')
    navigate(`/booking-success?vnpayResponseCode=24&bookingId=${bookingId}`)
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <header className="bg-primary shadow-[0_4px_20px_rgba(0,123,133,0.1)]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-5 py-6 md:px-12">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white">
              <span className="material-symbols-outlined text-3xl text-primary" aria-hidden="true">
                account_balance_wallet
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-white">VN</span>
                <span className="rounded bg-red-600 px-2 py-1 text-sm font-extrabold text-white">PAY</span>
                <span className="text-xl font-bold text-white">Simulator</span>
              </div>
              <p className="text-xs font-semibold text-white/70">
                Môi trường thử nghiệm thanh toán
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 text-white">
            <HeaderFact label="Đơn vị thụ hưởng" value="VietTicket Travel" />
            <HeaderFact label="Mã đơn hàng" value={booking.id} />
            <HeaderFact
              emphasized
              label="Số tiền thanh toán"
              value={formatCurrency(booking.totalAmount)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 py-10 md:px-12">
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="flex flex-col gap-6 lg:col-span-5">
            <div className="flex flex-col items-center rounded-2xl bg-white p-8 text-center shadow-[0_4px_20px_rgba(0,40,50,0.05)]">
              <h1 className="text-2xl font-bold text-primary">Quét mã để thanh toán</h1>
              <p className="mt-2 text-sm text-on-surface-variant">
                Sử dụng ứng dụng ngân hàng hoặc ví VNPay để quét
              </p>
              <div className="mt-7 rounded-2xl border-2 border-outline-variant/30 bg-white p-5 shadow-inner">
                <QRCodeSVG
                  level="H"
                  marginSize={1}
                  size={230}
                  value={`VNPAY|${booking.id}|${booking.totalAmount}`}
                />
              </div>
              <div className="mt-7 flex items-center gap-2 text-xl font-bold text-secondary">
                <span className="material-symbols-outlined" aria-hidden="true">timer</span>
                {formatCountdown(remainingTime)}
              </div>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Hiệu lực giao dịch
              </p>
            </div>
            <div className="rounded-xl border-l-4 border-secondary bg-surface-container-low p-6">
              <div className="flex gap-4">
                <span className="material-symbols-outlined text-secondary" aria-hidden="true">
                  security
                </span>
                <div>
                  <h2 className="text-lg font-bold text-secondary">Giao dịch an toàn</h2>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Đây là trang mô phỏng. Không có dữ liệu ngân hàng thật nào được thu thập.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-[0_4px_20px_rgba(0,40,50,0.05)] md:p-8 lg:col-span-7">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-on-surface">
                  Thanh toán qua ngân hàng
                </h2>
                <p className="mt-1 text-on-surface-variant">
                  Chọn ngân hàng nội địa để tiếp tục
                </p>
              </div>
              <label className="relative">
                <span className="sr-only">Tìm tên ngân hàng</span>
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-hidden="true">
                  search
                </span>
                <input
                  className="w-64 rounded-full border-0 bg-surface-container-low py-2.5 pl-10 pr-4 outline-none ring-secondary/20 focus:ring-2"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Tìm tên ngân hàng..."
                  type="search"
                  value={searchTerm}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {filteredBanks.map((bank) => (
                <button
                  className={`flex flex-col items-center justify-center rounded-xl border p-4 transition active:scale-95 ${
                    selectedBank === bank.id
                      ? 'border-secondary bg-secondary/5 ring-2 ring-secondary/15'
                      : 'border-outline-variant/40 hover:border-secondary'
                  }`}
                  key={bank.id}
                  onClick={() => setSelectedBank(bank.id)}
                  type="button"
                >
                  <span className={`flex h-12 w-24 items-center justify-center rounded bg-surface-container-high text-lg font-black ${bank.color}`}>
                    {bank.shortName}
                  </span>
                  <span className="mt-2 text-sm font-semibold text-on-surface-variant">
                    {bank.name}
                  </span>
                </button>
              ))}
            </div>

            {filteredBanks.length === 0 && (
              <p className="py-12 text-center text-on-surface-variant">
                Không tìm thấy ngân hàng phù hợp.
              </p>
            )}
          </section>
        </div>

        <section className="relative mt-8 overflow-hidden rounded-3xl border-2 border-dashed border-tertiary-fixed-dim bg-tertiary-fixed/20 p-7 md:p-8">
          <span className="material-symbols-outlined absolute right-4 top-4 text-8xl text-tertiary/10" aria-hidden="true">
            terminal
          </span>
          <div className="relative z-10 flex flex-col items-center justify-between gap-7 md:flex-row">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tertiary-fixed-dim text-tertiary">
                  <span className="material-symbols-outlined" aria-hidden="true">code</span>
                </span>
                <h2 className="text-xl font-bold text-tertiary">
                  Sandbox dành cho nhà phát triển
                </h2>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-on-tertiary-fixed-variant">
                Chọn kết quả giả lập để kiểm tra trạng thái booking và redirect URL trả về VietTicket.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-[#2e7d32] px-7 py-4 font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-60"
                disabled={isProcessing || remainingTime === 0}
                onClick={() => simulatePayment('success')}
                type="button"
              >
                <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                Giả lập Thành công
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-[#c62828] px-7 py-4 font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-60"
                disabled={isProcessing}
                onClick={() => simulatePayment('failure')}
                type="button"
              >
                <span className="material-symbols-outlined" aria-hidden="true">cancel</span>
                Giả lập Thất bại
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function HeaderFact({ emphasized = false, label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white/70">{label}</p>
      <p className={emphasized ? 'font-bold text-secondary-fixed' : 'font-bold text-white'}>
        {value}
      </p>
    </div>
  )
}

export default VNPaySimulatorPage
