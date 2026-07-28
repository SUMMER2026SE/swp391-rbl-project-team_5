const TICKET_TYPE_LABELS = {
  ADULT: 'Vé người lớn',
  CHILD: 'Vé trẻ em',
  STUDENT: 'Vé học sinh / sinh viên',
  FAMILY: 'Vé gia đình',
  GROUP: 'Vé nhóm',
}

export function getTicketTypeLabel(type) {
  const normalized = String(type || 'ADULT').toUpperCase()
  return TICKET_TYPE_LABELS[normalized] || 'Vé theo gói'
}

function optionalInteger(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export function getTicketEligibilityLabel(ticket) {
  const conditions = []
  const type = String(ticket?.type || 'ADULT').toUpperCase()
  const admissionCount = optionalInteger(ticket?.admissionCount)
  const packageLabel = ['FAMILY', 'GROUP'].includes(type) && admissionCount != null
    ? `Một gói áp dụng cho ${admissionCount} khách`
    : ''
  const minAge = optionalInteger(ticket?.minAgeYears)
  const maxAge = optionalInteger(ticket?.maxAgeYears)
  const minHeight = optionalInteger(ticket?.minHeightCm)
  const maxHeight = optionalInteger(ticket?.maxHeightCm)

  if (minAge != null && maxAge != null) conditions.push(`từ ${minAge} đến ${maxAge} tuổi`)
  else if (minAge != null) conditions.push(`từ ${minAge} tuổi`)
  else if (maxAge != null) conditions.push(`không quá ${maxAge} tuổi`)

  if (minHeight != null && maxHeight != null) conditions.push(`cao ${minHeight}-${maxHeight} cm`)
  else if (minHeight != null) conditions.push(`cao từ ${minHeight} cm`)
  else if (maxHeight != null) conditions.push(`cao không quá ${maxHeight} cm`)

  if (ticket?.requiresAdult) conditions.push('phải đi cùng người lớn')
  if (conditions.length > 0) {
    return [
      packageLabel,
      `Áp dụng cho khách ${conditions.join(', ')}`,
    ].filter(Boolean).join('. ')
  }

  if (type === 'CHILD') return 'Chưa có điều kiện tuổi/chiều cao; hãy kiểm tra mô tả vé'
  if (type === 'STUDENT') return 'Cần xuất trình giấy tờ học sinh hoặc sinh viên còn hiệu lực'
  if (type === 'FAMILY') return packageLabel || 'Gói gia đình chưa khai báo số khách'
  if (type === 'GROUP') return packageLabel || 'Gói nhóm chưa khai báo số khách'
  return 'Áp dụng theo điều kiện của gói vé'
}

export { TICKET_TYPE_LABELS }
