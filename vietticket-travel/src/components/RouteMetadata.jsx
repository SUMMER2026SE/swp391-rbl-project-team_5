import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { getFallbackRouteTitle, getRouteRobots } from '../utils/routeMetadata.js'

function upsertRobotsMeta(content) {
  let element = document.head.querySelector('meta[name="robots"]')
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', 'robots')
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function RouteMetadata() {
  const { pathname } = useLocation()

  useEffect(() => {
    const fallbackTitle = getFallbackRouteTitle(pathname)
    if (fallbackTitle) document.title = fallbackTitle
    upsertRobotsMeta(getRouteRobots(pathname))
  }, [pathname])

  return null
}

export default RouteMetadata
