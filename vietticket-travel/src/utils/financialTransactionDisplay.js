export function getFinancialTransactionDisplay(transaction = {}) {
  const status = String(transaction.status || '').toUpperCase()
  const type = String(transaction.type || '').toUpperCase()
  const isRecognized = status === 'SUCCESS'
  const isNegative = isRecognized && type === 'REFUND'

  return {
    isRecognized,
    isNegative,
    sign: isRecognized ? (isNegative ? '−' : '+') : '',
    note: isRecognized ? '' : 'Chưa ghi nhận vào dòng tiền',
  }
}
