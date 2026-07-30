import { describe, expect, it } from 'vitest'
import { getFinancialTransactionDisplay } from './financialTransactionDisplay.js'

describe('getFinancialTransactionDisplay', () => {
  it('ghi nhận thanh toán thành công là dòng tiền vào', () => {
    expect(getFinancialTransactionDisplay({
      type: 'PAYMENT',
      status: 'SUCCESS',
    })).toEqual({
      isRecognized: true,
      isNegative: false,
      sign: '+',
      note: '',
    })
  })

  it('ghi nhận hoàn tiền thành công là dòng tiền ra', () => {
    expect(getFinancialTransactionDisplay({
      type: 'REFUND',
      status: 'SUCCESS',
    })).toEqual({
      isRecognized: true,
      isNegative: true,
      sign: '−',
      note: '',
    })
  })

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'NEEDS_RECONCILIATION'])(
    'không cộng giao dịch %s vào dòng tiền thực',
    (status) => {
      expect(getFinancialTransactionDisplay({
        type: 'PAYMENT',
        status,
      })).toEqual({
        isRecognized: false,
        isNegative: false,
        sign: '',
        note: 'Chưa ghi nhận vào dòng tiền',
      })
    },
  )
})
