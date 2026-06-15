import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import CoordinateFields from '../components/partner/CoordinateFields.jsx'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

/* ── Constants ── */
const TABS = ['General Info', 'Location & Map', 'Image Gallery']

const PROVINCES = [
  'Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hội An', 'Nha Trang',
  'Huế', 'Quảng Ninh', 'Phú Quốc', 'Đà Lạt', 'Cần Thơ',
]

const DISTRICTS_MAP = {
  'Đà Nẵng': ['Hải Châu', 'Sơn Trà', 'Ngũ Hành Sơn', 'Liên Chiểu', 'Thanh Khê', 'Hòa Vang'],
  'Hà Nội': ['Hoàn Kiếm', 'Ba Đình', 'Đống Đa', 'Tây Hồ', 'Cầu Giấy'],
  'TP. Hồ Chí Minh': ['Quận 1', 'Quận 3', 'Bình Thạnh', 'Gò Vấp', 'Thủ Đức'],
}

const MAX_IMAGES = 8
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/* ── Main Page ── */
function PartnerAddAttractionPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftId, setDraftId] = useState(null)

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    openTime: '',
    closeTime: '',
    province: '',
    district: '',
    address: '',
    lat: '',
    lng: '',
    category: '',
  })
  const [categories, setCategories] = useState([])

  // Images state
  const [images, setImages] = useState([]) // { id, file, previewUrl, isThumbnail }
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  const addMoreRef = useRef(null)

  const imagesRef = useRef(images)
  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    document.title = 'Thêm điểm tham quan | VietTicket B2B'
    let active = true
    partnerApi.getCategories()
      .then((response) => {
        if (active) setCategories(response.categories || [])
      })
      .catch((error) => {
        if (active) toast.error(error.message)
      })
    return () => {
      active = false
      // cleanup preview URLs
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl))
    }
  }, [])

  const updateForm = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  /* ── Image Handlers ── */
  const processFiles = (files) => {
    const valid = Array.from(files).filter((f) => {
      if (!f.type.startsWith('image/')) {
        toast.error(`"${f.name}" không phải ảnh hợp lệ.`)
        return false
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`"${f.name}" vượt quá 5MB.`)
        return false
      }
      return true
    })

    const remaining = MAX_IMAGES - images.length
    if (valid.length > remaining) {
      toast.warning(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_IMAGES}).`)
    }

    const toAdd = valid.slice(0, remaining).map((file, i) => ({
      id: `${Date.now()}-${i}`,
      file,
      previewUrl: URL.createObjectURL(file),
      isThumbnail: images.length === 0 && i === 0,
    }))

    setImages((prev) => [...prev, ...toAdd])
  }

  const handleFileInput = (e) => { processFiles(e.target.files); e.target.value = '' }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    processFiles(e.dataTransfer.files)
  }

  const handleDeleteImage = (id) => {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== id)
      // if deleted thumbnail, assign to first remaining
      if (prev.find((img) => img.id === id)?.isThumbnail && next.length > 0) {
        next[0] = { ...next[0], isThumbnail: true }
      }
      return next
    })
  }

  const handleSetThumbnail = (id) => {
    setImages((prev) =>
      prev.map((img) => ({ ...img, isThumbnail: img.id === id }))
    )
  }

  /* ── Submit ── */
  const saveAttraction = async ({ submitForReview }) => {
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên điểm tham quan.')
      setActiveTab(0)
      return
    }
    if (!form.address.trim()) {
      toast.error('Vui lòng nhập địa chỉ chi tiết.')
      setActiveTab(1)
      return
    }
    if (!form.province) {
      toast.error('Vui lòng chọn tỉnh / thành phố.')
      setActiveTab(1)
      return
    }
    if (!form.category) {
      toast.error('Vui lòng chọn danh mục điểm tham quan.')
      setActiveTab(0)
      return
    }
    if (submitForReview && form.description.trim().length < 50) {
      toast.error('Mô tả cần ít nhất 50 ký tự trước khi gửi duyệt.')
      setActiveTab(0)
      return
    }
    if (submitForReview && (!form.openTime || !form.closeTime || form.openTime >= form.closeTime)) {
      toast.error('Vui lòng nhập giờ mở cửa và đóng cửa hợp lệ.')
      setActiveTab(0)
      return
    }
    if (submitForReview && (!form.lat || !form.lng)) {
      toast.error('Vui lòng bổ sung tọa độ bản đồ trước khi gửi duyệt.')
      setActiveTab(1)
      return
    }
    if (submitForReview && images.length === 0) {
      toast.error('Vui lòng tải lên ít nhất một ảnh trước khi gửi duyệt.')
      setActiveTab(2)
      return
    }
    setIsSubmitting(true)

    const payload = {
      name: form.name,
      description: form.description,
      openTime: form.openTime,
      closeTime: form.closeTime,
      province: form.province,
      district: form.district,
      address: form.address,
      lat: form.lat,
      lng: form.lng,
      category: form.category,
    }

    try {
      const saved = draftId
        ? await partnerApi.updateAttraction(draftId, payload)
        : await partnerApi.createAttraction(payload)
      const newId = draftId || saved?.attraction?.id
      if (!newId) {
        throw new Error('Máy chủ không trả về mã điểm tham quan vừa tạo.')
      }

      setDraftId(newId)

      const files = images.map((img) => img.file).filter(Boolean)
      if (files.length > 0) {
        const uploadResponse = await partnerApi.uploadAttractionImages(newId, files)
        const uploadedImages = uploadResponse.images || []
        setImages((current) => current.map((image) => {
          if (!image.file) return image
          const uploadedIndex = files.indexOf(image.file)
          const uploaded = uploadedImages[uploadedIndex]
          return uploaded
            ? {
                ...image,
                id: uploaded.id,
                previewUrl: uploaded.url,
                file: null,
                isThumbnail: uploaded.isPrimary || image.isThumbnail,
              }
            : image
        }))
        const primaryImage = images.find((image) => image.isThumbnail)
        const primaryImageId = primaryImage?.file
          ? uploadedImages[files.indexOf(primaryImage.file)]?.id
          : primaryImage?.id
        if (primaryImageId) {
          await partnerApi.setAttractionPrimaryImage(newId, primaryImageId)
        }
      }
      if (submitForReview) {
        await partnerApi.submitAttraction(newId)
        toast.success('Đã gửi điểm tham quan để admin xét duyệt!')
      } else {
        toast.success('Đã lưu điểm tham quan ở trạng thái bản nháp.')
      }
      navigate('/partner/attractions')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePublish = () => saveAttraction({ submitForReview: true })
  const handleSaveDraft = () => saveAttraction({ submitForReview: false })

  const districts = DISTRICTS_MAP[form.province] || []

  return (
    <PartnerLayout pageTitle="Add New Attraction">
      {/* Sticky sub-header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 -mt-2 mb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/partner/attractions')}
            className="p-2 rounded-full hover:bg-[#eceeef] transition-colors text-[#3f484a]"
            title="Quay lại"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2 className="text-2xl md:text-3xl font-semibold text-[#191c1d]">Thêm điểm tham quan mới</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveDraft}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors"
          >
            Lưu nháp
          </button>
          <button
            onClick={handlePublish}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && (
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            )}
            Đăng tải
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-[#bec8ca]">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === i
                ? 'text-[#00474d] border-b-2 border-[#00474d] -mb-px'
                : 'text-[#3f484a] hover:text-[#191c1d]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e1e3e4] p-6 md:p-8 space-y-12">

        {/* ── Tab 0: General Info ── */}
        {activeTab === 0 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thông tin chung</SectionHeading>

            {/* Name */}
            <FormField label="Tên điểm tham quan" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="VD: Bà Nà Hills Sun World"
                className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] placeholder-[#6f797a] outline-none shadow-sm transition-all"
              />
            </FormField>

            {/* Description */}
            <FormField label="Mô tả">
              <textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Mô tả trải nghiệm, điểm nổi bật và thông tin hữu ích cho du khách."
                className="w-full resize-y rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]"
              />
              <p className="mt-1 text-right text-xs text-[#6f797a]">
                {form.description.length}/5000 ký tự
              </p>
            </FormField>
            <FormField label="Danh mục" required>
              <select
                value={form.category}
                onChange={(e) => updateForm('category', e.target.value)}
                className="w-full rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]"
              >
                <option value="">Chọn danh mục</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>{category.name}</option>
                ))}
              </select>
            </FormField>

            {/* Opening / Closing Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Giờ mở cửa">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#00629d] text-[20px] pointer-events-none">
                    schedule
                  </span>
                  <input
                    type="time"
                    value={form.openTime}
                    onChange={(e) => updateForm('openTime', e.target.value)}
                    className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] pl-10 pr-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm"
                  />
                </div>
              </FormField>
              <FormField label="Giờ đóng cửa">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#00629d] text-[20px] pointer-events-none">
                    schedule
                  </span>
                  <input
                    type="time"
                    value={form.closeTime}
                    onChange={(e) => updateForm('closeTime', e.target.value)}
                    className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] pl-10 pr-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm"
                  />
                </div>
              </FormField>
            </div>

            <TabNav onNext={() => setActiveTab(1)} />
          </section>
        )}

        {/* ── Tab 1: Location & Map ── */}
        {activeTab === 1 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thông tin địa điểm</SectionHeading>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Tỉnh / Thành phố" required>
                <select
                  value={form.province}
                  onChange={(e) => { updateForm('province', e.target.value); updateForm('district', '') }}
                  className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm"
                >
                  <option value="">Chọn tỉnh / thành phố</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FormField>
              <FormField label="Quận / Huyện">
                <select
                  value={form.district}
                  onChange={(e) => updateForm('district', e.target.value)}
                  disabled={!form.province || districts.length === 0}
                  className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Chọn quận / huyện</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </FormField>
            </div>

            <FormField label="Địa chỉ chi tiết" required>
              <input
                type="text"
                value={form.address}
                onChange={(e) => updateForm('address', e.target.value)}
                placeholder="VD: 123 Đường Nguyễn Huệ"
                className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] placeholder-[#6f797a] outline-none shadow-sm transition-all"
              />
            </FormField>

            <FormField label="Tọa độ bản đồ">
              <CoordinateFields
                lat={form.lat}
                lng={form.lng}
                onLatChange={(value) => updateForm('lat', value)}
                onLngChange={(value) => updateForm('lng', value)}
              />
            </FormField>

            <TabNav onBack={() => setActiveTab(0)} onNext={() => setActiveTab(2)} />
          </section>
        )}

        {/* ── Tab 2: Image Gallery ── */}
        {activeTab === 2 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thư viện ảnh</SectionHeading>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileInput}
            />
            <input
              ref={addMoreRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileInput}
            />

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${
                isDragging
                  ? 'border-[#00474d] bg-[#f2f4f5]'
                  : 'border-[#bec8ca] bg-[#f8fafb] hover:bg-[#f2f4f5]'
              }`}
            >
              <div className="w-16 h-16 bg-[#006068] rounded-full flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-white text-[32px]">cloud_upload</span>
              </div>
              <h4 className="text-sm font-medium text-[#191c1d] mb-1">
                {isDragging ? 'Thả ảnh vào đây' : 'Nhấp để tải lên hoặc kéo thả'}
              </h4>
              <p className="text-sm text-[#3f484a]">SVG, PNG, JPG hoặc GIF (tối đa 5MB/ảnh, tối đa {MAX_IMAGES} ảnh)</p>
              {images.length > 0 && (
                <p className="mt-2 text-xs font-medium text-[#00474d]">
                  {images.length}/{MAX_IMAGES} ảnh đã tải lên
                </p>
              )}
            </div>

            {/* Images Grid */}
            {images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-lg overflow-hidden border border-[#bec8ca] shadow-sm group"
                  >
                    <img
                      src={img.previewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Thumbnail badge */}
                    {img.isThumbnail && (
                      <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 shadow-sm">
                        <span
                          className="material-symbols-outlined text-[#ffba20] text-[14px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          star
                        </span>
                        <span className="text-xs font-semibold text-[#191c1d]">Thumbnail</span>
                      </div>
                    )}
                    {/* Set as thumbnail button (only show on non-thumbnail on hover) */}
                    {!img.isThumbnail && (
                      <button
                        onClick={() => handleSetThumbnail(img.id)}
                        className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity text-[#3f484a] hover:text-[#00474d]"
                        title="Đặt làm ảnh đại diện"
                      >
                        <span className="material-symbols-outlined text-[14px]">star</span>
                        <span className="text-xs font-medium">Đặt TN</span>
                      </button>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteImage(img.id)}
                      className="absolute top-2 right-2 w-7 h-7 bg-[#ba1a1a]/90 hover:bg-[#ba1a1a] rounded-full flex items-center justify-center text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Xóa ảnh"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}

                {/* Add more placeholder */}
                {images.length < MAX_IMAGES && (
                  <div
                    onClick={() => addMoreRef.current?.click()}
                    className="relative aspect-square rounded-lg border-2 border-dashed border-[#bec8ca] flex flex-col items-center justify-center bg-[#f8fafb] hover:bg-[#f2f4f5] transition-colors cursor-pointer text-[#3f484a] hover:text-[#00474d] hover:border-[#00474d]"
                  >
                    <span className="material-symbols-outlined text-[32px] mb-1">add_photo_alternate</span>
                    <span className="text-xs font-semibold">Thêm ảnh</span>
                  </div>
                )}
              </div>
            )}

            <TabNav onBack={() => setActiveTab(1)} isLast onPublish={handlePublish} isSubmitting={isSubmitting} />
          </section>
        )}
      </div>

      <div className="h-8" />

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.25s ease-out forwards; }
      `}</style>
    </PartnerLayout>
  )
}

/* ── Small reusable components ── */
function SectionHeading({ children }) {
  return (
    <h3 className="text-lg font-semibold text-[#191c1d] border-b border-[#e1e3e4] pb-2">
      {children}
    </h3>
  )
}

function FormField({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#191c1d] mb-2">
        {label}
        {required && <span className="text-[#ba1a1a] ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function TabNav({ onBack, onNext, isLast = false, onPublish, isSubmitting = false }) {
  return (
    <div className="flex justify-between pt-4 border-t border-[#f2f4f5]">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Quay lại
        </button>
      ) : <div />}

      {isLast ? (
        <button
          type="button"
          onClick={onPublish}
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60"
        >
          {isSubmitting ? (
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[18px]">publish</span>
          )}
          Đăng tải
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm"
        >
          Tiếp theo
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      )}
    </div>
  )
}

export default PartnerAddAttractionPage
