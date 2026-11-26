# Offline geographic data

## Basemap

The kiosk bundles a simplified subset of Natural Earth Vector 5.1.2. Natural Earth publishes these data in the public domain. [Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/), [source release](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson).

The 1:50 million land, lake, international boundary, state and provincial boundary, and river layers provide global context. The 1:10 million layers add roads, urban areas, rivers, and lakes around Kansas City and major populated places around the world. The subset rounds and simplifies coordinates and drops attributes unrelated to display.

## U.S. public-use airports

`public/geo/airports.json` contains 4,721 airports from `APT_BASE.csv` in the FAA NASR cycle effective October 29, 2026. It includes all 50 states and the District of Columbia, plus qualifying airports in American Samoa, Guam, the Northern Mariana Islands, Puerto Rico, the U.S. Virgin Islands, and Midway. [FAA NASR cycle](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-10-29/) · [APT CSV archive and field layout](https://nfdc.faa.gov/webContent/28DaySub/extra/29_Oct_2026_APT_CSV.zip)

To reproduce the list, keep the rows with `SITE_TYPE_CODE=A` for airports, `FACILITY_USE_CODE=PU` for public use, `ARPT_STATUS=O` for operational facilities, and `COUNTRY_CODE=US`. Allow the 50 state codes, `DC`, and the FAA territory codes `AS`, `GU`, `MP`, `PR`, `VI`, `QM`, `QW`, and `XL`. This cycle returns no qualifying airport at Wake Island (`QW`) or Palmyra Atoll (`XL`).

Each row is `[id, lat, lon, priority]`. The identifier comes from `ARPT_ID`, such as `MCI`, and the coordinates come from `LAT_DECIMAL` and `LONG_DECIMAL`, rounded to six decimal places. Priority `0` corresponds to the FAA’s scheduled air carrier code (`FAR_139_CARRIER_SER_CODE=S`). Priority `1` is for other airports with a listed tower (`TWR_TYPE_CODE` other than blank or `NON-ATCT`), and priority `2` covers the rest. Rows are sorted by identifier.

## U.S. air traffic center boundaries

The center coordinates in `public/artcc.js` are the FAA reference latitude and longitude in `ARB_BASE.csv` for the NASR cycle effective October 29, 2026. The catalog includes the 20 contiguous U.S. ARTCCs, Anchorage (ZAN), and Honolulu Control Facility (ZHN). A reference point can fall outside its charted high-altitude polygon, as it does for New York (ZNY). The FAA publishes NASR every 28 days. [NASR cycle index](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/) · [October 29 ARB CSV archive](https://nfdc.faa.gov/webContent/28DaySub/extra/29_Oct_2026_ARB_CSV.zip)

The boundaries in `public/geo/artcc.geojson` come from layer 0 of the FAA Aeronautical Information Services **Airspace_Boundary** feature service for the chart cycle October 29 to December 24, 2026. The FAA publishes this geospatial layer for public use on an eight-week cycle. [FAA feature service](https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Boundary_Airspace/FeatureServer/0) · [FAA metadata](https://www.arcgis.com/sharing/rest/content/items/67885972e4e940b2aa6d74024901c561/info/metadata/metadata.xml?format=default&output=html) · [FAA data disclaimer](https://www.faa.gov/air_traffic/flight_info/aeronav/FAA_DATA_DISCLAIMER/)

To reproduce the file, request GeoJSON with `outSR=4326` and filter `TYPE_CODE='ARTCC' AND LOCAL_TYPE='ARTCC_H'` for the charted high-altitude boundaries. Include the Honolulu feature with `IDENT='ZHN' AND TYPE_CODE='CTA' AND LOCAL_TYPE='ARTCC'`, which represents the charted Honolulu control area. Keep the identifiers listed in the catalog. Group the two New York (ZNY) polygons as one `MultiPolygon`. The bundled geometry keeps the FAA vertices and rings, rounded to six decimal places, and uses `IDENT` as the feature’s `id` property. Anchorage includes polar geometry. The map display uses Web Mercator’s latitude limit.
