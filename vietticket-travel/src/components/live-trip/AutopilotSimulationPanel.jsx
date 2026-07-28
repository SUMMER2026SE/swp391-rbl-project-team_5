import { useMemo } from 'react'
import {
  formatMinuteOfDay,
  getSimulationPresentation,
} from '../../utils/liveTripExperience.js'

function itemName(item) {
  return item?.snapshot?.title || item?.attraction?.title || 'Hoạt động'
}

export default function AutopilotSimulationPanel({ items = [], simulation }) {
  const presentation = useMemo(
    () => getSimulationPresentation(simulation),
    [simulation],
  )
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )

  if (!presentation) return null

  return (
    <section
      aria-labelledby="autopilot-lab-title"
      className="mt-5 overflow-hidden rounded-3xl border border-violet-200 bg-violet-50 shadow-sm"
    >
      <div className="border-b border-violet-200 bg-white/60 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">
              Autopilot constraint lab
            </p>
            <h2 className="mt-1 text-xl font-black text-violet-950" id="autopilot-lab-title">
              Mô phỏng an toàn, chưa áp dụng vào lịch
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-violet-700">
              Bộ giải thử các dịch chuyển thời gian trong miền ràng buộc. Đây không phải
              thao tác đặt vé và không tuyên bố “phút tiết kiệm” khi chưa có đường cong
              chờ theo từng khung.
            </p>
          </div>
          <span className="max-w-full break-all rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">
            {presentation.algorithm || 'Chưa có phiên bản thuật toán'}
          </span>
        </div>

        {presentation.fallback && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">
            <strong>Bộ giải đang dùng chế độ an toàn:</strong> dịch vụ tối ưu chưa khả
            dụng hoặc response không vượt qua kiểm tra. Lịch trình không bị thay đổi và
            không có kết quả tối ưu giả được hiển thị.
          </div>
        )}
        {presentation.hasConstraintViolations && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
            Kết quả còn vi phạm ràng buộc nên không được phép áp dụng.
          </div>
        )}
        {presentation.hasRegression && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
            Điểm tối ưu thấp hơn lịch gốc. Kết quả bị đánh dấu không hợp lệ và chỉ
            được giữ làm bằng chứng chẩn đoán.
          </div>
        )}
      </div>

      <div className="p-5 md:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Điểm ràng buộc trước"
            value={presentation.metricsAvailable ? presentation.baseline.toFixed(1) : '—'}
          />
          <Metric
            label="Điểm ràng buộc sau"
            value={presentation.metricsAvailable ? presentation.optimized.toFixed(1) : '—'}
          />
          <Metric
            label="Mức cải thiện"
            value={presentation.metricsAvailable
              ? `${presentation.improvement >= 0 ? '+' : ''}${presentation.improvement.toFixed(1)}`
              : '—'}
          />
          <Metric
            label="Hoạt động được bảo vệ"
            value={Number.isFinite(Number(simulation.protected_booking_count))
              ? Number(simulation.protected_booking_count)
              : '—'}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {presentation.safeguards.map((safeguard) => (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-800"
              key={safeguard}
            >
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified_user</span>
              {safeguard}
            </span>
          ))}
        </div>

        {!presentation.fallback
          && presentation.metricsAvailable
          && !presentation.hasRegression
          && !presentation.hasConstraintViolations
          && presentation.proposals.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            <strong>Lịch hiện tại đã vượt qua mô phỏng:</strong> bộ giải không tìm thấy
            dịch chuyển nào tốt hơn trong biên an toàn cho phép.
          </div>
        ) : presentation.proposals.length > 0 ? (
          <div className="mt-5">
            <h3 className="text-sm font-black text-violet-950">
              {presentation.proposals.length} dịch chuyển tiềm năng trong sandbox
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {presentation.proposals.map((proposal) => (
                <article
                  className="rounded-2xl border border-violet-200 bg-white p-4"
                  key={`${proposal.item_id}:${proposal.proposed_start_minute}`}
                >
                  <p className="font-black text-slate-900">
                    {itemName(itemsById.get(proposal.item_id))}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-violet-800">
                    {formatMinuteOfDay(proposal.original_start_minute)}
                    {' → '}
                    {formatMinuteOfDay(proposal.proposed_start_minute)}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {proposal.reason || 'Giảm xung đột trong miền ràng buộc đã kiểm tra.'}
                  </p>
                </article>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-violet-700">
              Các dịch chuyển sandbox không tự trở thành proposal nghiệp vụ. Proposal
              thực tế vẫn phải kiểm tra lại pressure/quota và cần khách xác nhận.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold text-violet-600">{label}</p>
      <p className="mt-1 text-xl font-black text-violet-950">{value}</p>
    </div>
  )
}
