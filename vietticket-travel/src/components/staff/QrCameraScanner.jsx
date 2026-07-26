import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Quét mã QR bằng camera cho cổng soát vé.
// - Ưu tiên BarcodeDetector (native, nhanh, có trên Chrome/Edge).
// - Trình duyệt không hỗ trợ -> tự động dùng jsQR giải mã từng khung hình canvas.
// Nhân viên vẫn luôn có thể nhập tay mã vé nếu camera không khả dụng.

const SCAN_INTERVAL_MS = 180

function getErrorMessage(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Trình duyệt đã chặn quyền camera. Hãy bấm biểu tượng ổ khóa trên thanh địa chỉ và cho phép Camera, sau đó thử lại.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Không tìm thấy camera nào trên thiết bị này. Vui lòng dùng máy quét cầm tay hoặc nhập tay mã vé.'
  }
  if (name === 'NotReadableError') {
    return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.'
  }
  return error?.message || 'Không thể mở camera trên thiết bị này.'
}

export default function QrCameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const detectorRef = useRef(null)
  const stoppedRef = useRef(false)
  const [error, setError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [engine, setEngine] = useState('')

  const stopCamera = useCallback(() => {
    stoppedRef.current = true
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const handleDetected = useCallback(
    (rawValue) => {
      const value = String(rawValue || '').trim()
      if (!value || stoppedRef.current) return
      stopCamera()
      onDetected(value)
    },
    [onDetected, stopCamera],
  )

  useEffect(() => {
    stoppedRef.current = false
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError(
            'Trình duyệt này không hỗ trợ truy cập camera. Vui lòng dùng máy quét cầm tay hoặc nhập tay mã vé.',
          )
        }
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled || stoppedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.setAttribute('playsinline', 'true')
        await video.play().catch(() => {})

        // Chọn bộ giải mã: native trước, jsQR nếu không có.
        let detector = null
        if (typeof window.BarcodeDetector === 'function') {
          try {
            const formats = await window.BarcodeDetector.getSupportedFormats?.()
            if (!formats || formats.includes('qr_code')) {
              detector = new window.BarcodeDetector({ formats: ['qr_code'] })
            }
          } catch {
            detector = null
          }
        }
        detectorRef.current = detector
        if (cancelled) return
        setEngine(detector ? 'native' : 'jsqr')
        setIsReady(true)

        timerRef.current = window.setInterval(async () => {
          const currentVideo = videoRef.current
          if (!currentVideo || currentVideo.readyState < 2 || stoppedRef.current) return

          try {
            if (detectorRef.current) {
              const codes = await detectorRef.current.detect(currentVideo)
              if (codes?.length) {
                handleDetected(codes[0].rawValue)
                return
              }
              return
            }

            const canvas = canvasRef.current
            if (!canvas) return
            const width = currentVideo.videoWidth
            const height = currentVideo.videoHeight
            if (!width || !height) return
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext('2d', { willReadFrequently: true })
            context.drawImage(currentVideo, 0, 0, width, height)
            const imageData = context.getImageData(0, 0, width, height)
            const result = jsQR(imageData.data, width, height, {
              inversionAttempts: 'dontInvert',
            })
            if (result?.data) handleDetected(result.data)
          } catch {
            // Bỏ qua lỗi giải mã của một khung hình; vòng lặp sau sẽ thử lại.
          }
        }, SCAN_INTERVAL_MS)
      } catch (cameraError) {
        if (!cancelled) setError(getErrorMessage(cameraError))
      }
    }

    void start()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [handleDetected, stopCamera])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <h3 id="qr-scanner-title" className="text-base font-bold text-on-surface">
            Quét mã QR trên vé
          </h3>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            aria-label="Đóng cửa sổ quét mã"
            className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="p-5">
          {error ? (
            <div className="rounded-xl border border-error bg-error-container/20 p-4 text-sm text-error">
              <p className="font-semibold">Không thể quét bằng camera</p>
              <p className="mt-1">{error}</p>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="h-64 w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-40 w-40 rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
                {!isReady && (
                  <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-white">
                    Đang khởi động camera…
                  </p>
                )}
              </div>
              <p className="mt-3 text-center text-xs text-on-surface-variant">
                Đưa mã QR vào khung. Mã sẽ được nhận diện tự động.
                {engine === 'jsqr' ? ' (chế độ tương thích)' : ''}
              </p>
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>
    </div>
  )
}
