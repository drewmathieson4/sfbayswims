# Sources

- Tide predictions: NOAA CO-OPS 9414305, North Point / Pier 41.
- Cove outside current and Bay reference: NOAA CO-OPS SFB1204, Alcatraz Island SW; Cove bin 18.
- Bay current field: NOAA CO-OPS stations listed in `data/worlds/bay/stations.json`; continuous predictions and
  subordinate maximum/slack events interpolated between events.
- Water: USGS Alcatraz (374938122251801), USGS Pier 17, NOAA 9414290, CeNCOOS Tiburon, and USGS-derived climatology.
- Wind: NWS Fort Point FTPC1, with Open-Meteo fallback.
- Cove aerial: NOAA NGS 2025 San Francisco imagery, Digital Coast 10318, public domain.
- Bay land aerial: USGS NAIPPlus / USDA NAIP; source metadata retained with the original image.
- Bay water image: contains modified Copernicus Sentinel data 2025; Sentinel-2 L2A pass of 2025-05-10.
- Shoreline, water mask and structures: © OpenStreetMap contributors, ODbL.

Georeferencing, source descriptions and image recipes are retained in each world's photo metadata.
The field is a simplified prediction model, not an observation or a navigation product.
