import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketManualCode } from './ETicketPage.jsx'

describe('TicketManualCode', () => {
  it('shows the full token and a ticket-specific copy label', () => {
    const token = 'VTQ-ABCDE-12345-05'
    const html = renderToStaticMarkup(
      <TicketManualCode
        ticket={{ qrCodeToken: token }}
        ticketLabel="vé số 5"
      />,
    )

    expect(html).toContain('Mã vé để nhập tay')
    expect(html).toContain(token)
    expect(html).toContain('aria-label="Sao chép mã vé số 5"')
  })

  it('does not render an empty manual code', () => {
    expect(renderToStaticMarkup(<TicketManualCode ticket={{}} />)).toBe('')
  })
})
