import { useCallback, useEffect, useMemo, useState } from 'react'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import {
  getLoyaltySummary,
  getRedemptionCatalog,
  redeemLoyaltyPoints,
  getMyLoyaltyVouchers,
  getLoyaltyTransactions,
} from '../services/loyaltyApi.js'

const formatPoints = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0)
const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`

const formatDateTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN')
}

const formatDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN')
}

const TXN_LABEL = {
  EARN: { text: 'Tích điểm', icon: 'add_circle', tone: 'positive' },
  REDEEM: { text: 'Đổi điểm', icon: 'redeem', tone: 'neutral' },
  REVERSAL: { text: 'Thu hồi', icon: 'undo', tone: 'negative' },
  ADJUSTMENT: { text: 'Điều chỉnh', icon: 'tune', tone: 'neutral' },
}

const VOUCHER_STATE = {
  active: { text: 'Sẵn sàng dùng', tone: 'positive' },
  used: { text: 'Đã sử dụng', tone: 'neutral' },
  expired: { text: 'Hết hạn', tone: 'negative' },
  inactive: { text: 'Ngừng hiệu lực', tone: 'negative' },
}

function MyRewardsPage() {
  const [summary, setSummary] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [vouchers, setVouchers] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [redeemingId, setRedeemingId] = useState('')
  const [notice, setNotice] = useState(null)

  const balance = summary?.balance ?? 0
  const redeemable = summary?.redeemable ?? 0
  const pending = summary?.pending ?? 0

  useEffect(() => {
    document.title = 'Điểm thưởng của tôi | VietTicket Travel'
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [summaryRes, catalogRes, vouchersRes, txnRes] = await Promise.all([
        getLoyaltySummary(),
        getRedemptionCatalog(),
        getMyLoyaltyVouchers(),
        getLoyaltyTransactions({ limit: 20 }),
      ])
      setSummary(summaryRes.data)
      setCatalog(catalogRes.data?.tiers || [])
      setVouchers(vouchersRes.data || [])
      setTransactions(txnRes.data?.items || [])
      setError('')
    } catch (err) {
      setError(err.message || 'Không thể tải dữ liệu điểm thưởng.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll()
  }, [loadAll])

  const handleRedeem = async (tier) => {
    if (redeemingId) return
    setNotice(null)
    setRedeemingId(tier.id)
    try {
      const res = await redeemLoyaltyPoints(tier.id)
      setNotice({
        type: 'success',
        text: `Đổi thành công! Mã ${res.data?.voucher?.code} đã được thêm vào ví ưu đãi của bạn.`,
      })
      await loadAll()
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Đổi điểm thất bại. Vui lòng thử lại.' })
    } finally {
      setRedeemingId('')
    }
  }

  const copyCode = (code) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => setNotice({ type: 'success', text: `Đã sao chép mã ${code}.` }),
        () => {},
      )
    }
  }

  const lifetimeEarned = summary?.lifetimeEarned ?? 0
  const vndPerPoint = summary?.vndPerPoint ?? 1000

  const activeVouchers = useMemo(
    () => vouchers.filter((v) => v.state === 'active'),
    [vouchers],
  )
  const historyVouchers = useMemo(
    () => vouchers.filter((v) => v.state !== 'active'),
    [vouchers],
  )

  return (
    <AccountLayout active="rewards">
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h1>Điểm thưởng của tôi</h1>
            <p>
              Tích {formatPoints(1)} điểm cho mỗi {formatCurrency(vndPerPoint)} chi tiêu khi đơn được
              xác nhận. Dùng điểm để đổi lấy voucher giảm giá cho lần đặt vé sau.
            </p>
          </div>
        </div>

        {notice ? (
          <p className={notice.type === 'success' ? 'auth-helper' : 'auth-error'}>{notice.text}</p>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}

        <div className="rewards-balance">
          <div className="rewards-balance__main">
            <span className="rewards-balance__label">Điểm khả dụng (có thể đổi ngay)</span>
            <strong className={`rewards-balance__value${redeemable < 0 ? ' is-negative' : ''}`}>
              {formatPoints(redeemable)}
              <span> điểm</span>
            </strong>
            {balance < 0 ? (
              <span className="rewards-balance__hint">
                Số dư đang âm do một đơn đã tích điểm được hoàn tiền. Bạn có thể tiếp tục tích điểm để
                đưa số dư về dương.
              </span>
            ) : (
              <span className="rewards-balance__hint">
                Tương đương khoảng {formatCurrency(redeemable * 50)} giá trị đổi thưởng.
                {pending > 0
                  ? ` · Tổng số dư ${formatPoints(balance)} điểm.`
                  : null}
              </span>
            )}
          </div>
          <div className="rewards-balance__side">
            <span className="material-symbols-outlined" aria-hidden="true">
              {pending > 0 ? 'schedule' : 'military_tech'}
            </span>
            <div>
              {pending > 0 ? (
                <>
                  <span>Điểm đang chờ (đơn chưa xong)</span>
                  <strong>{formatPoints(pending)}</strong>
                </>
              ) : (
                <>
                  <span>Tổng điểm đã tích</span>
                  <strong>{formatPoints(lifetimeEarned)}</strong>
                </>
              )}
            </div>
          </div>
        </div>
        {pending > 0 ? (
          <p className="rewards-balance__note">
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            Điểm từ đơn chưa hoàn tất chuyến đi sẽ khả dụng để đổi sau khi bạn sử dụng vé (đơn hoàn
            thành). Điều này bảo vệ chương trình khỏi việc đổi điểm rồi hoàn vé.
          </p>
        ) : null}
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Đổi điểm lấy voucher</h2>
            <p>Chọn gói ưu đãi phù hợp với số điểm khả dụng của bạn.</p>
          </div>
        </div>

        {loading ? (
          <p className="auth-helper">Đang tải gói đổi điểm...</p>
        ) : (
          <div className="rewards-catalog">
            {catalog.map((tier) => {
              const canRedeem = tier.affordable
              return (
                <article className="rewards-tier" key={tier.id}>
                  <div className="rewards-tier__value">{formatCurrency(tier.discountValue)}</div>
                  <div className="rewards-tier__meta">
                    <p>{formatPoints(tier.pointsCost)} điểm</p>
                    <span>Đơn tối thiểu {formatCurrency(tier.minSpend)}</span>
                    <span>Hạn dùng {tier.validityDays} ngày</span>
                  </div>
                  <button
                    type="button"
                    className="auth-submit"
                    disabled={!canRedeem || redeemingId === tier.id}
                    onClick={() => handleRedeem(tier)}
                  >
                    {redeemingId === tier.id
                      ? 'Đang đổi...'
                      : canRedeem
                        ? 'Đổi ngay'
                        : `Cần thêm ${formatPoints(Math.max(0, tier.pointsCost - redeemable))} điểm khả dụng`}
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Ví ưu đãi của tôi</h2>
            <p>Các voucher bạn đã đổi từ điểm thưởng. Nhập mã khi thanh toán để được giảm giá.</p>
          </div>
        </div>

        {loading ? (
          <p className="auth-helper">Đang tải voucher...</p>
        ) : activeVouchers.length === 0 && historyVouchers.length === 0 ? (
          <div className="activity-list activity-list--empty">
            <span className="material-symbols-outlined" aria-hidden="true">redeem</span>
            <p>Bạn chưa đổi voucher nào. Hãy dùng điểm để đổi ưu đãi ở trên!</p>
          </div>
        ) : (
          <div className="rewards-voucher-list">
            {[...activeVouchers, ...historyVouchers].map((voucher) => {
              const state = VOUCHER_STATE[voucher.state] || VOUCHER_STATE.inactive
              return (
                <article className={`rewards-voucher rewards-voucher--${voucher.state}`} key={voucher.id}>
                  <div className="rewards-voucher__left">
                    <strong>{formatCurrency(voucher.discountValue)}</strong>
                    <span>Đơn tối thiểu {formatCurrency(voucher.minSpend)}</span>
                  </div>
                  <div className="rewards-voucher__right">
                    <div className="rewards-voucher__code">
                      <code>{voucher.code}</code>
                      {voucher.state === 'active' ? (
                        <button type="button" className="text-button" onClick={() => copyCode(voucher.code)}>
                          Sao chép
                        </button>
                      ) : null}
                    </div>
                    <div className="rewards-voucher__foot">
                      <span className={`rewards-tag rewards-tag--${state.tone}`}>{state.text}</span>
                      <span>HSD: {formatDate(voucher.expiryDate)}</span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Lịch sử điểm</h2>
            <p>Sao kê các lần tích, đổi và thu hồi điểm gần đây.</p>
          </div>
        </div>

        {loading ? (
          <p className="auth-helper">Đang tải lịch sử...</p>
        ) : transactions.length === 0 ? (
          <div className="activity-list activity-list--empty">
            <span className="material-symbols-outlined" aria-hidden="true">history</span>
            <p>Chưa có biến động điểm nào.</p>
          </div>
        ) : (
          <ul className="rewards-history">
            {transactions.map((txn) => {
              const meta = TXN_LABEL[txn.type] || TXN_LABEL.ADJUSTMENT
              const positive = txn.points > 0
              return (
                <li className="rewards-history__item" key={txn.id}>
                  <span className={`rewards-history__icon rewards-history__icon--${meta.tone}`}>
                    <span className="material-symbols-outlined" aria-hidden="true">{meta.icon}</span>
                  </span>
                  <div className="rewards-history__body">
                    <p>{txn.description}</p>
                    <span>{meta.text} · {formatDateTime(txn.createdAt)}</span>
                  </div>
                  <div className="rewards-history__amount">
                    <strong className={positive ? 'is-positive' : 'is-negative'}>
                      {positive ? '+' : ''}{formatPoints(txn.points)}
                    </strong>
                    <span>Số dư: {formatPoints(txn.balanceAfter)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </AccountLayout>
  )
}

export default MyRewardsPage
