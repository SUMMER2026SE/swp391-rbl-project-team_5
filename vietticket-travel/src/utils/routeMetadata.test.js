import { describe, expect, it } from 'vitest'
import {
  getFallbackRouteTitle,
  getRouteRobots,
  isPublicIndexableRoute,
} from './routeMetadata.js'

describe('route metadata privacy policy', () => {
  it.each([
    '/',
    '/about',
    '/attractions',
    '/attractions/ba-na-hills',
    '/faq/',
    '/privacy',
    '/terms',
  ])('keeps public discovery route %s indexable', (pathname) => {
    expect(isPublicIndexableRoute(pathname)).toBe(true)
    expect(getRouteRobots(pathname)).toBe('index,follow')
  })

  it.each([
    '/login',
    '/register',
    '/reset-password',
    '/profile',
    '/booking-success',
    '/tickets/private-booking-id',
    '/party/join/private-room-id',
    '/rescue/private-case-id',
    '/partner/register',
    '/partner/dashboard',
    '/staff/checkin',
    '/admin',
    '/unknown-route',
  ])('prevents private or non-canonical route %s from being indexed', (pathname) => {
    expect(isPublicIndexableRoute(pathname)).toBe(false)
    expect(getRouteRobots(pathname)).toBe('noindex,nofollow')
  })
})
describe('route title fallbacks', () => {
  it.each([
    ['/favorites', 'Địa điểm yêu thích | VietTicket Travel'],
    ['/admin', 'Tổng quan hệ thống | VietTicket Admin'],
    ['/staff/refunds', 'Quản lý hoàn tiền | VietTicket Staff'],
    ['/checkout/reservation-id', 'Thanh toán đặt vé | VietTicket Travel'],
    ['/tickets/booking-id/', 'Vé điện tử | VietTicket Travel'],
  ])('provides a stable title for %s', (pathname, expected) => {
    expect(getFallbackRouteTitle(pathname)).toBe(expected)
  })

  it('does not overwrite data-driven page titles', () => {
    expect(getFallbackRouteTitle('/attractions/ba-na-hills')).toBe('')
    expect(getFallbackRouteTitle('/party/private-room-id')).toBe('')
  })
})
