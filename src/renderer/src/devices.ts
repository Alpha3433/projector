export interface DeviceSpec {
  id: string
  name: string
  width: number
  height: number
  dpr: number
  /** iOS safe-area insets in portrait (status bar / Dynamic Island, home indicator). */
  safeArea: { top: number; bottom: number; left: number; right: number }
  /** Corner radius of the screen itself. */
  screenRadius: number
  /** Bezel thicknesses and the outer shell radius. */
  chrome: { top: number; bottom: number; side: number; radius: number }
  cutout: 'island' | 'notch' | 'none'
  homeIndicator: boolean
  homeButton: boolean
  statusBar: 'modern' | 'compact'
  ua: 'iphone' | 'ipad'
}

export const DEVICES: DeviceSpec[] = [
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    width: 393,
    height: 852,
    dpr: 3,
    safeArea: { top: 59, bottom: 34, left: 0, right: 0 },
    screenRadius: 44,
    chrome: { top: 13, bottom: 13, side: 13, radius: 56 },
    cutout: 'island',
    homeIndicator: true,
    homeButton: false,
    statusBar: 'modern',
    ua: 'iphone'
  },
  {
    id: 'iphone-15-pro-max',
    name: 'iPhone 15 Pro Max',
    width: 430,
    height: 932,
    dpr: 3,
    safeArea: { top: 59, bottom: 34, left: 0, right: 0 },
    screenRadius: 48,
    chrome: { top: 13, bottom: 13, side: 13, radius: 60 },
    cutout: 'island',
    homeIndicator: true,
    homeButton: false,
    statusBar: 'modern',
    ua: 'iphone'
  },
  {
    id: 'iphone-13-mini',
    name: 'iPhone 13 mini',
    width: 375,
    height: 812,
    dpr: 3,
    safeArea: { top: 50, bottom: 34, left: 0, right: 0 },
    screenRadius: 40,
    chrome: { top: 12, bottom: 12, side: 12, radius: 50 },
    cutout: 'notch',
    homeIndicator: true,
    homeButton: false,
    statusBar: 'modern',
    ua: 'iphone'
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE (3rd gen)',
    width: 375,
    height: 667,
    dpr: 2,
    safeArea: { top: 20, bottom: 0, left: 0, right: 0 },
    screenRadius: 2,
    chrome: { top: 72, bottom: 72, side: 14, radius: 42 },
    cutout: 'none',
    homeIndicator: false,
    homeButton: true,
    statusBar: 'compact',
    ua: 'iphone'
  },
  {
    id: 'ipad-mini',
    name: 'iPad mini',
    width: 744,
    height: 1133,
    dpr: 2,
    safeArea: { top: 24, bottom: 20, left: 0, right: 0 },
    screenRadius: 16,
    chrome: { top: 24, bottom: 24, side: 24, radius: 40 },
    cutout: 'none',
    homeIndicator: true,
    homeButton: false,
    statusBar: 'modern',
    ua: 'ipad'
  }
]

export const DEFAULT_DEVICE_ID = 'iphone-15-pro'

export function getDevice(id: string): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0]
}

export const USER_AGENTS: Record<DeviceSpec['ua'], string> = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
}
