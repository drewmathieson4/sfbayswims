// Every tunable in one object. Units: metres, m/s, seconds, epoch ms unless stated.
// The cove *is* the defaults; data/worlds/<id>/world.json → "config" patches this object in place for other worlds.
export const CONFIG = {
  paceMps: 100 / 105,                                   // still-water pace: 1:45 /100 m (?pace=1:40 overrides)

  origin: { lat: 37.8085, lon: -122.4235 },             // local tangent plane; everything is metres east/north of here
  view: {
    core: { x0: -420, x1: 420, y0: -250, y1: 430 },     // always visible (tight on the cove); null = fit the routes
    routePadM: 60,                                      // padding around the routes' bounding box
    extent: null,                                       // {x0,x1,y0,y1} to pin the framing (a fixed screen)
  },
  grid: { cell: 5, padM: 200 },                         // physics/water grid for zone worlds (mask worlds take the PNG's lattice)

  stations: {
    tideRef: '9414290',                                 // SF (Fort Point): reference station
    tideLocal: '9414305',                               // North Point / Pier 41: the cove's hi/lo timing
    currents: 'SFB1204',                                // Alcatraz Island, SW of — bin 18 (~2 m): the cove's outside current, live
    currentsBin: 18,
    waterTempUSGS: '374938122251801',                   // SF Bay at NE shore Alcatraz Island
    waterTempUSGSAlt: '374811122235001',                // Pier 17
    windNWS: 'FTPC1',                                   // Fort Point anemometer via api.weather.gov
  },

  // Current model. The cove field (js/current.js) uses all of it; the Bay field (js/stationfield.js) uses
  // outsideGain, slackKn and the flood/ebb axis.
  current: {
    areaM2: null,                                       // cove area; null → from the cove polygon
    openingDepthM: 4,
    shelterMin: 0.15,                                   // residual outside-current fraction deep in the cove
    shelterLengthM: 110,                                // e-folding distance from an exposed opening
    harborShelter: 0.30,                                // constant fraction inside the Hyde St harbor basin
    fillLengthM: 100, fillGain: 1.0,                    // tidal fill/drain through the openings
    eddyGain: 0.35, eddyRadiusM: 60,                    // intrusion eddy just inside the Opening (0 = off)
    outsideGain: 1.0,                                   // scale on the station current
    currentLagMin: 0,
    floodDirDeg: 86, ebbDirDeg: 271,                    // SFB1204 mean flood / ebb directions
    slackKn: 0.2,                                       // below this the HUD says "slack"
    fallbackKnPerFtH: 0.8, fallbackLagMin: 60,          // derived current from the tide rate when no station data
  },

  // Swim physics (js/swim.js): crab to hold the line; sprint through short strong stretches; swept when impossible.
  swim: {
    stepM: 10,                                          // integration step along a leg
    minGroundMps: 0.25,                                 // below this ground speed the line can't be held (~½ kn) → sprint, or swept
    burstPaceMps: 100 / 60,                             // the sprint: 1:00 /100 m
    burstReserveS: 60,                                  // seconds of sprint in the tank…
    burstRechargePerS: 0.25,                            // …refilling at this rate while swimming easy (1 s per 4 s)
  },

  particles: { perCells: 20, min: 500, max: 1600, speedup: 50, fade: 0.04, lineWidth: 1, maxAgeS: [1.5, 4] },

  anim: {
    speedup: 10, pauseS: 1.0,                           // swim-time seconds per real second (keys [ ] scale it live); pause at the end of a lap
    maxFps: 0,                                          // 0 = uncapped; ?fps=30 on the frame
    // swept away: the drift lasts sweptRealS real seconds with the clock at sweptTempo× the usual tempo; full opacity
    // until sweptFadeFrom of the way through, then fades. sweptFightS: after the sprint reserve is spent, seconds of
    // fading effort before the swimmer is simply carried. panic*: the thrashing stroke.
    sweptRealS: 12, sweptTempo: 2, sweptFadeFrom: 0.55, sweptFightS: 60,
    panicStrokeX: 4, panicReachX: 1.35, panicJitterDeg: 10,
  },

  // arrow-key time travel: a tap moves stepMin; holding accelerates from startMinPerS, doubling every doubleEveryS, up to maxMinPerS
  scrub: { stepMin: 5, snapNowMin: 2.5, holdDelayS: 0.3, startMinPerS: 10, doubleEveryS: 0.5, maxMinPerS: 720, maxBackH: 24 * 7, maxForwardH: 24 * 30 },
  refresh: { fetchTimeoutMs: 12000, tideH: 6, currentsH: 6, waterTempMin: 10, windMin: 15 },

  kiosk: { idleCursorS: 5, reloadAt: '04:00', returnToNowS: 600 },   // returnToNowS: idle drift back to "current"
  // kiosk only: follow the room light (tools/pi/ambient.py writes lux; tools/serve.py serves it). A black overlay from full
  // brightness at luxBright down to minBrightness at luxDark (log scale), plus a warm tint in the dark.
  ambient: { enabled: true, url: '/ambient.json', pollS: 5, luxDark: 3, luxBright: 300, minBrightness: 0.3, warmth: 0.25 },
  offlineHint: { afterS: 180, text: 'no wi-fi · join "aquatic-park" to set up' },   // kiosk only, after that long without live data

  photo: { filter: 'brightness(1) contrast(1.2) saturate(1)' },      // CSS filter on the aerial (--photo-filter)
  route: { doneWidth: 1, dotR: 3.5, followOffsetM: 15, keepRightM: 4 },   // dotR = swimmer unit size in metres (the Bay uses 60)
  swimmer: { icon: 'glyph', size: 1.5, strokeHz: 0.5, armReach: 0.8,     // icon: glyph | beacon (white dot + pulse; key i toggles)
    glyph: { head: 0.34, headY: 1.35, shoulder: 0.42, shoulderY: 0.85, hip: 0.22, length: 2.1, armX: 0.7, armW: 1.0 } },  // in units of route.dotR
  trace: { mode: 'comet', tailS: 30, tailSegments: 14, crumbs: true, crumbEveryS: 15 },   // mode: none | comet | ink
  uiScale: 1,
  show: { swimmer: true, streaks: true, ui: true },     // keys a / s / u; ?swimmer=0 ?streaks=0 ?ui=0; ?static=1 = still photo
  hud: { scrubbedWater: 'label', scrubbedWind: 'hide' },   // live-only readings while time-travelling: 'label' (adds "now") | 'hide'

  debugCurrentKn: 0,                                    // ?kn=2.5 forces a uniform current (+ flood, − ebb) for testing
};
