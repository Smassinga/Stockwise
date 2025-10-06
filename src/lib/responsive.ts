// src/lib/responsive.ts
// Utility functions for responsive design

export const isMobile = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

export const isTablet = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches
}

export const isDesktop = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(min-width: 1024px)').matches
}

export const useResponsiveClasses = () => {
  const mobile = isMobile()
  const tablet = isTablet()
  const desktop = isDesktop()
  
  return {
    mobile,
    tablet,
    desktop,
    'sm-down': mobile,
    'md-up': tablet || desktop,
    'md-down': mobile || tablet,
    'lg-up': desktop
  }
}

// Touch target helper
export const touchTargetClass = 'min-h-[44px] min-w-[44px]'

// Spacing helpers
export const responsivePadding = 'p-4 sm:p-6'
export const responsiveMargin = 'm-4 sm:m-6'

// Typography helpers
export const responsiveHeading = 'text-xl sm:text-2xl md:text-3xl'
export const responsiveSubheading = 'text-lg sm:text-xl md:text-2xl'
export const responsiveBody = 'text-sm sm:text-base'