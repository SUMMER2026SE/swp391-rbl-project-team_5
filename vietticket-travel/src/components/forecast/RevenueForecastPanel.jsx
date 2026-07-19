import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import {
  getAdminForecastOverview,
  getPartnerForecastOverview,
} from '../../services/forecastApi'

const DAY_OPTIONS = [
  { value: 7, label: '7 ngày tới' },
  { value: 14, label: '14 ngày tới' },
  { value: 30, label: '30 ngày tới' },
]

const formatVND = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const formatDate = (date) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${date}T00:00:00`))

function StatCard({ label, value, note }) {
  return (
    <div className="rounded-xl border border-[#e1e3e4] bg-[#f8fafb] p-4">
      <p className="text-xs text-[#6f797a]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#00474d]">{value}</p>
      {note && <p className="mt-1 text-[11px] text-[#6f797a]">{note}</p>}
    </div>
  )
}

export default function RevenueForecastPanel({ mode = 'partner' }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const loadOverview =
      mode === 'admin' ? getAdminForecastOverview : getPartnerForecastOverview

    loadOverview({ days })
      .then((response) => {
        if (active) setData(response.data)
      })
      .catch((error) => {
        if (active) {
          setData(null)
          toast.error(error.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [days, mode, reloadKey])

  const items = mode === 'admin' ? data?.topAttractions : data?.attractions
  const maxTimelineRevenue = useMemo(
    () => Math.max(
      1,
      ...(data?.timeline || []).map((point) => Number(point.predictedRevenue || 0)),
    ),
    [data],
  )

  return (
    <section className="rounded-xl border border-[#d8e3e4] bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold text-[#191c1d]">
              <span className="material-symbols-outlined text-[20px] text-[#00474d]">
                insights
              </span>
              Dự báo doanh thu vé
            </h3>
            <span className="rounded-full bg-[#d7f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#004f56]">
              AI có kiểm soát
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6f797a]">
            Ước tính doanh thu vé thuần trước hoa hồng, theo ngày khách sử dụng dịch vụ.
            Dữ liệu đầu vào chỉ gồm booking đã hoàn tất/no-show, đã loại giao dịch trùng và tiền hoàn.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Khoảng thời gian dự báo"
            value={days}
            onChange={(event) => {
              setLoading(true)
              setDays(Number(event.target.value))
            }}
            className="rounded-lg border border-[#bec8ca] px-3 py-2 text-sm text-[#3f484a]"
          >
            {DAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Tải lại dự báo"
            onClick={() => {
              setLoading(true)
              setReloadKey((value) => value + 1)
            }}
            disabled={loading}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#bec8ca] text-[#00474d] hover:bg-[#f2f4f5] disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[19px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-[36px] text-[#00474d]">
            progress_activity
          </span>
        </div>
      ) : !data ? (
        <div className="rounded-lg bg-[#fff4f2] px-4 py-8 text-center text-sm text-[#8c1d18]">
          Không thể tải dự báo doanh thu. Vui lòng thử lại sau.
        </div>
      ) : data.totalAttractions === 0 ? (
        <div className="rounded-lg border border-dashed border-[#bec8ca] px-5 py-10 text-center">
          <span className="material-symbols-outlined text-[34px] text-[#6f797a]">query_stats</span>
          <p className="mt-2 text-sm font-medium text-[#3f484a]">
            Chưa có điểm tham quan đủ điều kiện dự báo
          </p>
          <p className="mt-1 text-xs text-[#6f797a]">
            Điểm phải được duyệt, đang mở bán và có ít nhất một gói vé hoạt động.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label={`Doanh thu dự báo · ${days} ngày`}
              value={formatVND(data.totalPredictedRevenue)}
              note={mode === 'admin' ? 'Tổng các điểm đang mở bán' : 'Trước hoa hồng nền tảng'}
            />
            <StatCard
              label="Điểm dự báo thành công"
              value={`${data.successfulAttractions}/${data.totalAttractions}`}
              note={data.failedAttractions ? `${data.failedAttractions} điểm cần kiểm tra dữ liệu` : 'Không có lỗi dữ liệu'}
            />
            <StatCard
              label="Phương pháp"
              value={`${data.methodSummary?.ai || 0} AI · ${data.methodSummary?.baseline || 0} baseline`}
              note="Baseline được dùng khi dữ liệu thực chưa đủ hoặc AI gián đoạn"
            />
          </div>

          {(data.methodSummary?.baseline || 0) > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-[#f2d58b] bg-[#fff8e6] px-4 py-3 text-xs leading-5 text-[#6b5100]">
              <span className="material-symbols-outlined mt-0.5 text-[18px]">info</span>
              <span>
                Có {data.methodSummary.baseline} điểm đang dùng baseline theo thứ trong tuần và
                xu hướng 28 ngày. Các điểm này không được trình bày như kết quả của model AI.
              </span>
            </div>
          )}

          {data.timeline?.length > 0 && (
            <div className="rounded-xl border border-[#e1e3e4] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[#191c1d]">Xu hướng dự kiến</h4>
                  <p className="mt-0.5 text-[11px] text-[#6f797a]">
                    Cột thể hiện doanh thu thuần dự kiến theo ngày tham quan
                  </p>
                </div>
                <span className="text-[11px] text-[#6f797a]">Đơn vị: VND</span>
              </div>
              <div className="flex h-48 min-w-0 items-end gap-1.5 overflow-x-auto pb-1">
                {data.timeline.map((point) => (
                  <div
                    className="flex h-full min-w-[34px] flex-1 flex-col items-center justify-end gap-1.5"
                    key={point.date}
                    title={`${formatDate(point.date)}: ${formatVND(point.predictedRevenue)} · khoảng ${formatVND(point.confidenceLower)} – ${formatVND(point.confidenceUpper)}`}
                  >
                    <div className="flex h-36 w-full items-end rounded-t bg-[#eef2f3]">
                      <div
                        className="w-full rounded-t bg-[#0b7c84]"
                        style={{
                          height: `${Math.max(
                            3,
                            (Number(point.predictedRevenue || 0) / maxTimelineRevenue) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-[#6f797a]">{formatDate(point.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-3 text-sm font-semibold text-[#191c1d]">
              {mode === 'admin' ? 'Top điểm theo doanh thu dự kiến' : 'Theo điểm tham quan'}
            </h4>
            {!items || items.length === 0 ? (
              <p className="rounded-lg bg-[#f8fafb] py-6 text-center text-sm text-[#6f797a]">
                Chưa có kết quả dự báo.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div
                    key={item.attractionId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e1e3e4] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#191c1d]">
                        {item.attractionTitle}
                      </p>
                      {item.error ? (
                        <p className="text-xs text-[#b3261e]">{item.error}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-[#6f797a]">
                          {[item.city, item.usedFallback ? 'Baseline lịch sử' : 'AI ensemble']
                            .filter(Boolean)
                            .join(' · ')}
                          {item.dataQuality?.completedBookings != null
                            ? ` · ${item.dataQuality.completedBookings} booking mẫu`
                            : ''}
                        </p>
                      )}
                    </div>
                    {!item.error && (
                      <span className="whitespace-nowrap text-sm font-semibold text-[#006068]">
                        {formatVND(item.totalPredictedRevenue)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] leading-5 text-[#6f797a]">
            Dự báo là công cụ hỗ trợ lập kế hoạch nhân sự, tồn vé và marketing; không phải cam kết
            doanh thu. Khoảng dự báo có thể thay đổi theo thời tiết, ngày lễ, chương trình khuyến mãi
            và tình trạng mở bán thực tế.
          </p>
        </div>
      )}
    </section>
  )
}
